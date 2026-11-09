// A guest link lets someone without a lab account into one room until it
// expires. The secret in the link is the password; only its hash is kept.
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const guestLink = pgTable(
  "guest_links",
  {
    id: text().primaryKey().notNull(),
    /** SHA-256 of the secret in the link, hex. */
    secretHash: text().notNull().unique(),
    /** The room name the link opens. */
    room: text().notNull(),
    /** Who the link is for, as the admin wrote it; may be empty. */
    label: text().notNull().default(""),
    /** The admin's meet user id. */
    createdBy: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("guest_links_room_idx").on(table.room)]
)
