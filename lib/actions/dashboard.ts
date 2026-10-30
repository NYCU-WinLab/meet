import { and, gte, inArray } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { livekitEvent } from "@/lib/db/schema"
import { activeRecordings, listRooms } from "@/lib/livekit"

const tz = "Asia/Taipei"
const weeks = 8

export type PeriodStats = {
  meetings: number
  /** Everyone's time in rooms, in minutes. */
  memberMinutes: number
  recordings: number
  recordingMinutes: number
  recordingBytes: number
  failedRecordings: number
}

export type WeekStats = PeriodStats & {
  /** The Monday the week starts, YYYY-MM-DD in Taipei. */
  week: string
}

export type Dashboard = {
  now: { rooms: number; members: number; recording: number }
  thisWeek: PeriodStats
  thisMonth: PeriodStats
  weekly: WeekStats[]
}

const emptyStats = (): PeriodStats => ({
  meetings: 0,
  memberMinutes: 0,
  recordings: 0,
  recordingMinutes: 0,
  recordingBytes: 0,
  failedRecordings: 0,
})

// Calendar arithmetic in Taipei: the date parts, then the Monday of the
// week and the first of the month as local midnight.
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    get("weekday")
  )
  return { y: +get("year"), m: +get("month"), d: +get("day"), weekday }
}

/** Local midnight of y-m-d in Taipei as an instant (UTC+8, no DST). */
const localMidnight = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d) - 8 * 3600 * 1000)

function weekStart(date: Date) {
  const { y, m, d, weekday } = localParts(date)
  return localMidnight(y, m, d - weekday)
}

const isoDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date)

type Row = typeof livekitEvent.$inferSelect

function add(stats: PeriodStats, row: Row) {
  if (row.event === "room_finished") stats.meetings += 1
  if (row.event === "participant_left")
    stats.memberMinutes += (row.participantSeconds ?? 0) / 60
  if (row.event === "egress_ended") {
    if (row.egressStatus === "EGRESS_COMPLETE") {
      stats.recordings += 1
      stats.recordingMinutes += (row.egressSeconds ?? 0) / 60
      stats.recordingBytes += row.egressBytes ?? 0
    } else {
      stats.failedRecordings += 1
    }
  }
}

const round = (stats: PeriodStats): PeriodStats => ({
  ...stats,
  memberMinutes: Math.round(stats.memberMinutes),
  recordingMinutes: Math.round(stats.recordingMinutes),
})

export const dashboard = defineAction({
  name: "dashboard",
  title: "儀表板",
  description:
    "Usage figures: rooms, members and recordings in progress right now; meetings, member minutes and recordings this week, this month and per week for the last 8 weeks.",
  kind: "query",
  input: z.object({}),
  run: async (): Promise<Dashboard> => {
    const now = new Date()
    const { y, m } = localParts(now)
    const thisWeekStart = weekStart(now)
    const thisMonthStart = localMidnight(y, m, 1)
    const since = new Date(
      Math.min(
        thisMonthStart.getTime(),
        thisWeekStart.getTime() - (weeks - 1) * 7 * 86400 * 1000
      )
    )
    const [rooms, recording, rows] = await Promise.all([
      listRooms(),
      activeRecordings(),
      db
        .select()
        .from(livekitEvent)
        .where(
          and(
            gte(livekitEvent.at, since),
            inArray(livekitEvent.event, [
              "room_finished",
              "participant_left",
              "egress_ended",
            ])
          )
        ),
    ])

    const thisWeek = emptyStats()
    const thisMonth = emptyStats()
    const byWeek = new Map<string, WeekStats>()
    for (let i = weeks - 1; i >= 0; i--) {
      const start = new Date(thisWeekStart.getTime() - i * 7 * 86400 * 1000)
      byWeek.set(isoDate(start), { week: isoDate(start), ...emptyStats() })
    }
    for (const row of rows) {
      if (row.at >= thisWeekStart) add(thisWeek, row)
      if (row.at >= thisMonthStart) add(thisMonth, row)
      const week = byWeek.get(isoDate(weekStart(row.at)))
      if (week) add(week, row)
    }
    return {
      now: {
        rooms: rooms.length,
        members: rooms.reduce((n, room) => n + room.participants.length, 0),
        recording,
      },
      thisWeek: round(thisWeek),
      thisMonth: round(thisMonth),
      weekly: [...byWeek.values()].map((week) => ({
        ...week,
        ...round(week),
      })),
    }
  },
})
