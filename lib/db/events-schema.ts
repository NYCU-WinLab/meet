// What the LiveKit server told us, one row per webhook: the dashboard's
// history. LiveKit itself forgets a room the moment it closes.
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const livekitEvent = pgTable(
  "livekit_events",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    /** room_started, participant_left, egress_ended, … */
    event: text().notNull(),
    /** When LiveKit sent it. */
    at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    room: text(),
    roomSid: text(),
    /** The member's identity, on participant events. */
    participant: text(),
    /** How long they stayed, on participant_left. */
    participantSeconds: integer(),
    /** On participant events: a member, not the recorder, an agent or the
     * hidden summary participant. Null on rows from before it was kept. */
    member: boolean(),
    egressId: text(),
    /** EgressStatus name, on egress events: EGRESS_COMPLETE, EGRESS_FAILED, … */
    egressStatus: text(),
    /** The recording's length and size, on egress_ended. */
    egressSeconds: integer(),
    egressBytes: bigint({ mode: "number" }),
    error: text(),
  },
  (table) => [index("livekit_events_at_idx").on(table.at)]
)
