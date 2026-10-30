import { announceChange } from "@/lib/actions/changes"
import { recordEvent } from "@/lib/actions/events"
import { receiveWebhook } from "@/lib/livekit"

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
  if (announced.has(event.event))
    await announceChange(`livekit:${event.event}`).catch(() => {})
  return new Response(null, { status: 204 })
}
