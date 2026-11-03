import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { costOf } from "@/lib/ai-prices"
import { db } from "@/lib/db"
import { aiUsage } from "@/lib/db/schema"

const tokens = z.coerce.number().int().min(0).max(10_000_000).default(0)

export const recordAiUsage = defineAction({
  name: "record_ai_usage",
  title: "記錄 AI 用量",
  description:
    "For the summary service: records the tokens one Claude call used (a summary rewrite or an @agent answer) and its cost, for the dashboard. Summary service only.",
  kind: "mutation",
  input: z.object({
    room: z.string().min(1).max(100),
    kind: z.enum(["summary", "answer"]),
    model: z.string().min(1).max(64),
    inputTokens: tokens,
    cacheWriteTokens: tokens,
    cacheReadTokens: tokens,
    outputTokens: tokens,
    webSearches: z.coerce.number().int().min(0).max(100).default(0),
  }),
  async run(actor, input) {
    if (actor.service !== "summary") throw new Error("只給摘要服務用")
    const costUsd = costOf(input)
    await db.insert(aiUsage).values({ ...input, costUsd })
    return { costUsd }
  },
  // Every meeting writes one every 45 seconds; the dashboard reads them on
  // its next load.
  quiet: true,
})
