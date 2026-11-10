// The running summary of one meeting as the summary service last sent it,
// with the lines it heard and who said each. Kept so the recording page can
// show it after the meeting, and so the final notes can name the speakers.
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export type LiveLine = { at: number; who: string; text: string }

export const liveSummary = pgTable(
  "live_summaries",
  {
    room: text().notNull(),
    /** When the summary service joined: one room name can be reused. */
    startedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** The summary's JSON as the meeting page shows it. */
    summary: jsonb().$type<Record<string, unknown>>().notNull(),
    lines: jsonb().$type<LiveLine[]>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.room, table.startedAt] }),
    index("live_summaries_room_idx").on(table.room),
  ]
)
