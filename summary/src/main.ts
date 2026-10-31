// A running summary for every meeting. A hidden participant joins each room,
// cuts every microphone into short chunks, has the lab's transcribe service
// turn each chunk into text, and every so often asks a small model to rewrite
// one summary state (summary, open questions, improvements, decisions) with
// the lines said since. The state goes to everyone in the room on the
// meet.summary text stream. Audio is never written anywhere.
import {
  AudioStream,
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
  initial,
  summarize,
  type AgendaState,
  type Summary,
} from "./summarize.js"
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

export const SAMPLE_RATE = 16000
export const TOPIC = "meet.summary"

function need(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export const log = (...parts: unknown[]) =>
  console.log(new Date().toISOString(), ...parts)

type Line = { at: number; who: string; text: string }

type Meeting = {
  room: Room
  name: string
  /** Everything heard so far, in the order chunks came back. */
  lines: Line[]
  /** How many lines the summary has seen. */
  seen: number
  summary: Summary
  summarizing: boolean
  timer: ReturnType<typeof setInterval>
}

const rooms = new RoomServiceClient(
  url.replace(/^ws/, "http"),
  apiKey,
  apiSecret
)
const joined = new Map<string, Meeting>()

// A room is worth joining once someone besides us is in it. Rooms that end
// take the Room's own disconnect with them.
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
    if (room.numParticipants > 0 && !joined.has(room.name)) {
      void join(room.name, agendaOf(room.metadata))
    }
  }
  for (const [name, meeting] of joined) {
    if (!live.has(name)) leave(meeting)
  }
}

function leave(meeting: Meeting) {
  clearInterval(meeting.timer)
  joined.delete(meeting.name)
  void meeting.room.disconnect()
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

async function join(name: string, agenda: AgendaState[]) {
  const room = new Room()
  const meeting: Meeting = {
    room,
    name,
    lines: [],
    seen: 0,
    summary: initial(agenda),
    summarizing: false,
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
  // Someone who joins late gets the summary so far.
  room.on(RoomEvent.ParticipantConnected, () => {
    if (hasContent(meeting.summary)) void publish(meeting)
  })
  room.on(RoomEvent.ParticipantDisconnected, () => {
    if (room.remoteParticipants.size === 0) {
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
      .then((text) => {
        if (!text) return
        meeting.lines.push({ at, who, text })
        log(meeting.name, who, "heard", text.length, "chars")
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

// Rewrites the summary with the lines it has not seen, then publishes it.
async function refresh(meeting: Meeting) {
  if (meeting.summarizing || meeting.seen === meeting.lines.length) return
  const fresh = meeting.lines.slice(meeting.seen).sort((a, b) => a.at - b.at)
  meeting.summarizing = true
  try {
    const next = await summarize(meeting.summary, fresh)
    meeting.seen = meeting.lines.length
    meeting.summary = next
    await publish(meeting)
  } catch (error) {
    log(meeting.name, "summarize failed", error)
  } finally {
    meeting.summarizing = false
  }
}

// Nothing to show yet: no words heard and no agenda.
const hasContent = (summary: Summary) =>
  summary.summary !== "" || summary.agenda.length > 0

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
