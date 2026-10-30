"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

/** The only colors a series may take (DESIGN.md, Color): the main series,
 * a comparison, a series whose meaning is a state, or one of up to six
 * series of the same kind stacked into one total (primary, then primary-2
 * to primary-6, each lighter). */
export type ChartColor =
  | "primary"
  | "muted-foreground"
  | "success"
  | "destructive"
  | "warning"
  | PrimaryShade

type PrimaryShade = `primary-${2 | 3 | 4 | 5 | 6}`

// How much primary each shade keeps, mixed toward the page background so
// the steps hold in both themes.
const shadeMix = { 2: 80, 3: 64, 4: 50, 5: 38, 6: 28 } as const

/** Colors for n stacked series of the same kind, darkest first. Past six,
 * merge the rest into one series (其他) in muted-foreground. */
export const primaryShades: ChartColor[] = [
  "primary",
  "primary-2",
  "primary-3",
  "primary-4",
  "primary-5",
  "primary-6",
]

function colorValue(color: ChartColor) {
  const shade = /^primary-(\d)$/.exec(color)
  if (!shade) return `var(--${color})`
  const mix = shadeMix[Number(shade[1]) as keyof typeof shadeMix]
  return `color-mix(in oklch, var(--primary) ${mix}%, var(--background))`
}

/** One entry per series, keyed by its dataKey: what to call it and its
 * color. The key becomes --color-<key> inside the chart, so it must be a
 * CSS name: key series by position (s0, s1) when names hold "." or spaces. */
export type ChartConfig = Record<string, { label: string; color: ChartColor }>

const ChartContext = React.createContext<ChartConfig | null>(null)

function useChart() {
  const config = React.useContext(ChartContext)
  if (!config) throw new Error("Chart parts must sit inside <ChartContainer>")
  return config
}

// Recharts in WinLab colors and type: axes and grid recede in muted ink,
// series come from the config, and the chart fills its container's width.
// Give it a height (className="h-64"); recharts measures the box.
function ChartContainer({
  config,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
}) {
  const id = React.useId().replace(/:/g, "")
  const variables = Object.entries(config)
    .map(([key, series]) => `--color-${key}: ${colorValue(series.color)};`)
    .join(" ")
  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        data-series-scope={id}
        className={cn(
          "flex aspect-video w-full justify-center text-body [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_line]:stroke-border [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <style>{`[data-series-scope=${id}] { ${variables} }`}</style>
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

// A series' dot, filled from its --color-<key>.
function Swatch({ seriesKey }: { seriesKey: string }) {
  return (
    <svg aria-hidden viewBox="0 0 10 10" className="size-2.5 shrink-0">
      <circle cx="5" cy="5" r="5" fill={`var(--color-${seriesKey})`} />
    </svg>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

type TooltipItem = {
  dataKey?: string | number
  name?: string | number
  value?: number | string | ReadonlyArray<number | string>
  color?: string
}

// The hover card: inverted like every WinLab tooltip, the hovered x value
// on top, then one row per series with its swatch, label and value.
function ChartTooltipContent({
  active,
  payload,
  label,
  formatLabel,
  formatValue,
}: {
  active?: boolean
  payload?: ReadonlyArray<TooltipItem>
  label?: string | number
  /** The heading, from the hovered x value. */
  formatLabel?: (label: string | number) => React.ReactNode
  /** Each series value, e.g. as NT$. */
  formatValue?: (value: number, key: string) => React.ReactNode
}) {
  const config = useChart()
  if (!active || !payload?.length) return null
  return (
    <div
      data-slot="chart-tooltip"
      className="flex min-w-32 flex-col gap-1 rounded-control bg-foreground px-3 py-2 text-body text-background"
    >
      {label !== undefined && (
        <span className="font-medium">
          {formatLabel ? formatLabel(label) : label}
        </span>
      )}
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.name ?? "")
        const value = Number(item.value ?? 0)
        return (
          <span key={key} className="flex items-center gap-2">
            <Swatch seriesKey={key} />
            <span className="flex-1 opacity-70">
              {config[key]?.label ?? key}
            </span>
            <span className="font-medium tabular-nums">
              {formatValue ? formatValue(value, key) : value.toLocaleString()}
            </span>
          </span>
        )
      })}
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

// Series names under the chart, each beside its swatch, so a series is
// never told apart by color alone.
function ChartLegendContent({
  payload,
  className,
}: {
  payload?: ReadonlyArray<{ dataKey?: string | number; value?: string }>
  className?: string
}) {
  const config = useChart()
  if (!payload?.length) return null
  // In the config's order, whatever order recharts hands them over in.
  const order = Object.keys(config)
  const items = [...payload].sort(
    (a, b) =>
      order.indexOf(String(a.dataKey ?? a.value)) -
      order.indexOf(String(b.dataKey ?? b.value))
  )
  return (
    <div
      data-slot="chart-legend"
      className={cn(
        "flex flex-wrap items-center justify-center gap-4 pt-4 text-muted-foreground",
        className
      )}
    >
      {items.map((item) => {
        const key = String(item.dataKey ?? item.value ?? "")
        return (
          <span key={key} className="flex items-center gap-2">
            <Swatch seriesKey={key} />
            {config[key]?.label ?? key}
          </span>
        )
      })}
    </div>
  )
}

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
}
