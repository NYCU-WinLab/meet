// A recording the egress uploader filed in Nextcloud: where its folder is
// and whose meeting it was. Who may open it is worked out from this row,
// the room's join events and the project group's members.
import {
  bigint,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

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

// The recording's subtitles, line by line, so search_recordings can find
// what was said across meetings. Filled from <stem>.srt the first time a
// search covers the recording; a row in transcriptIndex says it was read.
export const transcriptSegment = pgTable(
  "transcript_segments",
  {
    id: serial().primaryKey(),
    recordingId: text()
      .notNull()
      .references(() => recording.id, { onDelete: "cascade" }),
    startMs: integer().notNull(),
    endMs: integer().notNull(),
    text: text().notNull(),
  },
  (table) => [index("transcript_segments_recording_idx").on(table.recordingId)]
)

/** One row per recording whose subtitles were read (segments may be 0). */
export const transcriptIndex = pgTable("transcript_index", {
  recordingId: text()
    .primaryKey()
    .references(() => recording.id, { onDelete: "cascade" }),
  segments: integer().notNull(),
  indexedAt: timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
})
