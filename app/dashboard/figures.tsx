"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  LabelList,
  XAxis,
  YAxis,
} from "recharts"

import { type ChartConfig, ChartContainer } from "@/components/ui/chart"
import type { Trend } from "@/lib/actions/dashboard"

const sparkConfig = {
  value: { label: "每週", color: "primary" },
} satisfies ChartConfig

/** The change since last week in percent, or last week's zero. */
function versus({ value, last }: Trend) {
  if (last === 0) return `上週 0`
  const change = Math.round(((value - last) / last) * 100)
  return `比上週 ${change >= 0 ? "+" : ""}${change}%`
}

// One question answered by one number: this week's figure, how it moved
// since last week, a line under it for the last 8 weeks, and a note.
export function TrendCard({
  label,
  unit,
  trend,
  note,
}: {
  label: string
  unit: string
  trend: Trend
  note?: string
}) {
  const data = trend.weekly.map((value, week) => ({ week, value }))
  return (
    <div className="flex flex-col gap-3 rounded-surface bg-muted p-6">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-title font-medium tabular-nums">
          {trend.value.toLocaleString("en-US")}
        </span>
        <span className="text-muted-foreground">{unit}</span>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {versus(trend)}
        </span>
      </div>
      <ChartContainer config={sparkConfig} className="h-12 w-full">
        <AreaChart
          data={data}
          margin={{ top: 2, bottom: 2, left: 0, right: 0 }}
        >
          <Area
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            fill="var(--color-value)"
            fillOpacity={0.15}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
      {note && <span className="text-muted-foreground">{note}</span>}
    </div>
  )
}

const days = ["一", "二", "三", "四", "五", "六", "日"]

// Five shades from empty to busiest, so the map needs no inline color.
const shades = [
  "bg-muted",
  "bg-primary/20",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
]

// When members meet: weekday rows, hour columns, darker where more member
// minutes fell over the last 8 weeks.
export function Heatmap({ heat }: { heat: number[][] }) {
  const max = Math.max(1, ...heat.flat())
  const shade = (minutes: number) =>
    minutes > 0
      ? shades[Math.max(1, Math.ceil((minutes / max) * 4))]
      : shades[0]
  return (
    <div className="flex flex-col gap-1 overflow-x-auto">
      {heat.map((row, d) => (
        <div key={d} className="flex items-center gap-1">
          <span className="w-6 shrink-0 text-muted-foreground">{days[d]}</span>
          {row.map((minutes, h) => (
            <div
              key={h}
              title={`週${days[d]} ${h}:00，${minutes} 人分鐘`}
              className={`aspect-square min-w-3 flex-1 ${shade(minutes)}`}
            />
          ))}
        </div>
      ))}
      <div className="flex items-center gap-1">
        <span className="w-6 shrink-0" />
        {Array.from({ length: 24 }, (_, h) => (
          <span
            key={h}
            className="min-w-3 flex-1 text-center text-muted-foreground tabular-nums"
          >
            {h % 6 === 0 ? h : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

const groupConfig = {
  hours: { label: "小時", color: "primary" },
} satisfies ChartConfig

// Who uses the rooms: one bar per group by its hours this month, with the
// meeting count beside it.
export function GroupBars({
  groups,
}: {
  groups: { label: string; meetings: number; minutes: number }[]
}) {
  if (groups.length === 0)
    return <p className="text-muted-foreground">本月還沒有會議</p>
  const data = groups.map((g) => ({
    label: g.label,
    hours: Math.round((g.minutes / 60) * 10) / 10,
    note: `${g.meetings} 場、${Math.round((g.minutes / 60) * 10) / 10} 小時`,
  }))
  return (
    <ChartContainer
      config={groupConfig}
      className={groups.length > 4 ? "h-80 w-full" : "h-48 w-full"}
    >
      <BarChart data={data} layout="vertical" margin={{ right: 120 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <Bar dataKey="hours" fill="var(--color-hours)" radius={4} barSize={12}>
          <LabelList
            dataKey="note"
            position="right"
            className="fill-muted-foreground"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
