// Back-pressure for the transcribe service: a FIFO limit on jobs in flight,
// a cap on how many chunks may wait, and a retry that backs off on 429. The
// service runs one GPU, so sending more at once is no faster, and its own
// limits answer 429 (too many requests, or too many jobs in progress).

/** The waiter was pushed out of a full queue by a newer one. */
export class QueueDropped extends Error {
  constructor() {
    super("transcribe queue full, oldest chunk dropped")
  }
}

type Waiter = {
  resolve: (release: () => void) => void
  reject: (e: Error) => void
}

export class Limiter {
  private active = 0
  private waiting: Waiter[] = []

  constructor(
    private options: {
      concurrency: number
      /** Waiters beyond this push out the oldest one. */
      maxQueued: number
      /** Called with the queue length after the oldest waiter was dropped. */
      onDrop?: (queued: number) => void
    }
  ) {}

  /** Resolves with a release function once a slot is free. */
  acquire(): Promise<() => void> {
    if (this.active < this.options.concurrency)
      return Promise.resolve(this.take())
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject })
      if (this.waiting.length > this.options.maxQueued) {
        this.waiting.shift()!.reject(new QueueDropped())
        this.options.onDrop?.(this.waiting.length)
      }
    })
  }

  private take() {
    this.active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      const next = this.waiting.shift()
      if (next) next.resolve(this.take())
    }
  }
}

/** One try: finished with a value, or the service said 429. */
export type Attempt<T> =
  { done: true; value: T } | { done: false; retryAfter: string | null }

const RETRIES = 3
const BASE_MS = 15_000
const CAP_MS = 120_000

/**
 * Runs `attempt` holding a slot. On 429 the slot is given back, the call
 * sleeps (Retry-After seconds, else 15s, 30s, 60s) and queues up again, for
 * at most 3 retries. Any other failure is the attempt's own throw.
 */
export async function runWithBackoff<T>(
  limiter: Limiter,
  attempt: () => Promise<Attempt<T>>,
  deps: {
    sleep: (ms: number) => Promise<void>
    log: (...parts: unknown[]) => void
  }
): Promise<T> {
  for (let retry = 0; ; retry++) {
    const release = await limiter.acquire()
    let result: Attempt<T>
    try {
      result = await attempt()
    } finally {
      release()
    }
    if (result.done) return result.value
    if (retry >= RETRIES) {
      deps.log("transcribe 429, giving up after", retry, "retries")
      throw new Error("transcribe 429")
    }
    const wait = backoffMs(result.retryAfter, retry)
    deps.log(
      "transcribe 429, retry",
      retry + 1,
      "of",
      RETRIES,
      "in",
      wait,
      "ms"
    )
    await deps.sleep(wait)
  }
}

function backoffMs(retryAfter: string | null, retry: number) {
  const seconds = retryAfter === null ? NaN : Number(retryAfter)
  if (retryAfter?.trim() && Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, CAP_MS)
  return Math.min(BASE_MS * 2 ** retry, CAP_MS)
}
