import { createHash } from "node:crypto"

import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { z } from "zod"

import { defineAction, type Actor } from "@/lib/actions/define"
import {
  isAdmin,
  member,
  openScheduled,
  roomName,
  type JoinState,
} from "@/lib/actions/rooms"
import { db } from "@/lib/db"
import { guestLink, scheduledRoom } from "@/lib/db/schema"
import { getRoom, joinToken, parseMetadata, unstamp } from "@/lib/livekit"

// Guest links: an admin lets someone without a lab account into one room
// for a while. The link carries a random secret, the guest's password; the
// database keeps only its hash.

/** How long a link may work, in hours: an hour, a day or a week. */
export const GUEST_HOURS = [1, 24, 168] as const

/** How long a guest's token may be used to join: long enough for the lobby. */
const GUEST_TOKEN_SECONDS = 10 * 60

const secretOf = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "這個訪客連結無效")
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex")
const url = (secret: string) => `${process.env.BETTER_AUTH_URL}/g/${secret}`

async function requireAdmin(actor: Actor) {
  if (actor.service) throw new Error("只有管理員能管理訪客連結")
  const me = await member(actor.userId)
  if (!isAdmin(me.username)) throw new Error("只有管理員能管理訪客連結")
  return me
}

/** An open room, or a scheduled one that is not cancelled. */
async function roomExists(name: string) {
  if (await getRoom(name)) return true
  const [row] = await db
    .select({ name: scheduledRoom.name })
    .from(scheduledRoom)
    .where(and(eq(scheduledRoom.name, name), isNull(scheduledRoom.cancelledAt)))
  return Boolean(row)
}

export const createGuestLink = defineAction({
  name: "create_guest_link",
  title: "產生訪客連結",
  description:
    "Admins only. Makes a link that lets someone without a lab account join one room (an open room or a scheduled one) until it expires after hours (1, 24 or 168). The secret in the link is the password: share the whole link with the guest only. label says who it is for. Guests see the meeting only, never recordings or transcripts.",
  kind: "mutation",
  input: z.object({
    name: roomName,
    hours: z.coerce
      .number()
      .refine(
        (h) => (GUEST_HOURS as readonly number[]).includes(h),
        "有效時間只能是 1、24 或 168 小時"
      ),
    label: z.string().trim().max(80, "對象最多 80 字").optional(),
  }),
  run: async (actor, input) => {
    const me = await requireAdmin(actor)
    if (!(await roomExists(input.name))) throw new Error("沒有這個會議室")
    const secret = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32))
    ).toString("base64url")
    const expiresAt = new Date(Date.now() + input.hours * 3600 * 1000)
    const id = crypto.randomUUID()
    await db.insert(guestLink).values({
      id,
      secretHash: hash(secret),
      room: input.name,
      label: input.label ?? "",
      createdBy: me.id,
      expiresAt,
    })
    return { id, url: url(secret), expiresAt }
  },
})

export const listGuestLinks = defineAction({
  name: "list_guest_links",
  title: "訪客連結列表",
  description:
    "Admins only. The guest links still working, newest first: id, room, label, expiresAt. The links themselves cannot be shown again; make a new one if it is lost.",
  kind: "query",
  input: z.object({ name: roomName.optional() }),
  run: async (actor, input) => {
    await requireAdmin(actor)
    const links = await db
      .select({
        id: guestLink.id,
        room: guestLink.room,
        label: guestLink.label,
        expiresAt: guestLink.expiresAt,
        createdAt: guestLink.createdAt,
      })
      .from(guestLink)
      .where(
        and(
          isNull(guestLink.revokedAt),
          gt(guestLink.expiresAt, new Date()),
          input.name ? eq(guestLink.room, input.name) : undefined
        )
      )
      .orderBy(desc(guestLink.createdAt))
    return { links }
  },
})

export const revokeGuestLink = defineAction({
  name: "revoke_guest_link",
  title: "撤銷訪客連結",
  description:
    "Admins only. Stops a guest link from working, by its id from list_guest_links. A guest already in the meeting stays until they leave or the host removes them.",
  kind: "mutation",
  input: z.object({ id: z.string().uuid("沒有這個訪客連結") }),
  run: async (actor, input) => {
    await requireAdmin(actor)
    const done = await db
      .update(guestLink)
      .set({ revokedAt: new Date() })
      .where(and(eq(guestLink.id, input.id), isNull(guestLink.revokedAt)))
      .returning({ id: guestLink.id })
    if (done.length === 0) throw new Error("沒有這個訪客連結")
    return { revoked: true }
  },
})

/** The working link behind a secret, or null. */
async function linkFor(secret: string) {
  const [link] = await db
    .select()
    .from(guestLink)
    .where(
      and(
        eq(guestLink.secretHash, hash(secret)),
        isNull(guestLink.revokedAt),
        gt(guestLink.expiresAt, new Date())
      )
    )
  return link ?? null
}

export const guestLinkInfo = defineAction({
  name: "guest_link_info",
  title: "訪客連結資訊",
  description:
    "For the guest page: the title of the room a guest link opens, or an error when the link is unknown, revoked or expired.",
  kind: "query",
  input: z.object({ secret: secretOf }),
  run: async (_actor, input) => {
    const link = await linkFor(input.secret)
    if (!link) throw new Error("這個訪客連結無效或已過期")
    const room = await getRoom(link.room)
    if (room) return { title: parseMetadata(room.metadata).title || link.room }
    const [row] = await db
      .select({ title: scheduledRoom.title })
      .from(scheduledRoom)
      .where(eq(scheduledRoom.name, link.room))
    return { title: row?.title ?? link.room }
  },
  mcpExcludedBecause:
    "It answers the guest page, which a person without an account opens with the secret.",
})

export const joinAsGuest = defineAction({
  name: "join_as_guest",
  title: "訪客加入",
  description:
    "For the guest page: a LiveKit token for a person without an account to join the room their guest link opens, shown as their name with （訪客）.",
  kind: "query",
  input: z.object({
    secret: secretOf,
    name: z.string().trim().min(1, "請填名字").max(40, "名字最多 40 字"),
  }),
  run: async (_actor, input): Promise<JoinState> => {
    const link = await linkFor(input.secret)
    if (!link) throw new Error("這個訪客連結無效或已過期")
    const room = await getRoom(link.room)
    let title = link.room
    let endsAt: Date | null = null
    if (room) {
      const metadata = parseMetadata(room.metadata)
      title = metadata.title || link.room
      endsAt = unstamp(metadata.until)
    } else {
      const opened = await openScheduled(link.room)
      if (!opened) throw new Error("會議已結束")
      if (opened.state !== "ready") return opened
      title = opened.title
      endsAt = opened.endsAt
    }
    // Not a user id, so nothing treats the guest as a member.
    const suffix = Buffer.from(
      crypto.getRandomValues(new Uint8Array(4))
    ).toString("hex")
    const credentials = await joinToken({
      room: link.room,
      identity: `guest-${link.id.slice(0, 8)}-${suffix}`,
      name: `${input.name}（訪客）`,
      guest: true,
      // LiveKit cannot ask whether the link still works, so the token is
      // short and never outlives the link: a revoked or expired link stops
      // new joins within minutes.
      ttlSeconds: Math.max(
        1,
        Math.min(
          GUEST_TOKEN_SECONDS,
          Math.floor((link.expiresAt.getTime() - Date.now()) / 1000)
        )
      ),
    })
    return { state: "ready", title, endsAt, ...credentials }
  },
  mcpExcludedBecause:
    "It mints a browser credential for a person without an account.",
})
