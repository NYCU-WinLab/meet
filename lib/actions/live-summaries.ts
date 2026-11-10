import { and, eq, gte, lte } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { liveSummary } from "@/lib/db/schema"
import { matchSpeakers } from "@/lib/speaker-match"

const line = z.object({
  at: z.number(),
  who: z.string().max(200),
  text: z.string().max(5000),
})

export const saveLiveSummary = defineAction({
  name: "save_live_summary",
  title: "保存即時摘要",
  description:
    "For the summary service: keeps a meeting's running summary and the lines it heard (who said what, when), replacing the last copy for the same room and start time. The recording page shows it after the meeting. Summary service only.",
  kind: "mutation",
  input: z.object({
    room: z.string().min(1).max(100),
    startedAt: z.coerce.date(),
    summary: z.record(z.string(), z.unknown()),
    lines: z.array(line).max(20_000),
  }),
  async run(actor, input) {
    if (actor.service !== "summary") throw new Error("只給摘要服務用")
    const row = { ...input, updatedAt: new Date() }
    await db
      .insert(liveSummary)
      .values(row)
      .onConflictDoUpdate({
        target: [liveSummary.room, liveSummary.startedAt],
        set: {
          summary: row.summary,
          lines: row.lines,
          updatedAt: row.updatedAt,
        },
      })
    return { saved: input.lines.length }
  },
  // Every meeting sends one after each rewrite; nobody watches it live.
  quiet: true,
})

export const matchRecordingSpeakers = defineAction({
  name: "match_speakers",
  title: "比對說話者",
  description:
    "For the recording uploader: names the diarized speakers (SPEAKER_00, …) of a recording's transcript from the lines the summary service heard live in that room between from and to, matched by text. A speaker gets a name only on clear evidence; room microphones never name one. Egress only.",
  kind: "query",
  input: z.object({
    room: z.string().min(1).max(100),
    from: z.coerce.date(),
    to: z.coerce.date(),
    segments: z
      .array(
        z.object({ speaker: z.string().max(40), text: z.string().max(5000) })
      )
      .max(20_000),
  }),
  async run(actor, input) {
    if (actor.service !== "egress") throw new Error("只給錄影上傳服務用")
    // A booking's parts can span several stays of the summary service.
    const hour = 60 * 60 * 1000
    const rows = await db
      .select({ lines: liveSummary.lines })
      .from(liveSummary)
      .where(
        and(
          eq(liveSummary.room, input.room),
          lte(liveSummary.startedAt, new Date(input.to.getTime() + hour)),
          gte(liveSummary.updatedAt, new Date(input.from.getTime() - hour))
        )
      )
    const lines = rows.flatMap((row) => row.lines)
    return {
      lines: lines.length,
      speakers: matchSpeakers(input.segments, lines),
    }
  },
})
