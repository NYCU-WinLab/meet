"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { WeekStats } from "@/lib/actions/dashboard"

// A row of figures: the number large, what it counts under it.
export function Figures({
  items,
}: {
  items: { label: string; value: number }[]
}) {
  return (
    <dl className="grid grid-cols-3 gap-6 sm:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col">
          <dd className="text-title font-medium tabular-nums">
            {item.value.toLocaleString("en-US")}
          </dd>
          <dt className="text-muted-foreground">{item.label}</dt>
        </div>
      ))}
    </dl>
  )
}

const config = {
  meetings: { label: "會議", color: "primary" },
  recordings: { label: "錄影", color: "primary-3" },
  memberMinutes: { label: "人分鐘", color: "muted-foreground" },
} satisfies ChartConfig

const label = (week: string) => {
  const [, m, d] = week.split("-")
  return `${Number(m)}/${Number(d)}`
}

// The last weeks side by side: how many meetings and recordings, and the
// minutes members spent, each week starting on its Monday.
export function WeeklyChart({ weeks }: { weeks: WeekStats[] }) {
  const data = weeks.map((week) => ({ ...week, week: label(week.week) }))
  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <ChartContainer config={config} className="h-64 w-full">
        <BarChart data={data} barGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="meetings"
            fill="var(--color-meetings)"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="recordings"
            fill="var(--color-recordings)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
      <ChartContainer config={config} className="h-64 w-full">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <ChartTooltip
            content={<ChartTooltipContent formatValue={(v) => `${v} 分鐘`} />}
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="memberMinutes"
            fill="var(--color-memberMinutes)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}
