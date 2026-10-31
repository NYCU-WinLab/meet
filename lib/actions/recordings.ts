import { and, asc, eq, inArray, lte } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { livekitEvent } from "@/lib/db/schema"

/** A stretch with no member in the room, in seconds. */
export type Gap = { from: number; to: number }

type Presence = {
  event: string
  at: number
  participant: string | null
  member: boolean | null
  /** On participant_left: how long they had stayed. */
  seconds?: number | null
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
  // A leave also says how long that member stayed, so a lost join still
  // shows them there: take those stretches out of the gaps.
  let left = gaps
  for (const row of rows) {
    if (row.event !== "participant_left" || !row.seconds || !isMember(row))
      continue
    const here = { from: row.at - row.seconds - 1, to: row.at + 1 }
    left = left.flatMap((gap) =>
      here.to <= gap.from || here.from >= gap.to
        ? [gap]
        : [
            { from: gap.from, to: here.from },
            { from: here.to, to: gap.to },
          ].filter((part) => part.to > part.from)
    )
  }
  return left
}

export const recordingGaps = defineAction({
  name: "recording_gaps",
  title: "錄影空檔",
  description:
    "For the egress uploader: the stretches of one finished recording (by egress id) when no member was in the room, as [{from, to}] in seconds from the file's first frame, so the recording can be cut to the time people were there. ready is false until LiveKit has reported the recording ended. Service callers only.",
  kind: "query",
  input: z.object({ egress: z.string().min(1).max(100) }),
  async run(actor, { egress }) {
    if (!actor.service) throw new Error("只給錄影上傳服務用")
    const [ended] = await db
      .select({
        room: livekitEvent.room,
        startedAt: livekitEvent.egressFileStartedAt,
        seconds: livekitEvent.egressSeconds,
      })
      .from(livekitEvent)
      .where(
        and(
          eq(livekitEvent.egressId, egress),
          eq(livekitEvent.event, "egress_ended")
        )
      )
      .limit(1)
    if (!ended?.room || !ended.startedAt || !ended.seconds)
      return { ready: false, gaps: [] as Gap[] }
    // The file's own clock, in ms: the egress's start is seconds earlier.
    const start = ended.startedAt.getTime() / 1000
    const from = Math.floor(start)
    const to = Math.ceil(start + ended.seconds)
    const rows = await db
      .select({
        event: livekitEvent.event,
        at: livekitEvent.at,
        participant: livekitEvent.participant,
        member: livekitEvent.member,
        seconds: livekitEvent.participantSeconds,
      })
      .from(livekitEvent)
      .where(
        and(
          eq(livekitEvent.room, ended.room),
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
    // Events are stamped to the second: round a gap inward so it never
    // takes in a second someone was there.
    const gaps = emptySpans(presence, from, to)
      .map((gap) => ({
        from: Math.max(0, Math.ceil(gap.from + 1 - start)),
        to: Math.floor(gap.to - start),
      }))
      .filter((gap) => gap.to > gap.from)
    return { ready: true, gaps }
  },
})
