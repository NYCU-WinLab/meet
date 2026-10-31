import { and, eq, gt, isNull } from "drizzle-orm"
import { z } from "zod"

import { defineAction, type Actor } from "@/lib/actions/define"
import { AGENDA_MAX, agendaList, withIds } from "@/lib/agenda"
import { bookingAgenda, projectGroups } from "@/lib/portal"
import { db } from "@/lib/db"
import { scheduledRoom, user } from "@/lib/db/schema"
import {
  createRoom,
  deleteRoom,
  getRoom,
  joinToken,
  listRooms as listLiveKitRooms,
  parseMetadata,
  stamp,
  unstamp,
  type RoomMetadata,
} from "@/lib/livekit"
import { emitErrorLog } from "@/lib/otel"

// Room names are short ids in the link (/r/<name>), never typed; the title
// members read is in the room's metadata.
const roomName = z
  .string()
  .regex(/^[a-z0-9]{3,32}(?:-[a-z0-9]{3,32})*$/, "沒有這個會議室")

const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
function newRoomName() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length])
  return `${chars.slice(0, 3).join("")}-${chars.slice(3, 6).join("")}-${chars.slice(6).join("")}`
}

async function member(userId: string) {
  const [row] = await db
    .select({ id: user.id, name: user.name, username: user.username })
    .from(user)
    .where(eq(user.id, userId))
  if (!row) throw new Error("找不到這個成員")
  return row
}

const title = z
  .string()
  .trim()
  .min(1, "請填會議名稱")
  .max(80, "會議名稱最多 80 字")
const group = z.string().trim().max(64).optional()
const booking = z
  .string()
  .regex(/^room-booking-(?:[0-9a-f]){12}$/, "預約編號格式不對")
const when = z.coerce.date()

async function checkGroup(name?: string) {
  if (!name) return
  const groups = await projectGroups()
  if (!groups.some((g) => g.name === name)) throw new Error("沒有這個專案群組")
}

/** A scheduled room opens 10 minutes early and its link dies an hour after. */
export const OPENS_BEFORE_MS = 10 * 60 * 1000
export const CLOSES_AFTER_MS = 60 * 60 * 1000

export type ScheduledRoom = typeof scheduledRoom.$inferSelect

const url = (name: string) => `${process.env.BETTER_AUTH_URL}/r/${name}`

export const listRooms = defineAction({
  name: "list_rooms",
  title: "會議室列表",
  description:
    "Every open meeting room: name (the id in its link), title, the project group or username its recording is filed under (prefix), who opened it, when, and the members in it now. A room closes by itself 10 minutes after the last member leaves. Also the rooms scheduled ahead that have not started (scheduled): name, title, booking, startsAt, endsAt and agenda (the items the meeting is for).",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const [rooms, scheduled] = await Promise.all([
      listLiveKitRooms(),
      db
        .select()
        .from(scheduledRoom)
        .where(
          and(
            isNull(scheduledRoom.cancelledAt),
            gt(scheduledRoom.endsAt, new Date(Date.now() - CLOSES_AFTER_MS))
          )
        )
        .orderBy(scheduledRoom.startsAt),
    ])
    const open = new Set(rooms.map((room) => room.name))
    return {
      rooms,
      scheduled: scheduled
        .filter((room) => !open.has(room.name))
        .map(
          ({
            name,
            title,
            group,
            opener,
            createdBy,
            booking,
            startsAt,
            endsAt,
            agenda,
          }) => ({
            name,
            title,
            prefix: group || opener,
            createdBy,
            booking,
            startsAt,
            endsAt,
            agenda: agenda.map(({ text, source, url }) => ({
              text,
              source,
              url,
            })),
          })
        ),
    }
  },
})

export const listGroups = defineAction({
  name: "list_groups",
  title: "專案群組",
  description:
    "The lab's project groups a room can be filed under: name (the slug create_room's group takes) and label.",
  kind: "query",
  input: z.object({}),
  run: async () => ({ groups: await projectGroups() }),
})

export const createRoomAction = defineAction({
  name: "create_room",
  title: "開會議室",
  description:
    "Opens a new meeting room now with a title and returns its name and link (https://meet.winlab.tw/r/<name>). Share the link; any lab member can join. The room records itself from the first member in; group (a slug from list_groups) files the recording under that project in GitLab, otherwise under the member's own username. agenda (one line per item) shows as a checklist the running summary ticks off. For a meeting booked ahead use schedule_room.",
  kind: "mutation",
  input: z.object({
    title,
    group,
    agenda: z
      .array(z.string().trim().min(1).max(200))
      .max(AGENDA_MAX)
      .optional(),
  }),
  run: async (actor, input) => {
    const me = await member(actor.userId)
    await checkGroup(input.group)
    if (!me.username) {
      // The helper files such a recording as unassigned.
      emitErrorLog(new Error("member has no username"), {
        action: "create_room",
        userId: me.id,
      })
    }
    const name = newRoomName()
    await createRoom(name, {
      title: input.title,
      createdBy: me.name,
      opener: me.username ?? "",
      group: input.group ?? "",
      booking: "",
      until: "",
      agenda: withIds(
        (input.agenda ?? []).map((text) => ({
          text,
          source: "booking" as const,
        }))
      ),
    })
    return { name, url: url(name) }
  },
})

// Who a scheduled room is for: the signed-in member, or, when portal
// schedules on a member's behalf, the username portal names.
async function openerOf(actor: Actor, username?: string) {
  if (actor.service) {
    if (!username) throw new Error("請填 opener")
    const [row] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.username, username))
    return { opener: username, createdBy: row?.name ?? username }
  }
  const me = await member(actor.userId)
  return { opener: me.username ?? "", createdBy: me.name }
}

export const scheduleRoom = defineAction({
  name: "schedule_room",
  title: "預約會議室",
  description:
    "Books a meeting room ahead for a portal room booking and returns its name and link at once. The link opens 10 minutes before startsAt and stops working an hour after endsAt; the LiveKit room is created when the first member enters, recorded from the first member in, and all its recordings are filed as one under the booking. agenda items ({text, source booking|issue, url?}) become the room's checklist; portal is asked for the current list again when the room opens. opener (a username) is only for portal, which schedules on a member's behalf.",
  kind: "mutation",
  input: z.object({
    title,
    group,
    booking,
    startsAt: when,
    endsAt: when,
    opener: z.string().trim().max(64).optional(),
    agenda: agendaList.optional(),
  }),
  run: async (actor, input) => {
    if (input.endsAt <= input.startsAt) throw new Error("結束要晚於開始")
    await checkGroup(input.group)
    const who = await openerOf(actor, input.opener)
    const name = newRoomName()
    await db.insert(scheduledRoom).values({
      name,
      title: input.title,
      group: input.group ?? "",
      booking: input.booking,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      agenda: withIds(input.agenda ?? []),
      ...who,
    })
    return { name, url: url(name) }
  },
})

async function scheduledByBooking(id: string) {
  const [row] = await db
    .select()
    .from(scheduledRoom)
    .where(eq(scheduledRoom.booking, id))
  if (!row) throw new Error("沒有這個預約")
  return row
}

export const updateScheduledRoom = defineAction({
  name: "update_scheduled_room",
  title: "改預約會議室",
  description:
    "Changes a scheduled room's title, group, time or agenda by its booking id; a given agenda replaces the old one. The link stays the same.",
  kind: "mutation",
  input: z.object({
    booking,
    title: title.optional(),
    group,
    startsAt: when.optional(),
    endsAt: when.optional(),
    agenda: agendaList.optional(),
  }),
  run: async (_actor, input) => {
    const row = await scheduledByBooking(input.booking)
    await checkGroup(input.group)
    const startsAt = input.startsAt ?? row.startsAt
    const endsAt = input.endsAt ?? row.endsAt
    if (endsAt <= startsAt) throw new Error("結束要晚於開始")
    await db
      .update(scheduledRoom)
      .set({
        title: input.title ?? row.title,
        group: input.group ?? row.group,
        startsAt,
        endsAt,
        agenda: input.agenda ? withIds(input.agenda) : row.agenda,
      })
      .where(eq(scheduledRoom.booking, input.booking))
    return { name: row.name, url: url(row.name) }
  },
})

export const cancelScheduledRoom = defineAction({
  name: "cancel_scheduled_room",
  title: "取消預約會議室",
  description:
    "Cancels a scheduled room by its booking id: the link stops working and an open room is closed.",
  kind: "mutation",
  input: z.object({ booking }),
  run: async (_actor, input) => {
    const row = await scheduledByBooking(input.booking)
    await db
      .update(scheduledRoom)
      .set({ cancelledAt: new Date() })
      .where(eq(scheduledRoom.booking, input.booking))
    if (await getRoom(row.name)) await deleteRoom(row.name)
    return { cancelled: true }
  },
})

/** What a link to a scheduled room gets outside its window. */
export type JoinState =
  | {
      state: "ready"
      title: string
      serverUrl: string
      token: string
      /** When a scheduled meeting ends; null for a room opened on the spot. */
      endsAt: Date | null
    }
  | { state: "early"; title: string; opensAt: Date; startsAt: Date }
  | { state: "ended"; title: string }

// A scheduled room whose LiveKit room is not open: open it if the time is
// right, otherwise say when. Portal is asked for the agenda again on the
// way in, so issues added since the booking show; a booking portal says is
// cancelled is cancelled here too, and portal not answering keeps the
// stored list.
async function openScheduled(name: string): Promise<JoinState | null> {
  const [row] = await db
    .select()
    .from(scheduledRoom)
    .where(and(eq(scheduledRoom.name, name), isNull(scheduledRoom.cancelledAt)))
  if (!row) return null
  const now = Date.now()
  const opensAt = new Date(row.startsAt.getTime() - OPENS_BEFORE_MS)
  if (now < opensAt.getTime())
    return { state: "early", title: row.title, opensAt, startsAt: row.startsAt }
  if (now > row.endsAt.getTime() + CLOSES_AFTER_MS)
    return { state: "ended", title: row.title }
  const fresh = await bookingAgenda(row.booking)
  if (fresh?.status === "cancelled") {
    await db
      .update(scheduledRoom)
      .set({ cancelledAt: new Date() })
      .where(eq(scheduledRoom.name, name))
    return null
  }
  const agenda = fresh ? withIds(fresh.items) : row.agenda
  if (fresh)
    await db
      .update(scheduledRoom)
      .set({ agenda })
      .where(eq(scheduledRoom.name, name))
  const metadata: RoomMetadata = {
    title: row.title,
    createdBy: row.createdBy,
    opener: row.opener,
    group: row.group,
    booking: row.booking,
    until: stamp(row.endsAt),
    agenda,
  }
  await createRoom(name, metadata)
  return {
    state: "ready",
    title: row.title,
    serverUrl: "",
    token: "",
    endsAt: row.endsAt,
  }
}

export const joinRoom = defineAction({
  name: "join_room",
  title: "加入會議室",
  description:
    "The LiveKit server URL and a one-hour token for the signed-in member to join a room from a browser. A scheduled room is opened on the way in when its time has come; before that the answer says when it opens.",
  kind: "query",
  input: z.object({ name: roomName }),
  run: async (actor, input): Promise<JoinState> => {
    const [me, room] = await Promise.all([
      member(actor.userId),
      getRoom(input.name),
    ])
    let title = room?.name ?? input.name
    let endsAt: Date | null = null
    if (room) {
      const metadata = parseMetadata(room.metadata)
      title = metadata.title || room.name
      endsAt = unstamp(metadata.until)
    } else {
      const opened = await openScheduled(input.name)
      if (!opened) throw new Error("沒有這個會議室")
      if (opened.state !== "ready") return opened
      title = opened.title
      endsAt = opened.endsAt
    }
    const credentials = await joinToken({
      room: input.name,
      identity: me.id,
      name: me.name,
    })
    return { state: "ready", title, endsAt, ...credentials }
  },
  mcpExcludedBecause:
    "It mints a browser credential; an agent joins a room with its own LiveKit token, not a member's.",
})

export const endRoom = defineAction({
  name: "end_room",
  title: "結束會議",
  description:
    "Closes a meeting room and disconnects everyone in it. Any lab member may end any room.",
  kind: "mutation",
  input: z.object({ name: roomName }),
  run: async (_actor, input) => {
    if (!(await getRoom(input.name))) throw new Error("沒有這個會議室")
    await deleteRoom(input.name)
    return { ended: true }
  },
})
