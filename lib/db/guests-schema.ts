// A guest link lets someone without a lab account into one room until it
// expires. The secret in the link is the password; only its hash is kept.
import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

export const guestLink = pgTable(
  "guest_links",
  {
    id: text().primaryKey().notNull(),
    /** SHA-256 of the secret in the link, hex. */
    secretHash: text().notNull().unique(),
    /** The room name the link opens. */
    room: text().notNull(),
    /** The meeting's title when the link was made, for the list. */
    title: text().notNull().default(""),
    /** Who the link is for, as its maker wrote it; may be empty. */
    label: text().notNull().default(""),
    /** The meet user id of the member who made it. */
    createdBy: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("guest_links_room_idx").on(table.room)]
)

/** Each time someone came in through a guest link, with the name they
 * typed, so admins can see who a link let in. */
export const guestJoin = pgTable(
  "guest_joins",
  {
    id: serial().primaryKey(),
    linkId: text()
      .notNull()
      .references(() => guestLink.id, { onDelete: "cascade" }),
    name: text().notNull(),
    joinedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("guest_joins_link_idx").on(table.linkId)]
)
