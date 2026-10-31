// Talks to the lab's LiveKit server (livekit.winlab.tw) with the app's API
// key: lists and ends rooms, mints the token a browser joins with, and
// checks the webhooks the server sends back. Reads its credentials from
// the environment, never touches the database; only actions and the
// webhook route call it.
import {
  AccessToken,
  LiveKitAPI,
  WebhookReceiver,
  type WebhookEvent,
  EncodedFileOutput,
} from "livekit-server-sdk"

import type { AgendaItem } from "@/lib/agenda"

const url = () => process.env.LIVEKIT_URL!
const apiKey = () => process.env.LIVEKIT_API_KEY!
const apiSecret = () => process.env.LIVEKIT_API_SECRET!

// The server API is HTTP on the same host browsers reach over WebSocket.
const api = () =>
  new LiveKitAPI({
    host: url().replace(/^ws/, "http"),
    apiKey: apiKey(),
    secret: apiSecret(),
  })

/** What a room carries besides its name, set when it is created. */
export type RoomMetadata = {
  title: string
  /** The opener's display name, for the room list. */
  createdBy: string
  /** The opener's username; "" when the account has none. */
  opener: string
  /** The portal project group's slug the recording is filed under, as
   * portal spells it; "" for a personal meeting. */
  group: string
  /** The portal room-booking id the room was opened for, or "". */
  booking: string
  /** When the booking ends, UTC as 2006-01-02T150405, or "". The egress
   * uploader holds the booking's recordings until then and joins them. */
  until: string
  /** The scheduled meeting's agenda; [] for a room opened on the spot. */
  agenda: AgendaItem[]
}

/** What the recording is filed under: the group, else the opener. */
export const filedUnder = (metadata: RoomMetadata) =>
  metadata.group || metadata.opener

export type RoomSummary = {
  name: string
  title: string
  prefix: string
  createdBy: string
  createdAt: Date
  participants: { identity: string; name: string }[]
}

/** A member in the room: not egress, not an agent, and not the hidden
 * summary participant that sits in every room. */
const isMember = (p: { kind?: number; permission?: { hidden?: boolean } }) =>
  (p.kind === 0 || p.kind === undefined) && !p.permission?.hidden

/** A room's metadata as meet wrote it, with defaults for missing fields. */
export function parseMetadata(raw: string): RoomMetadata {
  try {
    const data = JSON.parse(raw) as Partial<RoomMetadata>
    return {
      title: String(data.title ?? ""),
      createdBy: String(data.createdBy ?? ""),
      opener: String(data.opener ?? ""),
      group: String(data.group ?? ""),
      booking: String(data.booking ?? ""),
      until: String(data.until ?? ""),
      agenda: Array.isArray(data.agenda) ? data.agenda : [],
    }
  } catch {
    return {
      title: "",
      createdBy: "",
      opener: "",
      group: "",
      booking: "",
      until: "",
      agenda: [],
    }
  }
}

/** Every open room with who is in it, newest first. */
export async function listRooms(): Promise<RoomSummary[]> {
  const lk = api()
  const rooms = await lk.room.listRooms()
  const summaries = await Promise.all(
    rooms.map(async (room) => {
      const participants = await lk.room.listParticipants(room.name)
      const metadata = parseMetadata(room.metadata)
      return {
        name: room.name,
        title: metadata.title || room.name,
        prefix: filedUnder(metadata),
        createdBy: metadata.createdBy,
        createdAt: new Date(Number(room.creationTime) * 1000),
        participants: participants
          .filter(isMember)
          .map((p) => ({ identity: p.identity, name: p.name || p.identity })),
      }
    })
  )
  return summaries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

// A room records itself from the moment a member is in it (the webhook
// starts the egress) until it closes: the egress service composes
// the grid into an MP4. The file lands on the egress machine, whose
// uploader moves it to Nextcloud and hands the fields in the name to the
// lab's GitLab helper (see README, Recording):
// meet~<room>~{time}~<group>~<opener>~<booking>~<until>~<title>.mp4. "~"
// separates because no id contains it; {time} is UTC as 2006-01-02T150405,
// filled in by egress. An id that does not fit the pattern is filed as ""
// rather than stopping the room from opening.
const idPattern = /^[A-Za-z0-9._-]{1,64}$/
const safeId = (id: string) => (idPattern.test(id) ? id : "")
const safeTitle = (title: string) =>
  title
    .replace(/[\\/:*?"<>|~\x00-\x1f\x7f]+/g, " ")
    // winlab-helper refuses ".." anywhere in a recording's file name.
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()

export function recordingPath(name: string, metadata: RoomMetadata) {
  const fields = [
    "meet",
    safeId(name),
    "{time}",
    safeId(metadata.group),
    safeId(metadata.opener),
    safeId(metadata.booking),
    safeId(metadata.until),
    safeTitle(metadata.title) || name,
  ]
  return `/out/recordings/${fields.join("~")}.mp4`
}

/** Formats a time the way egress stamps {time}: UTC, 2006-01-02T150405. */
export const stamp = (date: Date) =>
  date.toISOString().replace(/:/g, "").slice(0, 17)

/** The Date a stamp names, or null for "". */
export function unstamp(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value)
  return match
    ? new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`)
    : null
}

/** Opens a room that stays up to 10 minutes while empty. */
export async function createRoom(name: string, metadata: RoomMetadata) {
  await api().room.createRoom({
    name,
    metadata: JSON.stringify(metadata),
    emptyTimeout: 10 * 60,
    departureTimeout: 60,
    maxParticipants: 50,
  })
}

/** Members in a room now (not egress, not agents). */
export async function memberCount(name: string) {
  const participants = await api().room.listParticipants(name)
  return participants.filter(isMember).length
}

/** Starts the room's recording unless one is already running. */
export async function startRecording(name: string, rawMetadata: string) {
  const lk = api()
  const running = await lk.egress.listEgress({ roomName: name, active: true })
  if (running.length > 0) return false
  await lk.egress.startRoomCompositeEgress(
    name,
    new EncodedFileOutput({
      filepath: recordingPath(name, parseMetadata(rawMetadata)),
    }),
    { layout: "grid" }
  )
  return true
}

export async function getRoom(name: string) {
  const [room] = await api().room.listRooms([name])
  return room ?? null
}

/** How many recordings are running right now. */
export async function activeRecordings() {
  const list = await api().egress.listEgress({ active: true })
  return list.length
}

/** Disconnects everyone and closes the room. */
export async function deleteRoom(name: string) {
  await api().room.deleteRoom(name)
}

/** The token one member joins one room with: good for an hour, lets them
 * publish, subscribe and send data, nothing more. */
export async function joinToken(input: {
  room: string
  identity: string
  name: string
}) {
  const token = new AccessToken(apiKey(), apiSecret(), {
    identity: input.identity,
    name: input.name,
    ttl: "1h",
  })
  token.addGrant({
    room: input.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  })
  return { serverUrl: url(), token: await token.toJwt() }
}

/** Checks a webhook's signature and returns the event, or throws. */
export async function receiveWebhook(
  body: string,
  authorization: string
): Promise<WebhookEvent> {
  return new WebhookReceiver(apiKey(), apiSecret()).receive(body, authorization)
}
