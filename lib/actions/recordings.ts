import { and, asc, desc, eq, ilike, inArray, lte, or, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction, type Actor } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  livekitEvent,
  recording,
  transcriptIndex,
  transcriptSegment,
  user,
} from "@/lib/db/schema"
import { gitlabConfigured, recordUrl } from "@/lib/gitlab"
import {
  folderFiles,
  nextcloudConfigured,
  openFile,
  readText,
} from "@/lib/nextcloud"
import { emitErrorLog } from "@/lib/otel"
import { groupMembers } from "@/lib/portal"
import { parseSrt } from "@/lib/srt"

/** A stretch with no member in the room, in seconds. */
export type Gap = { from: number; to: number }

type Presence = {
  event: string
  at: number
  participant: string | null
  member: boolean | null
  /** On participant_left: how long they had stayed. */
  seconds?: number | null
}

// Rows from before the member column was kept: the recorder joins as EG_…
// and the summary service as "summary"; everyone else is a member.
const isMember = (row: Presence) =>
  row.member ??
  (!!row.participant &&
    !row.participant.startsWith("EG_") &&
    row.participant !== "summary")

/**
 * The stretches between from and to when no member was in the room, from
 * the room's join and leave events in order. A member who reconnects joins
 * twice before the old session leaves, so each identity keeps a count.
 */
export function emptySpans(rows: Presence[], from: number, to: number) {
  const here = new Map<string, number>()
  const present = () => [...here.values()].some((n) => n > 0)
  const gaps: Gap[] = []
  let emptySince: number | null = null
  const mark = (at: number) => {
    if (present()) {
      if (emptySince !== null && at > emptySince)
        gaps.push({ from: emptySince, to: at })
      emptySince = null
    } else if (emptySince === null) emptySince = Math.max(at, from)
  }
  // Events before from only set who is there when the recording starts.
  let started = false
  for (const row of rows) {
    if (!row.participant || !isMember(row)) continue
    if (!started && row.at >= from) {
      mark(from)
      started = true
    }
    const n = here.get(row.participant) ?? 0
    here.set(
      row.participant,
      row.event === "participant_joined" ? n + 1 : Math.max(0, n - 1)
    )
    if (started) mark(Math.min(row.at, to))
  }
  if (!started) mark(from)
  if (emptySince !== null && to > emptySince)
    gaps.push({ from: emptySince, to })
  // A leave also says how long that member stayed, so a lost join still
  // shows them there: take those stretches out of the gaps.
  let left = gaps
  for (const row of rows) {
    if (row.event !== "participant_left" || !row.seconds || !isMember(row))
      continue
    const here = { from: row.at - row.seconds - 1, to: row.at + 1 }
    left = left.flatMap((gap) =>
      here.to <= gap.from || here.from >= gap.to
        ? [gap]
        : [
            { from: gap.from, to: here.from },
            { from: here.to, to: gap.to },
          ].filter((part) => part.to > part.from)
    )
  }
  return left
}

export const recordingGaps = defineAction({
  name: "recording_gaps",
  title: "錄影空檔",
  description:
    "For the egress uploader: the stretches of one finished recording (by egress id) when no member was in the room, as [{from, to}] in seconds from the file's first frame, so the recording can be cut to the time people were there. ready is false until LiveKit has reported the recording ended. Service callers only.",
  kind: "query",
  input: z.object({ egress: z.string().min(1).max(100) }),
  async run(actor, { egress }) {
    if (!actor.service) throw new Error("只給錄影上傳服務用")
    const [ended] = await db
      .select({
        room: livekitEvent.room,
        startedAt: livekitEvent.egressFileStartedAt,
        seconds: livekitEvent.egressSeconds,
      })
      .from(livekitEvent)
      .where(
        and(
          eq(livekitEvent.egressId, egress),
          eq(livekitEvent.event, "egress_ended")
        )
      )
      .limit(1)
    if (!ended?.room || !ended.startedAt || !ended.seconds)
      return { ready: false, gaps: [] as Gap[] }
    // The file's own clock, in ms: the egress's start is seconds earlier.
    const start = ended.startedAt.getTime() / 1000
    const from = Math.floor(start)
    const to = Math.ceil(start + ended.seconds)
    const rows = await db
      .select({
        event: livekitEvent.event,
        at: livekitEvent.at,
        participant: livekitEvent.participant,
        member: livekitEvent.member,
        seconds: livekitEvent.participantSeconds,
      })
      .from(livekitEvent)
      .where(
        and(
          eq(livekitEvent.room, ended.room),
          inArray(livekitEvent.event, [
            "participant_joined",
            "participant_left",
          ]),
          lte(livekitEvent.at, new Date(to * 1000))
        )
      )
      .orderBy(asc(livekitEvent.at))
    const presence = rows.map((row) => ({
      ...row,
      at: Math.floor(row.at.getTime() / 1000),
    }))
    // Events are stamped to the second: round a gap inward so it never
    // takes in a second someone was there.
    const gaps = emptySpans(presence, from, to)
      .map((gap) => ({
        from: Math.max(0, Math.ceil(gap.from + 1 - start)),
        to: Math.floor(gap.to - start),
      }))
      .filter((gap) => gap.to > gap.from)
    return { ready: true, gaps }
  },
})

// ---- A member's own recordings ------------------------------------------
//
// Filed by the egress uploader (file_recording) once the MP4 is in
// Nextcloud. A member may open a recording when they were in the room
// while it ran, when it is filed under a project group they are in, or
// when they opened or booked the room.

export type Recording = typeof recording.$inferSelect

const id = z.string().min(1).max(200)

export const fileRecording = defineAction({
  name: "file_recording",
  title: "登記錄影",
  description:
    "For the egress uploader: records where a finished recording was filed in Nextcloud (folder <YYYY-MM>/<stem>) and whose meeting it was, so members can find it. Repeating it for the same id updates the row. Egress service only.",
  kind: "mutation",
  input: z.object({
    id,
    room: z.string().min(1).max(100),
    title: z.string().max(200).default(""),
    group: z.string().max(64).default(""),
    opener: z.string().max(64).default(""),
    booking: z.string().max(64).default(""),
    folder: z
      .string()
      .min(1)
      .max(400)
      .refine(
        (f) => /^\d{4}-\d{2}\/[^/]+$/.test(f) && !f.includes("/.."),
        "資料夾格式不對"
      ),
    stem: z
      .string()
      .min(1)
      .max(300)
      .refine((s) => !s.includes("/")),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date(),
    bytes: z.coerce.number().int().min(0).default(0),
  }),
  async run(actor, input) {
    if (actor.service !== "egress") throw new Error("只給錄影上傳服務用")
    const row = { ...input, title: input.title || input.room }
    await db
      .insert(recording)
      .values(row)
      .onConflictDoUpdate({
        target: recording.id,
        set: { ...row, filedAt: new Date() },
      })
    return { ok: true }
  },
})

async function username(actor: Actor) {
  if (!actor.userId || actor.service) throw new Error("只給成員用")
  const [row] = await db
    .select({ username: user.username })
    .from(user)
    .where(eq(user.id, actor.userId))
  if (!row) throw new Error("找不到這個成員")
  return row.username ?? ""
}

/** The project groups this member is in; none when portal does not answer. */
async function myGroups(name: string) {
  if (!name) return [] as string[]
  try {
    const groups = await groupMembers()
    return [...groups].filter(([, m]) => m.includes(name)).map(([g]) => g)
  } catch (error) {
    emitErrorLog(error, { source: "portal groups" })
    return []
  }
}

/** The stretches this member was in each room, as [from, to] in ms. A join
 * ends at the member's leave, or at room_finished of the same room session.
 * A join with neither (a lost webhook) counts only at its own moment, so a
 * lost leave never stretches into a later recording of the room. */
async function presence(userId: string, rooms: string[]) {
  const spans = new Map<string, [number, number][]>()
  if (rooms.length === 0) return spans
  const rows = await db
    .select({
      event: livekitEvent.event,
      at: livekitEvent.at,
      room: livekitEvent.room,
      roomSid: livekitEvent.roomSid,
      participant: livekitEvent.participant,
      seconds: livekitEvent.participantSeconds,
    })
    .from(livekitEvent)
    .where(
      and(
        inArray(livekitEvent.room, rooms),
        or(
          and(
            eq(livekitEvent.participant, userId),
            inArray(livekitEvent.event, [
              "participant_joined",
              "participant_left",
            ])
          ),
          eq(livekitEvent.event, "room_finished")
        )
      )
    )
    .orderBy(asc(livekitEvent.at))
  const open = new Map<string, { from: number; sid: string | null }>()
  const add = (room: string, from: number, to: number) =>
    spans.set(room, [...(spans.get(room) ?? []), [from, to]])
  for (const row of rows) {
    if (!row.room) continue
    const at = row.at.getTime()
    const held = open.get(row.room)
    if (row.event === "room_finished") {
      // Only the session this join was in; with no sid on either side, the
      // room closing still ends it.
      if (held && (!held.sid || !row.roomSid || held.sid === row.roomSid)) {
        add(row.room, held.from, at)
        open.delete(row.room)
      }
    } else if (row.event === "participant_joined") {
      // A second join before any leave: the first one's end was lost.
      if (held) add(row.room, held.from, held.from)
      open.set(row.room, { from: at, sid: row.roomSid })
    } else {
      // A leave also says how long they stayed, so a lost join still counts.
      const from = held?.from ?? at - (row.seconds ?? 0) * 1000
      add(row.room, from, at)
      open.delete(row.room)
    }
  }
  for (const [room, held] of open) add(room, held.from, held.from)
  return spans
}

const attended = (
  spans: [number, number][] | undefined,
  rec: Pick<Recording, "startedAt" | "endedAt">
) =>
  (spans ?? []).some(
    ([from, to]) =>
      from <= rec.endedAt.getTime() && to >= rec.startedAt.getTime()
  )

/** Why this member may open the recording, or null. */
async function access(actor: Actor, rec: Recording) {
  const name = await username(actor)
  if (name && rec.opener === name) return "opener"
  if (rec.group && (await myGroups(name)).includes(rec.group)) return "group"
  const spans = await presence(actor.userId, [rec.room])
  return attended(spans.get(rec.room), rec) ? "attended" : null
}

async function mine(actor: Actor, recordingId: string) {
  const [rec] = await db
    .select()
    .from(recording)
    .where(eq(recording.id, recordingId))
  // Not there and not yours answer the same, so ids cannot be probed.
  if (!rec || !(await access(actor, rec))) throw new Error("找不到這個錄影")
  return rec
}

/** The recordings this member may open, newest first: rooms they opened
 * or booked, their project groups' rooms, and rooms they were in while the
 * recording ran. */
async function visibleRecordings(userId: string, name: string) {
  const groups = await myGroups(name)
  const joined = await db
    .selectDistinct({ room: livekitEvent.room })
    .from(livekitEvent)
    .where(
      and(
        eq(livekitEvent.participant, userId),
        inArray(livekitEvent.event, ["participant_joined", "participant_left"])
      )
    )
  const rooms = joined.flatMap((r) => (r.room ? [r.room] : []))
  const conditions = [
    ...(name ? [eq(recording.opener, name)] : []),
    ...(groups.length ? [inArray(recording.group, groups)] : []),
    ...(rooms.length ? [inArray(recording.room, rooms)] : []),
  ]
  if (conditions.length === 0) return []
  const rows = await db
    .select()
    .from(recording)
    .where(or(...conditions))
    .orderBy(desc(recording.startedAt))
  const spans = await presence(userId, rooms)
  return rows.filter(
    (rec) =>
      (name && rec.opener === name) ||
      (rec.group && groups.includes(rec.group)) ||
      attended(spans.get(rec.room), rec)
  )
}

export const listMyRecordings = defineAction({
  name: "list_my_recordings",
  title: "我的會議紀錄",
  description:
    "The signed-in member's meeting recordings, newest first: the ones of rooms they were in while it recorded, of project groups they are in, and of rooms they opened or booked. Each has id, title, group, opener, startedAt, endedAt and bytes; get_recording gives its files, notes and GitLab record.",
  kind: "query",
  input: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
  async run(actor, { limit }) {
    const rows = await visibleRecordings(actor.userId, await username(actor))
    const recordings = rows.slice(0, limit).map((rec) => ({
      id: rec.id,
      title: rec.title,
      group: rec.group,
      opener: rec.opener,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      bytes: rec.bytes,
    }))
    return { recordings }
  },
})

/** The record keys winlab-helper stamps on this recording's GitLab record. */
function recordKeys(rec: Recording) {
  if (rec.booking) return [rec.booking]
  const owner = rec.group || rec.opener
  if (!owner) return []
  const day = taipeiDay(rec.startedAt)
  return [`meet:${owner}:${day}:${rec.id}`, `meet:${owner}:${day}`]
}

const taipeiDay = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date)

/** The name winlab-helper gives the recording in its record. */
function recordFile(rec: Recording) {
  const owner = rec.group || rec.opener
  if (!owner) return undefined
  return {
    fileName: `[${owner}] ${taipeiDay(rec.startedAt)} ${rec.title}.mp4`,
    title: rec.title,
    since: rec.startedAt,
  }
}

export const getRecording = defineAction({
  name: "get_recording",
  title: "會議紀錄",
  description:
    "One of the member's recordings (id from list_my_recordings): title, group, opener, times, the files in its folder (MP4, transcript .txt, subtitles .srt, notes .notes.md) with sizes, the notes as Markdown (null until transcribed), and the GitLab meeting record's URL (null until winlab-helper filed it). Download a file on the page at /api/recordings/<id>/<file name>.",
  kind: "query",
  input: z.object({ id }),
  async run(actor, { id: recordingId }) {
    const rec = await mine(actor, recordingId)
    const [files, notes, gitlab] = await Promise.all([
      nextcloudConfigured()
        ? folderFiles(rec.folder).catch((error) => {
            emitErrorLog(error, { source: "nextcloud folder" })
            return null
          })
        : null,
      nextcloudConfigured()
        ? readText(`${rec.folder}/${rec.stem}.notes.md`).catch((error) => {
            emitErrorLog(error, { source: "nextcloud notes" })
            return null
          })
        : null,
      gitlabConfigured()
        ? recordUrl(recordKeys(rec), recordFile(rec)).catch((error) => {
            emitErrorLog(error, { source: "gitlab record" })
            return null
          })
        : null,
    ])
    return {
      id: rec.id,
      title: rec.title,
      group: rec.group,
      opener: rec.opener,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      bytes: rec.bytes,
      files,
      notes,
      gitlab,
    }
  },
})

export const recordingFile = defineAction({
  name: "recording_file",
  title: "下載錄影檔",
  description:
    "Streams one file of a recording's folder to the member's browser.",
  kind: "query",
  mcpExcludedBecause:
    "It returns a file stream for /api/recordings, not data an agent reads; get_recording lists the files and gives the notes.",
  input: z.object({
    id,
    file: z
      .string()
      .min(1)
      .max(300)
      .refine((f) => !f.includes("/") && f !== "." && f !== ".."),
    range: z.string().max(100).nullish(),
  }),
  async run(actor, { id: recordingId, file, range }) {
    const rec = await mine(actor, recordingId)
    // Only files of this recording: its stem and an extension.
    if (!file.startsWith(`${rec.stem}.`)) throw new Error("找不到這個檔案")
    const response = await openFile(`${rec.folder}/${file}`, range)
    if (!response) throw new Error("找不到這個檔案")
    return response
  },
})

// ---- Search across meetings -----------------------------------------------
//
// Subtitles are read into transcript_segments the first time a search
// covers the recording, a few recordings per search so one search stays
// fast; a recording not transcribed yet (or Nextcloud failing) waits 10
// minutes before it is tried again, so it never holds older recordings back,
// and is given up (indexed with 0 lines) 2 days after it ended.

const INDEX_PER_SEARCH = 8
const GIVE_UP_MS = 2 * 24 * 60 * 60 * 1000
const RETRY_MS = 10 * 60 * 1000
/** Recording id → when it may be tried again (this process only). */
const notBefore = new Map<string, number>()

async function indexTranscripts(recs: Recording[]) {
  if (!nextcloudConfigured() || recs.length === 0) return
  const done = new Set(
    (
      await db
        .select({ id: transcriptIndex.recordingId })
        .from(transcriptIndex)
        .where(
          inArray(
            transcriptIndex.recordingId,
            recs.map((r) => r.id)
          )
        )
    ).map((r) => r.id)
  )
  const now = Date.now()
  const todo = recs
    .filter((r) => !done.has(r.id) && (notBefore.get(r.id) ?? 0) <= now)
    .slice(0, INDEX_PER_SEARCH)
  const later = (id: string) => notBefore.set(id, Date.now() + RETRY_MS)
  await Promise.all(
    todo.map(async (rec) => {
      const source = await readText(
        `${rec.folder}/${rec.stem}.srt`,
        5_000_000
      ).catch((error) => {
        emitErrorLog(error, { source: "nextcloud srt" })
        return undefined
      })
      if (source === undefined) return later(rec.id)
      if (source === null && Date.now() - rec.endedAt.getTime() < GIVE_UP_MS)
        return later(rec.id)
      notBefore.delete(rec.id)
      const cues = source ? parseSrt(source) : []
      // One search indexes a recording at a time: the lock is held to the
      // end of the transaction, and a second search finds it done.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`transcript:${rec.id}`}))`
        )
        const [already] = await tx
          .select({ id: transcriptIndex.recordingId })
          .from(transcriptIndex)
          .where(eq(transcriptIndex.recordingId, rec.id))
        if (already) return
        await tx
          .delete(transcriptSegment)
          .where(eq(transcriptSegment.recordingId, rec.id))
        for (let i = 0; i < cues.length; i += 500)
          await tx
            .insert(transcriptSegment)
            .values(
              cues
                .slice(i, i + 500)
                .map((cue) => ({ recordingId: rec.id, ...cue }))
            )
        await tx
          .insert(transcriptIndex)
          .values({ recordingId: rec.id, segments: cues.length })
          .onConflictDoNothing()
      })
    })
  )
}

const likePattern = (query: string) =>
  `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** The recordings a search covers. A member searches their own. The
 * summary service answers @agent in a chat everyone in the room reads, so it
 * names everyone there and searches only what all of them may open. */
async function searchable(actor: Actor, asUsers?: string[]) {
  if (!actor.service) {
    if (asUsers) throw new Error("只給摘要服務用")
    return visibleRecordings(actor.userId, await username(actor))
  }
  if (actor.service !== "summary" || !asUsers?.length)
    throw new Error("只給成員或摘要服務用")
  const ids = [...new Set(asUsers)]
  const rows = await db
    .select({ id: user.id, username: user.username })
    .from(user)
    .where(inArray(user.id, ids))
  // Someone in the room who is not a member: nothing is safe to show.
  if (rows.length !== ids.length) return []
  const each = await Promise.all(
    rows.map((row) => visibleRecordings(row.id, row.username ?? ""))
  )
  const shared = each
    .slice(1)
    .reduce(
      (keep, recs) =>
        new Set(recs.filter((r) => keep.has(r.id)).map((r) => r.id)),
      new Set(each[0].map((r) => r.id))
    )
  return each[0].filter((r) => shared.has(r.id))
}

export const searchRecordings = defineAction({
  name: "search_recordings",
  title: "搜尋會議紀錄",
  description:
    "Finds what was said in the member's past meetings: lines of the recordings' transcripts (and titles) that contain the query, newest meeting first. Each hit has the recording id and title, when the meeting started, the second the line starts at, the line, and a url that opens the recording at that second. Only recordings the member may open are searched.",
  kind: "query",
  input: z.object({
    query: z.string().trim().min(1).max(100),
    limit: z.number().int().min(1).max(50).default(20),
    /** For the summary service only: everyone in the room. */
    asUsers: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  }),
  async run(actor, { query, limit, asUsers }) {
    const recs = await searchable(actor, asUsers)
    if (recs.length === 0) return { hits: [] }
    await indexTranscripts(recs)
    const byId = new Map(recs.map((r) => [r.id, r]))
    const pattern = likePattern(query)
    const lines = await db
      .select({
        recordingId: transcriptSegment.recordingId,
        startMs: transcriptSegment.startMs,
        text: transcriptSegment.text,
      })
      .from(transcriptSegment)
      .innerJoin(recording, eq(recording.id, transcriptSegment.recordingId))
      .where(
        and(
          inArray(transcriptSegment.recordingId, [...byId.keys()]),
          ilike(transcriptSegment.text, pattern)
        )
      )
      .orderBy(desc(recording.startedAt), asc(transcriptSegment.startMs))
      .limit(limit)
    const lower = query.toLowerCase()
    const titled = recs
      .filter((r) => r.title.toLowerCase().includes(lower))
      .map((r) => ({ recordingId: r.id, startMs: 0, text: r.title }))
    const hits = [...titled, ...lines].slice(0, limit).map((hit) => {
      const rec = byId.get(hit.recordingId)!
      const second = Math.floor(hit.startMs / 1000)
      return {
        recordingId: rec.id,
        title: rec.title,
        startedAt: rec.startedAt,
        second,
        text: hit.text,
        url: `/recordings/${encodeURIComponent(rec.id)}?t=${second}`,
      }
    })
    return { hits }
  },
})
