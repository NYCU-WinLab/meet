// A room booked ahead: the plan for a room, not a room. Rooms themselves
// live in LiveKit; a scheduled room becomes one when the first member
// joins inside its window, and again if it closed and members come back.
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import type { AgendaItem } from "@/lib/agenda"

export const scheduledRoom = pgTable("scheduled_rooms", {
  /** The room name, the id in its link. */
  name: text().primaryKey().notNull(),
  title: text().notNull(),
  /** The portal project group's slug, or "" for a personal meeting. */
  group: text().notNull().default(""),
  /** The username of the member the meeting is for. */
  opener: text().notNull().default(""),
  /** The opener's display name, for the room list. */
  createdBy: text().notNull().default(""),
  /** The portal room-booking id; one scheduled room per booking. */
  booking: text().notNull().unique(),
  startsAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  endsAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  /** What the meeting is for, ticked off live by the summary service. */
  agenda: jsonb().$type<AgendaItem[]>().notNull().default([]),
  cancelledAt: timestamp({ withTimezone: true, mode: "date" }),
  createdAt: timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
})
