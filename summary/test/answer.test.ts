import { afterEach, describe, expect, test } from "bun:test"
import { answer, initial } from "../src/summarize.js"

const ALICE = "11111111-1111-4111-8111-111111111111"
const BOB = "22222222-2222-4222-8222-222222222222"
const SECRET = "RCS2 的預算砍半"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const reply = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })

/** The model searches past meetings once, then quotes what it found. While
 * search_recordings runs, `during` changes who is in the room. */
function fakeServices(hits: number, during: () => void) {
  let turns = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/api/actions/search_recordings")) {
      during()
      return reply({
        hits: Array.from({ length: hits }, () => ({
          title: "週會",
          startedAt: "2026-11-10T02:00:00.000Z",
          second: 42,
          text: SECRET,
          url: "/recordings/r1?t=42",
        })),
      })
    }
    if (url.endsWith("/api/actions/record_ai_usage")) return reply({})
    turns++
    return reply(
      turns === 1
        ? {
            stop_reason: "tool_use",
            usage: {},
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "search_meetings",
                input: { query: "RCS2" },
              },
            ],
          }
        : {
            stop_reason: "end_turn",
            usage: {},
            content: [
              { type: "text", text: hits ? `上次說：${SECRET}` : "查不到。" },
            ],
          }
    )
  }) as typeof fetch
}

const ask = (room: string[]) =>
  answer(initial([]), [], "Alice", "RCS2 上次怎麼說？", "r", () => [...room])

describe("answer and who reads it", () => {
  test("a guest who joins during the search does not get the results", async () => {
    const room = [ALICE, BOB]
    fakeServices(1, () => room.push("guest-xyz"))
    const text = await ask(room)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain("/recordings/r1")
  })

  test("a member who joins during the search does not get them either", async () => {
    const room = [ALICE]
    fakeServices(1, () => room.push(BOB))
    expect(await ask(room)).not.toContain(SECRET)
  })

  test("the same room gets the answer", async () => {
    const room = [ALICE, BOB]
    fakeServices(1, () => {})
    const text = await ask(room)
    expect(text).toContain(SECRET)
    expect(text).toContain("https://meet.test/recordings/r1?t=42")
  })

  test("someone leaving does not drop the answer", async () => {
    const room = [ALICE, BOB]
    fakeServices(1, () => room.pop())
    expect(await ask(room)).toContain(SECRET)
  })

  test("a search with no hits is answered whoever joins", async () => {
    const room = [ALICE]
    fakeServices(0, () => room.push("guest-xyz"))
    expect(await ask(room)).toBe("查不到。")
  })
})
