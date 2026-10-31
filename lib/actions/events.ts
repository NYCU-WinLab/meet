import { EgressStatus, type WebhookEvent } from "livekit-server-sdk"

import { db } from "@/lib/db"
import { livekitEvent } from "@/lib/db/schema"

// LiveKit stamps files in nanoseconds.
const ns = 1e9
const seconds = (from: bigint, to: bigint) =>
  to > from && from > BigInt(0) ? Math.round(Number(to - from) / ns) : null

/** Keeps one webhook as a row the dashboard can count. */
export async function recordEvent(event: WebhookEvent) {
  const egress = event.egressInfo
  const file = egress?.fileResults[0]
  const participant = event.participant
  await db.insert(livekitEvent).values({
    event: event.event,
    at: new Date(Number(event.createdAt) * 1000),
    room: event.room?.name ?? egress?.roomName ?? null,
    roomSid: event.room?.sid ?? egress?.roomId ?? null,
    participant: participant?.identity ?? null,
    // Only members count toward minutes; egress joins as a participant too.
    participantSeconds:
      event.event === "participant_left" && participant && !participant.kind
        ? Math.max(0, Number(event.createdAt) - Number(participant.joinedAt))
        : null,
    member: participant
      ? !participant.kind && !participant.permission?.hidden
      : null,
    egressId: egress?.egressId ?? null,
    egressStatus: egress ? EgressStatus[egress.status] : null,
    egressSeconds:
      event.event === "egress_ended" && file
        ? (seconds(file.startedAt, file.endedAt) ??
          Math.round(Number(file.duration) / ns))
        : null,
    egressBytes: file ? Number(file.size) : null,
    error: egress?.error || null,
  })
}
