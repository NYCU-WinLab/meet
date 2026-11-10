// A running summary for every meeting. A hidden participant joins each room,
// cuts every microphone into short chunks, has the lab's transcribe service
// turn each chunk into text, and every so often asks a small model to rewrite
// one summary state (summary, open questions, improvements, decisions) with
// the lines said since. The state goes to everyone in the room on the
// meet.summary text stream. Audio is never written anywhere.
import {
  AudioStream,
  ParticipantKind,
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
} from "@livekit/rtc-node"
import type {
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
} from "@livekit/rtc-node"
import { AccessToken, RoomServiceClient } from "livekit-server-sdk"

import {
  answer,
  initial,
  summarize,
  type AgendaState,
  type Summary,
} from "./summarize.js"
import { RoomMics } from "./room-mic.js"
import { transcribeChunk } from "./transcribe.js"

const url = need("LIVEKIT_URL")
const apiKey = need("LIVEKIT_API_KEY")
const apiSecret = need("LIVEKIT_API_SECRET")
const identity = process.env.SUMMARY_IDENTITY ?? "summary"
const pollMs = Number(process.env.POLL_MS ?? 5000)
/** How much of each microphone goes to transcribe at a time. */
const chunkMs = Number(process.env.SUMMARY_CHUNK_MS ?? 30000)
/** How often the summary is rewritten when there is something new. */
const summaryMs = Number(process.env.SUMMARY_EVERY_MS ?? 45000)
/** Names and terms of the lab, comma separated, that every meeting may use:
 * recent members, products, papers. Speech recognition misspells them. */
const labWords = (process.env.SUMMARY_GLOSSARY ?? "")
  .split(/[,，、\n]/)
  .map((word) => word.trim())
  .filter(Boolean)
/** The most lines one rewrite reads; a backlog is folded in batch by batch. */
const batchLines = Number(process.env.SUMMARY_BATCH_LINES ?? 40)

export const SAMPLE_RATE = 16000
export const TOPIC = "meet.summary"
// What @livekit/components-react's useChat sends on.
const CHAT_TOPIC = "lk.chat"
// A chat message that mentions the agent is a question for it.
const MENTION = /@agent\b/i
// The meeting page names a chat message carrying this attribute "agent":
// the agent is hidden, so the page cannot look its name up.
const AGENT_ATTRIBUTE = "meet.agent"
/** Who a room microphone's lines are said by: people there, not its account. */
const ROOM = "會議室"

function need(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export const log = (...parts: unknown[]) =>
  console.log(new Date().toISOString(), ...parts)

type Line = {
  at: number
  who: string
  text: string
  /** The microphone's participant; chat lines have none. */
  identity?: string
}

type Meeting = {
  room: Room
  name: string
  /** The room's title and project group, as meet wrote them. */
  title: string
  group: string
  /** Everything heard so far, in the order chunks came back. */
  lines: Line[]
  /** How many lines the summary has seen. */
  seen: number
  summary: Summary
  summarizing: boolean
  /** Microphones found to be shared by several people in one room. */
  roomMics: RoomMics
  /** An @agent question is being answered; one at a time per room. */
  answering: boolean
  timer: ReturnType<typeof setInterval>
}

const rooms = new RoomServiceClient(
  url.replace(/^ws/, "http"),
  apiKey,
  apiSecret
)
const joined = new Map<string, Meeting>()

// A room is worth joining once a member is in it. The recorder counts in
// numParticipants but is no member: joining a room only it is in would keep
// the room open, and the recording running, after everyone left. Rooms that
// end take the Room's own disconnect with them.
async function poll() {
  let list
  try {
    list = await rooms.listRooms()
  } catch (error) {
    log("listRooms failed", error)
    return
  }
  const live = new Set(list.map((room) => room.name))
  for (const room of list) {
    if (room.numParticipants === 0 || joined.has(room.name)) continue
    try {
      const people = await rooms.listParticipants(room.name)
      if (people.some(isMember)) void join(room.name, room.metadata)
    } catch (error) {
      log(room.name, "listParticipants failed", error)
    }
  }
  for (const [name, meeting] of joined) {
    if (!live.has(name)) leave(meeting)
  }
}

/** A member: not the recorder, not an agent, not hidden like us. */
const isMember = (p: { kind?: number; permission?: { hidden?: boolean } }) =>
  (p.kind === 0 || p.kind === undefined) && !p.permission?.hidden

function leave(meeting: Meeting) {
  clearInterval(meeting.timer)
  joined.delete(meeting.name)
  void meeting.room.disconnect()
}

// The title and project group meet put in the room's metadata.
function contextOf(raw: string) {
  try {
    const data = JSON.parse(raw) as { title?: unknown; group?: unknown }
    return {
      title: typeof data.title === "string" ? data.title : "",
      group: typeof data.group === "string" ? data.group : "",
    }
  } catch {
    return { title: "", group: "" }
  }
}

// The words this meeting's transcript should spell right: the lab's own,
// the room's title, group and agenda, and the names of everyone in it.
function glossaryOf(meeting: Meeting): string[] {
  const names = [...meeting.room.remoteParticipants.values()]
    .filter((p) => p.kind === ParticipantKind.STANDARD)
    .map((p) => (p.name || "").replace(/^訪客\s*/, ""))
  const words = [
    ...names,
    meeting.title,
    meeting.group,
    ...meeting.summary.agenda.map((item) => item.text),
    ...labWords,
  ]
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))].slice(
    0,
    120
  )
}

// The agenda meet put in the room's metadata, all items pending.
function agendaOf(raw: string): AgendaState[] {
  try {
    const items = (JSON.parse(raw) as { agenda?: unknown }).agenda
    if (!Array.isArray(items)) return []
    return items.flatMap(
      (item: { id?: unknown; text?: unknown; url?: unknown }) =>
        typeof item?.id === "string" && typeof item.text === "string"
          ? [
              {
                id: item.id,
                text: item.text,
                ...(typeof item.url === "string" ? { url: item.url } : {}),
                status: "pending" as const,
                note: "",
              },
            ]
          : []
    )
  } catch {
    return []
  }
}

async function join(name: string, metadata: string) {
  const agenda = agendaOf(metadata)
  const room = new Room()
  const meeting: Meeting = {
    room,
    name,
    ...contextOf(metadata),
    lines: [],
    seen: 0,
    summary: initial(agenda),
    summarizing: false,
    roomMics: new RoomMics(),
    answering: false,
    timer: setInterval(() => void refresh(meeting), summaryMs),
  }
  joined.set(name, meeting)
  const token = new AccessToken(apiKey, apiSecret, { identity, name: "摘要" })
  token.addGrant({
    room: name,
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: true,
    hidden: true,
  })

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return
    if (publication.source !== TrackSource.SOURCE_MICROPHONE) return
    void listen(meeting, track, publication, participant)
  })
  // Typed chat counts as said: each message is one line, marked as chat.
  room.registerTextStreamHandler(CHAT_TOPIC, (reader, { identity }) => {
    void reader
      .readAll()
      .then((text) => {
        const said = text.trim().slice(0, 2000)
        if (!said) return
        const from = room.remoteParticipants.get(identity)
        const who = from?.name || identity
        meeting.lines.push({
          at: Date.now(),
          who: `${who}（聊天）`,
          text: said,
        })
        log(name, "chat line", said.length, "chars")
        if (MENTION.test(said)) void ask(meeting, who, said)
      })
      .catch((error) => log(name, "chat read failed", error))
  })
  // Someone who joins late gets the summary so far.
  room.on(RoomEvent.ParticipantConnected, () => {
    if (hasContent(meeting.summary)) void publish(meeting)
  })
  room.on(RoomEvent.ParticipantDisconnected, () => {
    const members = [...room.remoteParticipants.values()].filter(
      (p) => p.kind === ParticipantKind.STANDARD
    )
    if (members.length === 0) {
      log(name, "empty, leaving")
      leave(meeting)
    }
  })
  room.on(RoomEvent.Disconnected, () => {
    log(name, "disconnected")
    clearInterval(meeting.timer)
    joined.delete(name)
  })

  try {
    await room.connect(url, await token.toJwt(), {
      autoSubscribe: true,
      dynacast: false,
    })
    log(name, "joined", { agenda: agenda.length })
    // The checklist shows before anyone speaks.
    if (agenda.length > 0) await publish(meeting)
  } catch (error) {
    log(name, "connect failed", error)
    leave(meeting)
  }
}

// One microphone: 16 kHz mono PCM collected for chunkMs, then sent as a WAV
// to transcribe. Chunks come back out of order across speakers; lines carry
// the time the chunk started so the summary can read them in order.
async function listen(
  meeting: Meeting,
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
) {
  const who = participant.name || participant.identity
  const stream = new AudioStream(track, SAMPLE_RATE, 1)
  let parts: Uint8Array[] = []
  let bytes = 0
  let startedAt = Date.now()
  log(meeting.name, who, "listening")

  const flush = () => {
    if (bytes === 0) return
    const chunk = Buffer.concat(parts)
    const at = startedAt
    parts = []
    bytes = 0
    startedAt = Date.now()
    void transcribeChunk(chunk, SAMPLE_RATE)
      .then(({ text, speakers }) => {
        if (!text) return
        const identity = participant.identity
        if (meeting.roomMics.observe(identity, speakers)) {
          // Lines heard before it was found are the room's too.
          for (const line of meeting.lines)
            if (line.identity === identity) line.who = ROOM
          log(meeting.name, who, "is a room microphone")
        }
        const said = meeting.roomMics.has(identity) ? ROOM : who
        meeting.lines.push({ at, who: said, text, identity })
        log(
          meeting.name,
          who,
          "heard",
          text.length,
          "chars",
          speakers,
          "speakers as",
          said
        )
        void caption(meeting, participant.identity, said, text, at)
      })
      .catch((error) => log(meeting.name, who, "transcribe failed", error))
  }
  const timer = setInterval(flush, chunkMs)

  try {
    for await (const frame of stream) {
      const data = new Uint8Array(
        frame.data.buffer,
        frame.data.byteOffset,
        frame.data.byteLength
      )
      parts.push(Buffer.from(data))
      bytes += data.byteLength
    }
  } catch (error) {
    log(meeting.name, who, "audio stream ended", error)
  }
  clearInterval(timer)
  flush()
  log(meeting.name, who, "stopped", publication.sid)
}

// Live captions: each transcribed chunk goes to the room as soon as it
// comes back, with when the chunk started so pages can show the delay.
const CAPTION_TOPIC = "meet.caption"

async function caption(
  meeting: Meeting,
  identity: string,
  who: string,
  text: string,
  at: number
) {
  try {
    await meeting.room.localParticipant?.sendText(
      JSON.stringify({ identity, who, text, at }),
      { topic: CAPTION_TOPIC }
    )
    log(meeting.name, "caption delay", Date.now() - at, "ms")
  } catch (error) {
    log(meeting.name, "caption send failed", error)
  }
}

// Rewrites the summary with the oldest lines it has not seen, at most one
// batch, then publishes it. A backlog (after a failure) is folded in batch by
// batch right away, so every line reaches the summary and no call grows.
async function refresh(meeting: Meeting) {
  if (meeting.summarizing || meeting.seen === meeting.lines.length) return
  const fresh = meeting.lines
    .slice(meeting.seen, meeting.seen + batchLines)
    .sort((a, b) => a.at - b.at)
  meeting.summarizing = true
  let more = false
  try {
    const next = await summarize(
      meeting.summary,
      fresh,
      meeting.name,
      glossaryOf(meeting)
    )
    meeting.seen += fresh.length
    meeting.summary = next
    more = meeting.seen < meeting.lines.length && joined.has(meeting.name)
    await publish(meeting)
  } catch (error) {
    log(meeting.name, "summarize failed", error)
  } finally {
    meeting.summarizing = false
  }
  if (more) void refresh(meeting)
}

// Nothing to show yet: no words heard and no agenda.
const hasContent = (summary: Summary) =>
  summary.summary !== "" || summary.agenda.length > 0

// Answers one @agent question in the chat, and keeps the answer as a line
// so the summary knows what was said.
async function ask(meeting: Meeting, who: string, said: string) {
  const reply = async (text: string) => {
    await meeting.room.localParticipant?.sendText(text, {
      topic: CHAT_TOPIC,
      attributes: { [AGENT_ATTRIBUTE]: "1" },
    })
  }
  if (meeting.answering) {
    await reply("上一題還在查，等我回完再問。")
    return
  }
  meeting.answering = true
  try {
    const question = said.replace(MENTION, "").trim().slice(0, 500)
    const text = await answer(
      meeting.summary,
      meeting.lines,
      who,
      question,
      meeting.name,
      // Everyone who reads the answer, read when it is asked.
      [...meeting.room.remoteParticipants.values()]
        .filter((p) => p.kind === ParticipantKind.STANDARD)
        .map((p) => p.identity),
      glossaryOf(meeting)
    )
    await reply(text)
    meeting.lines.push({ at: Date.now(), who: "agent（聊天）", text })
    log(meeting.name, "answered", question.length, "->", text.length, "chars")
  } catch (error) {
    log(meeting.name, "answer failed", error)
    await reply("這題查不到，稍後再試。").catch(() => {})
  } finally {
    meeting.answering = false
  }
}

async function publish(meeting: Meeting) {
  await meeting.room.localParticipant?.sendText(
    JSON.stringify(meeting.summary),
    { topic: TOPIC }
  )
  log(meeting.name, "published summary", meeting.summary.updatedAt)
}

log("summary up", { url, identity, chunkMs, summaryMs })
setInterval(() => void poll(), pollMs)
void poll()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await Promise.all([...joined.values()].map((m) => m.room.disconnect()))
    process.exit(0)
  })
}
