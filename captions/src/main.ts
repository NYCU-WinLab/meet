// Live captions for every meeting: a hidden participant joins each room,
// streams every microphone to the lab's transcribe service and publishes
// what it hears on the lk.transcription text stream, where the meeting page
// shows it under the speaker's name. Audio is never written anywhere.
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
import { createWriteStream } from "node:fs"
import { AccessToken, RoomServiceClient } from "livekit-server-sdk"

const url = need("LIVEKIT_URL")
const apiKey = need("LIVEKIT_API_KEY")
const apiSecret = need("LIVEKIT_API_SECRET")
const transcribeWs =
  process.env.TRANSCRIBE_WS ?? "wss://transcribe.winlab.tw/api/realtime/ws"
const identity = process.env.CAPTIONS_IDENTITY ?? "captions"
// Whisper guesses Japanese for Mandarin lectures when left to detect, so the
// language is pinned; set CAPTIONS_LANGUAGE= (empty) to let it detect.
const language =
  process.env.CAPTIONS_LANGUAGE === undefined
    ? "zh"
    : process.env.CAPTIONS_LANGUAGE || null
const pollMs = Number(process.env.POLL_MS ?? 5000)

const SAMPLE_RATE = 16000

function need(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const log = (...parts: unknown[]) =>
  console.log(new Date().toISOString(), ...parts)

const rooms = new RoomServiceClient(
  url.replace(/^ws/, "http"),
  apiKey,
  apiSecret
)
const joined = new Map<string, Room>()

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
      void join(room.name)
    }
  }
  for (const [name, room] of joined) {
    if (!live.has(name)) {
      void room.disconnect()
      joined.delete(name)
    }
  }
}

async function join(name: string) {
  const room = new Room()
  joined.set(name, room)
  const token = new AccessToken(apiKey, apiSecret, { identity, name: "字幕" })
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
    void transcribe(room, name, track, publication, participant)
  })
  room.on(RoomEvent.TrackUnsubscribed, (_track, publication, participant) =>
    log(name, participant.identity, "unsubscribed", publication.sid)
  )
  room.on(RoomEvent.TrackMuted, (publication, participant) =>
    log(name, participant.identity, "muted", publication.sid)
  )
  room.on(RoomEvent.ParticipantDisconnected, () => {
    if (room.remoteParticipants.size === 0) {
      log(name, "empty, leaving")
      void room.disconnect()
      joined.delete(name)
    }
  })
  room.on(RoomEvent.Disconnected, () => {
    log(name, "disconnected")
    joined.delete(name)
  })

  try {
    await room.connect(url, await token.toJwt(), {
      autoSubscribe: true,
      dynacast: false,
    })
    log(name, "joined")
  } catch (error) {
    log(name, "connect failed", error)
    joined.delete(name)
  }
}

// One transcribe session per microphone: 16 kHz mono PCM in, partial and
// final segments out. A partial repeats under the same segment id until its
// final replaces it, which is how the page knows to overwrite.
async function transcribe(
  room: Room,
  roomName: string,
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
) {
  const trackSid = publication.sid ?? track.sid ?? participant.identity
  const who = participant.name || participant.identity
  let finals = 0
  const ws = new WebSocket(transcribeWs)
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener(
      "error",
      (event) =>
        reject(new Error(String((event as ErrorEvent).message ?? "ws error"))),
      { once: true }
    )
  })
  ws.addEventListener("message", (event) => {
    let message: { type?: string; text?: string }
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (message.type !== "partial" && message.type !== "final") return
    const text = (message.text ?? "").trim()
    if (!text) return
    const final = message.type === "final"
    const segment = `${trackSid}-${finals}`
    if (final) finals += 1
    room.localParticipant
      ?.sendText(text, {
        topic: "lk.transcription",
        attributes: {
          "lk.transcribed_track_id": trackSid,
          "lk.segment_id": segment,
          "lk.transcription_final": final ? "true" : "false",
          "meet.speaker": participant.identity,
        },
      })
      .catch((error) => log(roomName, who, "sendText failed", error))
  })
  ws.addEventListener("close", (event) =>
    log(roomName, who, "transcribe closed", event.code, event.reason)
  )

  try {
    await opened
  } catch (error) {
    log(roomName, who, "transcribe connect failed", error)
    return
  }
  ws.send(
    JSON.stringify({
      language,
      sample_rate: SAMPLE_RATE,
      format: "pcm_s16le",
      meeting_type: "lab_meeting",
    })
  )
  log(roomName, who, "transcribing")

  const stream = new AudioStream(track, SAMPLE_RATE, 1)
  const dump = process.env.CAPTIONS_DUMP
    ? createWriteStream(
        `${process.env.CAPTIONS_DUMP}/${roomName}-${participant.identity}.pcm`
      )
    : null
  let frames = 0
  try {
    for await (const frame of stream) {
      if (ws.readyState !== WebSocket.OPEN) {
        log(roomName, who, "transcribe socket gone")
        break
      }
      frames += 1
      const bytes = new Uint8Array(
        frame.data.buffer,
        frame.data.byteOffset,
        frame.data.byteLength
      )
      if (frames === 1)
        log(
          roomName,
          who,
          "frame",
          frame.sampleRate,
          frame.channels,
          frame.samplesPerChannel,
          bytes.length
        )
      dump?.write(Buffer.from(bytes))
      ws.send(bytes)
    }
  } catch (error) {
    log(roomName, who, "audio stream ended", error)
  }
  dump?.end()
  log(roomName, who, "frames", frames)
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "eos" }))
    setTimeout(() => ws.close(), 3000)
  }
  log(roomName, who, "stopped")
}

log("captions up", { url, transcribeWs, identity, language })
setInterval(() => void poll(), pollMs)
void poll()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await Promise.all([...joined.values()].map((room) => room.disconnect()))
    process.exit(0)
  })
}
