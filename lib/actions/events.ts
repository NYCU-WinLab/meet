import { EgressStatus, type WebhookEvent } from "livekit-server-sdk"

import { db } from "@/lib/db"
import { livekitEvent } from "@/lib/db/schema"
import { memberOf } from "@/lib/participants"

// LiveKit stamps files in nanoseconds.
const ns = 1e9
const seconds = (from: bigint, to: bigint) =>
  to > from && from > BigInt(0) ? Math.round(Number(to - from) / ns) : null

/**
 * How long a participant stayed, or null when joinedAt is missing (0) or later
 * than the leave, so a bad webhook cannot stretch a stay back to the epoch.
 */
export function stayedSeconds(
  joinedAt: bigint | number,
  leftAt: bigint | number
) {
  const joined = Number(joinedAt)
  const left = Number(leftAt)
  return joined > 0 && joined <= left ? left - joined : null
}

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
    // The member, not the device: attendance and head counts are per person.
    participant: participant ? memberOf(participant.identity) : null,
    participantSid: participant?.sid ?? null,
    // Only members count toward minutes; egress joins as a participant too.
    participantSeconds:
      event.event === "participant_left" && participant && !participant.kind
        ? stayedSeconds(participant.joinedAt, event.createdAt)
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
    egressFileStartedAt:
      event.event === "egress_ended" && file && file.startedAt > BigInt(0)
        ? new Date(Number(file.startedAt / BigInt(1e6)))
        : null,
    error: egress?.error || null,
  })
}
