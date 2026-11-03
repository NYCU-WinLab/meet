// One row per call the summary service makes to Claude: a summary rewrite or
// an @agent answer. The dashboard adds them up into what the agent costs.
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    at: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    room: text().notNull(),
    /** summary (a rewrite) or answer (an @agent question). */
    kind: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    webSearches: integer().notNull().default(0),
    /** What the call cost in US dollars at the price when it ran. */
    costUsd: doublePrecision().notNull().default(0),
  },
  (table) => [index("ai_usage_at_idx").on(table.at)]
)
