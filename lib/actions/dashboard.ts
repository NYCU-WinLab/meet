import { and, gte, inArray } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { MAX_ROOMS } from "@/lib/actions/rooms"
import { db } from "@/lib/db"
import { livekitEvent, recording } from "@/lib/db/schema"
import { activeRecordings, listRooms } from "@/lib/livekit"

const weeks = 8
const DAY = 86400 * 1000
const WEEK = 7 * DAY
const HOUR = 3600 * 1000

/** One figure this week, last week, and each of the last 8 weeks, oldest
 * first (the last entry is this week). */
export type Trend = { value: number; last: number; weekly: number[] }

export type Dashboard = {
  now: { rooms: number; maxRooms: number; members: number; recording: number }
  /** Meetings that had a member in them. */
  meetings: Trend
  /** Everyone's time in rooms, in hours. */
  memberHours: Trend
  /** Hours every slot was taken, so nobody could open another room. */
  fullHours: Trend
  /** This week: the average meeting's length and head count, and the most
   * rooms open at once. */
  thisWeek: { avgMinutes: number; avgMembers: number; peakRooms: number }
  /** Member minutes over the last 8 weeks by Taipei weekday (Monday first)
   * and hour: heat[weekday][hour]. */
  heat: number[][]
  /** This month's meetings by the group (or member) they are filed under,
   * busiest first. */
  groups: { name: string; meetings: number; minutes: number }[]
  /** This month's recordings, for the operator. */
  recordings: { count: number; bytes: number; failed: number }
}

// Calendar arithmetic in Taipei (UTC+8, no DST): shift the instant by 8 hours
// and read the UTC fields.
const local = (t: number) => new Date(t + 8 * HOUR)
const weekday = (t: number) => (local(t).getUTCDay() + 6) % 7
const hour = (t: number) => local(t).getUTCHours()

function weekStart(t: number) {
  const d = local(t)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return midnight - weekday(t) * DAY - 8 * HOUR
}

function monthStart(t: number) {
  const d = local(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 8 * HOUR
}

/** Calls add(piece start, piece length) for each part of [from, to), cut
 * where next() says the current bucket ends. */
function split(
  from: number,
  to: number,
  next: (t: number) => number,
  add: (start: number, ms: number) => void
) {
  for (let t = from; t < to;) {
    const end = Math.min(to, next(t))
    add(t, end - t)
    t = end
  }
}

const nextWeek = (t: number) => weekStart(t) + WEEK
const nextHour = (t: number) => Math.floor(t / HOUR) * HOUR + HOUR

export const dashboard = defineAction({
  name: "dashboard",
  title: "儀表板",
  description:
    "Usage figures. now: rooms open, slots (maxRooms), members in rooms, recordings running. meetings, memberHours and fullHours (hours every slot was taken): this week, last week and the last 8 weeks. thisWeek: average meeting length and head count, most rooms open at once. heat: member minutes over 8 weeks by weekday (Monday first) and hour, Taipei time. groups: this month's meetings and minutes by project group or member. recordings: this month's count, bytes and failures.",
  kind: "query",
  input: z.object({}),
  run: async (): Promise<Dashboard> => {
    const now = Date.now()
    const thisWeek = weekStart(now)
    const firstWeek = thisWeek - (weeks - 1) * WEEK
    const month = monthStart(now)
    const since = new Date(Math.min(firstWeek, month))
    const [rooms, recordingNow, rows, filed] = await Promise.all([
      listRooms(),
      activeRecordings(),
      db
        .select()
        .from(livekitEvent)
        .where(
          and(
            gte(livekitEvent.at, since),
            inArray(livekitEvent.event, [
              "room_started",
              "room_finished",
              "participant_left",
              "egress_ended",
            ])
          )
        ),
      db.select().from(recording).where(gte(recording.startedAt, since)),
    ])

    const weekIndex = (t: number) =>
      Math.floor((weekStart(t) - firstWeek) / WEEK)
    const zeros = () => Array.from({ length: weeks }, () => 0)
    const meetingsByWeek = zeros()
    const memberMsByWeek = zeros()
    const fullMsByWeek = zeros()
    const heat = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0)
    )

    // Members: their time, the heat map, and per room who came and when.
    type Meeting = { from: number; to: number; members: Set<string> }
    const meetings = new Map<string, Meeting>()
    for (const row of rows) {
      if (row.event !== "participant_left" || !row.member) continue
      const to = row.at.getTime()
      const from = to - (row.participantSeconds ?? 0) * 1000
      split(from, to, nextWeek, (t, ms) => {
        const i = weekIndex(t)
        if (i >= 0) memberMsByWeek[i] += ms
      })
      if (to >= firstWeek)
        split(Math.max(from, firstWeek), to, nextHour, (t, ms) => {
          heat[weekday(t)][hour(t)] += ms / 60000
        })
      const key = row.roomSid ?? row.room ?? ""
      const meeting = meetings.get(key) ?? { from, to, members: new Set() }
      meeting.from = Math.min(meeting.from, from)
      meeting.to = Math.max(meeting.to, to)
      if (row.participant) meeting.members.add(row.participant)
      meetings.set(key, meeting)
    }
    let weekMinutes = 0
    let weekMembers = 0
    let weekMeetings = 0
    for (const meeting of meetings.values()) {
      const i = weekIndex(meeting.to)
      if (i >= 0) meetingsByWeek[i] += 1
      if (meeting.to >= thisWeek) {
        weekMeetings += 1
        weekMinutes += (meeting.to - meeting.from) / 60000
        weekMembers += meeting.members.size
      }
    }

    // Rooms open over time: the hours all slots were taken, and the peak.
    const open = new Map<string, number>()
    const edges: { t: number; d: number }[] = []
    for (const row of rows) {
      const key = row.roomSid ?? row.room ?? ""
      if (row.event === "room_started") open.set(key, row.at.getTime())
      if (row.event === "room_finished" && open.has(key)) {
        edges.push({ t: open.get(key)!, d: 1 }, { t: row.at.getTime(), d: -1 })
        open.delete(key)
      }
    }
    for (const started of open.values())
      edges.push({ t: started, d: 1 }, { t: now, d: -1 })
    edges.sort((a, b) => a.t - b.t || a.d - b.d)
    let count = 0
    let peakRooms = rooms.length
    for (let i = 0; i < edges.length; i++) {
      count += edges[i].d
      const next = edges[i + 1]?.t ?? edges[i].t
      if (edges[i].t >= thisWeek) peakRooms = Math.max(peakRooms, count)
      if (count >= MAX_ROOMS)
        split(edges[i].t, next, nextWeek, (t, ms) => {
          const w = weekIndex(t)
          if (w >= 0) fullMsByWeek[w] += ms
        })
    }

    // Groups and recordings this month.
    const groups = new Map<string, { rooms: Set<string>; minutes: number }>()
    let bytes = 0
    let recordingCount = 0
    for (const rec of filed) {
      if (rec.startedAt.getTime() < month) continue
      bytes += rec.bytes
      recordingCount += 1
      // Rooms opened outside meet (lk tests) have no opener; skip them here.
      const name = rec.group || rec.opener
      if (!name) continue
      const group = groups.get(name) ?? { rooms: new Set(), minutes: 0 }
      group.rooms.add(rec.booking || rec.room)
      group.minutes += (rec.endedAt.getTime() - rec.startedAt.getTime()) / 60000
      groups.set(name, group)
    }
    const failed = rows.filter(
      (row) =>
        row.event === "egress_ended" &&
        row.egressStatus !== "EGRESS_COMPLETE" &&
        row.at.getTime() >= month
    ).length

    const trend = (weekly: number[], scale = 1): Trend => {
      const values = weekly.map((v) => Math.round((v / scale) * 10) / 10)
      return {
        value: values[weeks - 1],
        last: values[weeks - 2],
        weekly: values,
      }
    }
    return {
      now: {
        rooms: rooms.length,
        maxRooms: MAX_ROOMS,
        members: rooms.reduce((n, room) => n + room.participants.length, 0),
        recording: recordingNow,
      },
      meetings: trend(meetingsByWeek),
      memberHours: trend(memberMsByWeek, HOUR),
      fullHours: trend(fullMsByWeek, HOUR),
      thisWeek: {
        avgMinutes: weekMeetings ? Math.round(weekMinutes / weekMeetings) : 0,
        avgMembers: weekMeetings
          ? Math.round((weekMembers / weekMeetings) * 10) / 10
          : 0,
        peakRooms,
      },
      heat: heat.map((row) => row.map(Math.round)),
      groups: [...groups.entries()]
        .map(([name, g]) => ({
          name,
          meetings: g.rooms.size,
          minutes: Math.round(g.minutes),
        }))
        .sort((a, b) => b.minutes - a.minutes),
      recordings: { count: recordingCount, bytes, failed },
    }
  },
})
