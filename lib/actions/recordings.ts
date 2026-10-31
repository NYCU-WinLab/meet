import { and, asc, eq, inArray, lte } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { livekitEvent } from "@/lib/db/schema"

/** A stretch of a recording with no member in the room, epoch seconds. */
export type Gap = { from: number; to: number }

type Presence = {
  event: string
  at: number
  participant: string | null
  member: boolean | null
}

// Rows from before the member column was kept: the recorder joins as EG_…
// and the summary service as "summary"; everyone else is a member.
const isMember = (row: Presence) =>
  row.member ??
  (!!row.participant &&
    !row.participant.startsWith("EG_") &&
    row.participant !== "summary")

/**
 * The stretches between from and to when no member was in the room, from
 * the room's join and leave events in order. A member who reconnects joins
 * twice before the old session leaves, so each identity keeps a count.
 */
export function emptySpans(rows: Presence[], from: number, to: number) {
  const here = new Map<string, number>()
  const present = () => [...here.values()].some((n) => n > 0)
  const gaps: Gap[] = []
  let emptySince: number | null = null
  const mark = (at: number) => {
    if (present()) {
      if (emptySince !== null && at > emptySince)
        gaps.push({ from: emptySince, to: at })
      emptySince = null
    } else if (emptySince === null) emptySince = Math.max(at, from)
  }
  // Events before from only set who is there when the recording starts.
  let started = false
  for (const row of rows) {
    if (!row.participant || !isMember(row)) continue
    if (!started && row.at >= from) {
      mark(from)
      started = true
    }
    const n = here.get(row.participant) ?? 0
    here.set(
      row.participant,
      row.event === "participant_joined" ? n + 1 : Math.max(0, n - 1)
    )
    if (started) mark(Math.min(row.at, to))
  }
  if (!started) mark(from)
  if (emptySince !== null && to > emptySince)
    gaps.push({ from: emptySince, to })
  return gaps
}

export const recordingGaps = defineAction({
  name: "recording_gaps",
  title: "錄影空檔",
  description:
    "For the egress uploader: the stretches between from and to (epoch seconds, a recording's start and end) when no member was in the room, as [{from, to}] in epoch seconds, so the recording can be cut to the time people were there. Service callers only.",
  kind: "query",
  input: z.object({
    room: z.string().min(1).max(100),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
  }),
  async run(actor, { room, from, to }) {
    if (!actor.service) throw new Error("只給錄影上傳服務用")
    if (to <= from) return { gaps: [] }
    const rows = await db
      .select({
        event: livekitEvent.event,
        at: livekitEvent.at,
        participant: livekitEvent.participant,
        member: livekitEvent.member,
      })
      .from(livekitEvent)
      .where(
        and(
          eq(livekitEvent.room, room),
          inArray(livekitEvent.event, [
            "participant_joined",
            "participant_left",
          ]),
          lte(livekitEvent.at, new Date(to * 1000))
        )
      )
      .orderBy(asc(livekitEvent.at))
    const presence = rows.map((row) => ({
      ...row,
      at: Math.floor(row.at.getTime() / 1000),
    }))
    return { gaps: emptySpans(presence, from, to) }
  },
})
