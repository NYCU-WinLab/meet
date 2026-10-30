import { announceChange } from "@/lib/actions/changes"
import { recordEvent } from "@/lib/actions/events"
import { memberCount, receiveWebhook, startRecording } from "@/lib/livekit"
import { emitErrorLog } from "@/lib/otel"

// The LiveKit server posts here when a room opens or closes and when
// someone joins or leaves, and when a recording starts or ends, signed with
// the app's API key. Each event is kept for the dashboard; open pages then
// refresh their room list.
export const runtime = "nodejs"

const announced = new Set([
  "room_started",
  "room_finished",
  "participant_joined",
  "participant_left",
])

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization")
  if (!authorization) return new Response(null, { status: 401 })
  let event
  try {
    event = await receiveWebhook(await request.text(), authorization)
  } catch {
    return new Response(null, { status: 401 })
  }
  await recordEvent(event).catch(() => {})
  // The recording starts with the first member (one person recording alone
  // is a meeting too; the hidden summary bot is not) and runs until the
  // room closes.
  if (
    event.event === "participant_joined" &&
    event.room &&
    !event.participant?.kind
  ) {
    const room = event.room
    try {
      if ((await memberCount(room.name)) >= 1)
        await startRecording(room.name, room.metadata)
    } catch (error) {
      emitErrorLog(error, { room: room.name, step: "start recording" })
    }
  }
  if (announced.has(event.event))
    await announceChange(`livekit:${event.event}`).catch(() => {})
  return new Response(null, { status: 204 })
}
