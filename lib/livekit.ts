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
  RoomCompositeEgressRequest,
  RoomEgress,
} from "livekit-server-sdk"

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
  createdBy: string
  /** What the recording is filed under: a project group's slug, or the
   * opener's username. */
  prefix: string
}

export type RoomSummary = {
  name: string
  title: string
  prefix: string
  createdBy: string
  createdAt: Date
  participants: { identity: string; name: string }[]
}

function parseMetadata(raw: string): RoomMetadata {
  try {
    const data = JSON.parse(raw) as Partial<RoomMetadata>
    return {
      title: String(data.title ?? ""),
      createdBy: String(data.createdBy ?? ""),
      prefix: String(data.prefix ?? ""),
    }
  } catch {
    return { title: "", createdBy: "", prefix: "" }
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
        prefix: metadata.prefix,
        createdBy: metadata.createdBy,
        createdAt: new Date(Number(room.creationTime) * 1000),
        participants: participants
          // Agents and egress are not members.
          .filter((p) => p.kind === 0 || p.kind === undefined)
          .map((p) => ({ identity: p.identity, name: p.name || p.identity })),
      }
    })
  )
  return summaries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** Opens a room that stays up to 10 minutes while empty. */
// Every room records itself: the egress service composes the grid into an
// MP4 the moment the room starts and stops when it ends. The file lands on
// the egress machine, whose uploader moves it to Nextcloud. The name is
// what the lab's GitLab helper reads, the way Teams named recordings:
// [prefix]-<topic>-<yyyymmdd>_<hhmmss>UTC-Meeting Recording.mp4; {time}
// here is UTC as 2006-01-02T150405 and the uploader reshapes it.
function autoRecording(name: string, metadata: RoomMetadata) {
  const safe = (text: string) =>
    text
      .replace(/[\\/:*?"<>|\[\]-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  const subject = `[${safe(metadata.prefix) || name}]-${safe(metadata.title) || name}`
  return new RoomEgress({
    room: new RoomCompositeEgressRequest({
      roomName: name,
      layout: "grid",
      fileOutputs: [
        new EncodedFileOutput({
          filepath: `/out/recordings/${subject}-{time}.mp4`,
        }),
      ],
    }),
  })
}

export async function createRoom(name: string, metadata: RoomMetadata) {
  await api().room.createRoom({
    name,
    metadata: JSON.stringify(metadata),
    emptyTimeout: 10 * 60,
    departureTimeout: 60,
    maxParticipants: 50,
    egress: autoRecording(name, metadata),
  })
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
