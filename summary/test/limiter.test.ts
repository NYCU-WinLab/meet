import { describe, expect, test } from "bun:test"
import { Limiter, QueueDropped, runWithBackoff } from "../src/limiter.js"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => (open = resolve))
  return { promise, open }
}

describe("Limiter", () => {
  test("never runs more than the concurrency at once", async () => {
    const limiter = new Limiter({ concurrency: 2, maxQueued: 20 })
    let active = 0
    let peak = 0
    const gates = Array.from({ length: 5 }, gate)
    const jobs = gates.map(async (g) => {
      const release = await limiter.acquire()
      active++
      peak = Math.max(peak, active)
      await g.promise
      active--
      release()
    })
    await tick()
    expect(active).toBe(2)
    for (const g of gates) {
      g.open()
      await tick()
    }
    await Promise.all(jobs)
    expect(peak).toBe(2)
  })

  test("serves waiters first in, first out", async () => {
    const limiter = new Limiter({ concurrency: 1, maxQueued: 20 })
    const order: number[] = []
    const first = await limiter.acquire()
    const waiting = [1, 2, 3].map(async (n) => {
      const release = await limiter.acquire()
      order.push(n)
      release()
    })
    first()
    await Promise.all(waiting)
    expect(order).toEqual([1, 2, 3])
  })

  test("drops the oldest waiter when the queue is full", async () => {
    const drops: number[] = []
    const limiter = new Limiter({
      concurrency: 1,
      maxQueued: 2,
      onDrop: (queued) => drops.push(queued),
    })
    const held = await limiter.acquire()
    const results: string[] = []
    const waiter = (name: string) =>
      limiter.acquire().then(
        (release) => {
          results.push(`ran ${name}`)
          release()
        },
        (error) => {
          expect(error).toBeInstanceOf(QueueDropped)
          results.push(`dropped ${name}`)
        }
      )
    const all = [waiter("a"), waiter("b"), waiter("c")]
    await tick()
    expect(results).toEqual(["dropped a"])
    expect(drops).toEqual([2])
    held()
    await Promise.all(all)
    expect(results).toEqual(["dropped a", "ran b", "ran c"])
  })
})

describe("runWithBackoff", () => {
  const ok = (value: string) => ({ done: true as const, value })
  const limited = (retryAfter: string | null = null) => ({
    done: false as const,
    retryAfter,
  })

  test("waits for Retry-After seconds, then resends and succeeds", async () => {
    const limiter = new Limiter({ concurrency: 2, maxQueued: 20 })
    const sleeps: number[] = []
    const results = [limited("7"), ok("text")]
    const value = await runWithBackoff(limiter, async () => results.shift()!, {
      sleep: async (ms) => void sleeps.push(ms),
      log: () => {},
    })
    expect(value).toBe("text")
    expect(sleeps).toEqual([7000])
  })

  test("caps Retry-After at 120 seconds", async () => {
    const limiter = new Limiter({ concurrency: 2, maxQueued: 20 })
    const sleeps: number[] = []
    const results = [limited("3600"), ok("x")]
    await runWithBackoff(limiter, async () => results.shift()!, {
      sleep: async (ms) => void sleeps.push(ms),
      log: () => {},
    })
    expect(sleeps).toEqual([120000])
  })

  test("backs off 15s, 30s, 60s without a Retry-After, then throws", async () => {
    const limiter = new Limiter({ concurrency: 2, maxQueued: 20 })
    const sleeps: number[] = []
    let calls = 0
    await expect(
      runWithBackoff(
        limiter,
        async () => {
          calls++
          return limited()
        },
        { sleep: async (ms) => void sleeps.push(ms), log: () => {} }
      )
    ).rejects.toThrow("transcribe 429")
    expect(calls).toBe(4)
    expect(sleeps).toEqual([15000, 30000, 60000])
  })

  test("does not retry any other error", async () => {
    const limiter = new Limiter({ concurrency: 2, maxQueued: 20 })
    let calls = 0
    await expect(
      runWithBackoff(
        limiter,
        async () => {
          calls++
          throw new Error("transcribe 500")
        },
        { sleep: async () => {}, log: () => {} }
      )
    ).rejects.toThrow("transcribe 500")
    expect(calls).toBe(1)
  })

  test("frees the slot while backing off", async () => {
    const limiter = new Limiter({ concurrency: 1, maxQueued: 20 })
    const sleeping = gate()
    const order: string[] = []
    const first = [limited("5"), ok("first")]
    const a = runWithBackoff(
      limiter,
      async () => {
        order.push("a attempt")
        return first.shift()!
      },
      {
        sleep: () => {
          order.push("a sleeps")
          return sleeping.promise
        },
        log: () => {},
      }
    )
    await tick()
    const b = runWithBackoff(
      limiter,
      async () => {
        order.push("b attempt")
        return ok("second")
      },
      { sleep: async () => {}, log: () => {} }
    )
    await tick()
    expect(await b).toBe("second")
    expect(order).toEqual(["a attempt", "a sleeps", "b attempt"])
    sleeping.open()
    expect(await a).toBe("first")
  })

  test("takes the job through an injected fetch", async () => {
    const limiter = new Limiter({ concurrency: 2, maxQueued: 20 })
    const statuses = [429, 200]
    const fakeFetch = async () =>
      new Response("{}", {
        status: statuses.shift()!,
        headers: { "retry-after": "2" },
      })
    const sleeps: number[] = []
    const value = await runWithBackoff(
      limiter,
      async () => {
        const res = await fakeFetch()
        if (res.status === 429)
          return {
            done: false as const,
            retryAfter: res.headers.get("retry-after"),
          }
        return ok("sent")
      },
      { sleep: async (ms) => void sleeps.push(ms), log: () => {} }
    )
    expect(value).toBe("sent")
    expect(sleeps).toEqual([2000])
  })
})
