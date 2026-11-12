"use client"

import { useRoomContext } from "@livekit/components-react"
import { CaptionsIcon } from "lucide-react"
import * as React from "react"

import { Toggle } from "@/components/ui/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { fromSummary } from "@/lib/participants"

// Captions: the summary service sends each transcribed chunk on a text
// topic as soon as it comes back. The bar over the stage shows the last 2
// lines with who said them; each fades after a while. Each member turns it
// on for themselves, and the browser remembers.

const TOPIC = "meet.caption"
const KEY = "meet.captions"
const KEEP = 2
const SHOW_MS = 20_000

type Line = { id: number; who: string; text: string; at: number }

const CaptionsContext = React.createContext<{
  on: boolean
  toggle: () => void
}>({ on: false, toggle: () => {} })

export function CaptionsProvider({ children }: { children: React.ReactNode }) {
  const [on, setOn] = React.useState(() => {
    try {
      return localStorage.getItem(KEY) === "1"
    } catch {
      return false
    }
  })
  const toggle = React.useCallback(() => {
    setOn((was) => {
      try {
        localStorage.setItem(KEY, was ? "" : "1")
      } catch {}
      return !was
    })
  }, [])
  const value = React.useMemo(() => ({ on, toggle }), [on, toggle])
  return <CaptionsContext value={value}>{children}</CaptionsContext>
}

export const useCaptions = () => React.useContext(CaptionsContext)

export function CaptionsControl() {
  const { on, toggle } = useCaptions()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            pressed={on}
            aria-label={on ? "關閉字幕" : "字幕"}
            onPressedChange={toggle}
          />
        }
      >
        <CaptionsIcon />
      </TooltipTrigger>
      <TooltipContent>{on ? "關閉字幕" : "字幕"}</TooltipContent>
    </Tooltip>
  )
}

/** The caption bar at the bottom of the stage. */
export function Captions() {
  const { on } = React.useContext(CaptionsContext)
  const room = useRoomContext()
  const [lines, setLines] = React.useState<Line[]>([])
  const next = React.useRef(0)

  React.useEffect(() => {
    if (!on) return
    room.registerTextStreamHandler(TOPIC, (reader, { identity }) => {
      // Only the summary service writes captions; anyone else could put
      // words in a member's mouth.
      if (!fromSummary(identity)) return
      void reader
        .readAll()
        .then((raw) => {
          const data = JSON.parse(raw) as Partial<Line>
          if (!data.text) return
          const line = {
            id: next.current++,
            who: String(data.who ?? ""),
            text: String(data.text),
            at: Number(data.at ?? Date.now()),
          }
          setLines((was) => [...was, line].slice(-KEEP))
          setTimeout(
            () => setLines((was) => was.filter((l) => l.id !== line.id)),
            SHOW_MS
          )
        })
        .catch(() => undefined)
    })
    return () => room.unregisterTextStreamHandler(TOPIC)
  }, [on, room])

  if (!on || lines.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-6 bottom-16 z-10 flex justify-center"
    >
      <div className="flex max-w-3xl flex-col gap-1 rounded-control bg-overlay px-4 py-2 backdrop-blur-md">
        {lines.map((line) => (
          <p key={line.id} className="leading-7">
            <span className="font-medium text-muted-foreground">
              {line.who}：
            </span>
            {line.text}
          </p>
        ))}
      </div>
    </div>
  )
}
