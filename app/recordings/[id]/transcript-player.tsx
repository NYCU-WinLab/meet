"use client"

import { LinkIcon, SearchIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// The recording beside its subtitles: click a line to jump the video there,
// the line being spoken lights up and stays in view, a search box narrows
// the lines, and ?t=<seconds> (or a copied line link) opens at a moment.

type Cue = { start: number; end: number; text: string }

/** SRT time "00:01:02,345" in seconds. */
function seconds(stamp: string) {
  const [h, m, rest] = stamp.trim().split(":")
  return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(",", "."))
}

function parseSrt(source: string): Cue[] {
  return source
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").filter(Boolean)
      const at = lines.findIndex((line) => line.includes("-->"))
      if (at < 0) return []
      const [from, to] = lines[at].split("-->")
      const text = lines
        .slice(at + 1)
        .join(" ")
        .trim()
      return text ? [{ start: seconds(from), end: seconds(to), text }] : []
    })
}

const clock = (total: number) => {
  const s = Math.floor(total)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** Manual scrolling pauses following the video for this long. */
const HOLD_MS = 5000

export function TranscriptPlayer({
  videoUrl,
  srtUrl,
}: {
  videoUrl: string
  /** Absent until the recording is transcribed. */
  srtUrl?: string
}) {
  const video = React.useRef<HTMLVideoElement>(null)
  const list = React.useRef<HTMLOListElement>(null)
  const heldUntil = React.useRef(0)
  const [cues, setCues] = React.useState<Cue[] | null>(null)
  const [now, setNow] = React.useState(0)
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    if (!srtUrl) return
    let live = true
    fetch(srtUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => live && setCues(parseSrt(text)))
      .catch(() => live && setCues([]))
    return () => {
      live = false
    }
  }, [srtUrl])

  // ?t=<seconds> opens the video at that moment.
  React.useEffect(() => {
    const t = Number(new URLSearchParams(window.location.search).get("t"))
    const element = video.current
    if (!element || !Number.isFinite(t) || t <= 0) return
    const seek = () => {
      element.currentTime = t
    }
    if (element.readyState >= 1) seek()
    else element.addEventListener("loadedmetadata", seek, { once: true })
  }, [])

  const current = React.useMemo(() => {
    if (!cues) return -1
    let found = -1
    for (let i = 0; i < cues.length && cues[i].start <= now; i++) found = i
    return found
  }, [cues, now])

  React.useEffect(() => {
    if (current < 0 || Date.now() < heldUntil.current) return
    list.current
      ?.querySelector(`[data-cue="${current}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [current])

  const jump = (cue: Cue) => {
    const element = video.current
    if (!element) return
    heldUntil.current = 0
    element.currentTime = cue.start
    void element.play().catch(() => undefined)
  }

  const copy = async (cue: Cue) => {
    const url = new URL(window.location.href)
    url.search = `?t=${Math.floor(cue.start)}`
    await navigator.clipboard.writeText(url.toString())
    toast.success("已複製這一句的連結")
  }

  const shown =
    cues
      ?.map((cue, i) => ({ cue, i }))
      .filter(({ cue }) =>
        query ? cue.text.toLowerCase().includes(query.toLowerCase()) : true
      ) ?? []

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <video
        ref={video}
        controls
        preload="metadata"
        src={videoUrl}
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        className="aspect-video w-full min-w-0 bg-muted lg:col-span-2"
      />
      {srtUrl && (
        // Absolute on wide screens, so the row is as tall as the video and
        // the lines scroll inside it.
        <section aria-label="逐字稿" className="relative min-w-0">
          <div className="flex max-h-96 flex-col gap-3 lg:absolute lg:inset-0 lg:max-h-none">
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label="搜尋逐字稿"
                placeholder="搜尋逐字稿"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {cues === null ? (
              <p className="text-muted-foreground">載入逐字稿中…</p>
            ) : shown.length === 0 ? (
              <p className="text-muted-foreground">
                {query ? "沒有符合的句子" : "沒有逐字稿"}
              </p>
            ) : (
              <ol
                ref={list}
                onWheel={() => (heldUntil.current = Date.now() + HOLD_MS)}
                onTouchMove={() => (heldUntil.current = Date.now() + HOLD_MS)}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              >
                {shown.map(({ cue, i }) => (
                  <li
                    key={i}
                    data-cue={i}
                    className={cn(
                      "group flex items-start gap-1 rounded-control transition-colors duration-state",
                      i === current ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => jump(cue)}
                      aria-current={i === current ? "true" : undefined}
                      className="flex min-w-0 flex-1 gap-3 px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <time className="shrink-0 text-muted-foreground tabular-nums">
                        {clock(cue.start)}
                      </time>
                      <span className="min-w-0 break-words">{cue.text}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="複製這一句的連結"
                      onClick={() => void copy(cue)}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <LinkIcon />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
