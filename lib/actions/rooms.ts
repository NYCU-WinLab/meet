import { eq } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { projectGroups } from "@/lib/portal"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import {
  createRoom,
  deleteRoom,
  getRoom,
  joinToken,
  listRooms as listLiveKitRooms,
} from "@/lib/livekit"

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

export const listRooms = defineAction({
  name: "list_rooms",
  title: "會議室列表",
  description:
    "Every open meeting room: name (the id in its link), title, the project group or username its recording is filed under (prefix), who opened it, when, and the members in it now. A room closes by itself 10 minutes after the last member leaves.",
  kind: "query",
  input: z.object({}),
  run: async () => ({ rooms: await listLiveKitRooms() }),
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
    "Opens a new meeting room with a title and returns its name and link (https://meet.winlab.tw/r/<name>). Share the link; any lab member can join. The room records itself; group (a slug from list_groups) files the recording under that project in GitLab, otherwise under the member's own username.",
  kind: "mutation",
  input: z.object({
    title: z
      .string()
      .trim()
      .min(1, "請填會議名稱")
      .max(40, "會議名稱最多 40 字"),
    group: z.string().trim().max(64).optional(),
  }),
  run: async (actor, input) => {
    const me = await member(actor.userId)
    let prefix = me.username ?? me.id
    if (input.group) {
      const group = (await projectGroups()).find((g) => g.name === input.group)
      if (!group) throw new Error("沒有這個專案群組")
      prefix = group.name
    }
    const name = newRoomName()
    await createRoom(name, { title: input.title, createdBy: me.name, prefix })
    return { name, url: `${process.env.BETTER_AUTH_URL}/r/${name}` }
  },
})

export const joinRoom = defineAction({
  name: "join_room",
  title: "加入會議室",
  description:
    "The LiveKit server URL and a one-hour token for the signed-in member to join a room from a browser. The room must exist.",
  kind: "query",
  input: z.object({ name: roomName }),
  run: async (actor, input) => {
    const [me, room] = await Promise.all([
      member(actor.userId),
      getRoom(input.name),
    ])
    if (!room) throw new Error("沒有這個會議室")
    const title = (() => {
      try {
        return String(JSON.parse(room.metadata).title ?? "") || room.name
      } catch {
        return room.name
      }
    })()
    const credentials = await joinToken({
      room: input.name,
      identity: me.id,
      name: me.name,
    })
    return { title, ...credentials }
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
