import { afterEach, describe, expect, test } from "bun:test"
import { AGENT_ATTRIBUTE, CHAT_TOPIC, sendReply } from "../src/chat.js"
import { answer, initial } from "../src/summarize.js"

const ALICE = "11111111-1111-4111-8111-111111111111"
const BOB = "22222222-2222-4222-8222-222222222222"
const SECRET = "RCS2 的預算砍半"

const checks: { recordingIds: string[]; asUsers: string[] }[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  checks.length = 0
  globalThis.fetch = realFetch
})

const reply = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })

/** The model searches past meetings once, then quotes what it found. While
 * search_recordings runs, `during` changes who is in the room. */
function fakeServices(
  hits: number,
  during: () => void,
  access: () => Response = () => reply({ ok: true })
) {
  let turns = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/api/actions/search_recordings")) {
      during()
      return reply({
        hits: Array.from({ length: hits }, () => ({
          recordingId: "r1",
          title: "週會",
          startedAt: "2026-11-10T02:00:00.000Z",
          second: 42,
          text: SECRET,
          url: "/recordings/r1?t=42",
        })),
      })
    }
    if (url.endsWith("/api/actions/check_recording_access")) {
      checks.push(JSON.parse(String(init?.body)))
      return access()
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

const respond = (room: string[]) =>
  answer(initial([]), [], "Alice", "RCS2 上次怎麼說？", "r", () => [...room])
const ask = async (room: string[]) => (await respond(room)).text

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

  test("an answer from past meetings names who it was searched for", async () => {
    const room = [ALICE, BOB]
    fakeServices(1, () => {})
    expect((await respond(room)).to).toEqual([ALICE, BOB])
  })

  test("someone leaving does not drop the answer", async () => {
    const room = [ALICE, BOB]
    fakeServices(1, () => room.pop())
    expect(await ask(room)).toContain(SECRET)
  })

  test("a search with no hits is answered whoever joins", async () => {
    const room = [ALICE]
    fakeServices(0, () => room.push("guest-xyz"))
    const sent = await respond(room)
    expect(sent.text).toBe("查不到。")
    expect(sent.to).toBeUndefined()
  })
})

describe("check_recording_access before sending", () => {
  test("asks with the quoted recordings and the whole room", async () => {
    const room = [ALICE, BOB]
    fakeServices(1, () => {})
    await ask(room)
    expect(checks).toEqual([{ recordingIds: ["r1"], asUsers: [ALICE, BOB] }])
  })

  for (const [name, access] of [
    ["ok false", () => reply({ ok: false })],
    ["400", () => new Response("{}", { status: 400 })],
    ["404", () => new Response("{}", { status: 404 })],
  ] as const) {
    test(`a ${name} suppresses the recording-derived answer`, async () => {
      fakeServices(1, () => {}, access)
      const sent = await respond([ALICE, BOB])
      expect(sent.text).not.toContain(SECRET)
      expect(sent.text).not.toContain("/recordings/r1")
      expect(sent.to).toBeUndefined()
    })
  }

  test("no search hits means no check", async () => {
    fakeServices(0, () => {})
    await ask([ALICE])
    expect(checks).toEqual([])
  })
})

describe("sendReply", () => {
  const sender = () => {
    const calls: { text: string; options: unknown }[] = []
    return {
      calls,
      sendText: async (text: string, options?: unknown) => {
        calls.push({ text, options })
        return {} as never
      },
    }
  }

  test("a searched answer goes only to the people it was searched for", async () => {
    const room = [ALICE, BOB]
    fakeServices(1, () => {})
    const { text, to } = await respond(room)
    const participant = sender()
    await sendReply(participant, text, to)
    expect(participant.calls).toEqual([
      {
        text,
        options: {
          topic: CHAT_TOPIC,
          attributes: { [AGENT_ATTRIBUTE]: "1" },
          destinationIdentities: [ALICE, BOB],
        },
      },
    ])
  })

  test("any other reply goes to the whole room", async () => {
    const participant = sender()
    await sendReply(participant, "查不到。")
    expect(participant.calls[0].options).not.toHaveProperty(
      "destinationIdentities"
    )
  })

  test("an empty audience is sent nothing, not everyone", async () => {
    const participant = sender()
    await sendReply(participant, SECRET, [])
    expect(participant.calls).toEqual([])
  })
})
