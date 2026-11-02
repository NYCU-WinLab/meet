// A recording the egress uploader filed in Nextcloud: where its folder is
// and whose meeting it was. Who may open it is worked out from this row,
// the room's join events and the project group's members.
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const recording = pgTable(
  "recordings",
  {
    /** The egress id (EG_…), or "<room>@<start>" when egress gave none. */
    id: text().primaryKey().notNull(),
    room: text().notNull(),
    title: text().notNull(),
    /** The portal project group's slug, or "" for a personal meeting. */
    group: text().notNull().default(""),
    /** The username of the member who opened or booked the room. */
    opener: text().notNull().default(""),
    booking: text().notNull().default(""),
    /** The folder under the uploader's Nextcloud root, "<YYYY-MM>/<stem>". */
    folder: text().notNull(),
    /** The file names in the folder share this stem: <stem>.mp4, .notes.md, … */
    stem: text().notNull(),
    startedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    bytes: bigint({ mode: "number" }).notNull().default(0),
    filedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("recordings_room_idx").on(table.room),
    index("recordings_started_at_idx").on(table.startedAt),
  ]
)
