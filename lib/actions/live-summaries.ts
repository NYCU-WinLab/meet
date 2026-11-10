import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { liveSummary } from "@/lib/db/schema"

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
