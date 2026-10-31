"use client"

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useChat,
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useRoomContext,
  useTrackToggle,
  useTracks,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react"
import { Track } from "livekit-client"
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  LinkIcon,
  LogOutIcon,
  MicIcon,
  MessagesSquareIcon,
  MicOffIcon,
  MonitorUpIcon,
  MonitorXIcon,
  PinIcon,
  PinOffIcon,
  SendIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// One meeting: everyone's camera (or their name when it is off), a shared
// screen when there is one, and the member's own controls. Camera and
// microphone start on; the browser asks once.
/** The top-right corner the page leaves empty for the controls. */
export const CONTROLS_SLOT = "meet-controls"

export function Meeting({
  serverUrl,
  token,
  endsAt,
}: {
  serverUrl: string
  token: string
  /** When a scheduled meeting ends, for the last-10-minutes reminder. */
  endsAt: Date | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const pending =
    // 未討論 counts items nobody has touched; a partial one has been raised.
    summary?.agenda?.filter((item) => item.status === "pending").length ?? 0
  useAgendaReminder(endsAt, pending)
  const toggle = () => setOpen((was) => !was)
  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      onDisconnected={() => router.push("/")}
      onError={(error) => toast.error(error.message)}
      onMediaDeviceFailure={(failure) => {
        if (failure) toast.error("開不了鏡頭或麥克風，請檢查瀏覽器權限")
      }}
      className="fixed top-18 right-6 bottom-6 left-6 flex flex-col gap-6 md:top-22 md:flex-row md:gap-0"
    >
      <RoomAudioRenderer />
      <SummaryListener onSummary={setSummary} />
      {/* A phone shows the open panel instead of the stage; wider screens show both. */}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          open ? "hidden md:flex" : "flex"
        )}
      >
        <Stage />
      </div>
      <MeetingPanel open={open} summary={summary} />
      <div className="flex justify-center md:hidden">
        <Controls open={open} onToggle={toggle} pending={pending} />
      </div>
      <ControlsInCorner open={open} onToggle={toggle} pending={pending} />
    </LiveKitRoom>
  )
}

// The screen share, when there is one, takes the stage and the cameras line
// up under it; otherwise the cameras share a grid.
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  )
  // A pinned tile fills the stage; otherwise the first screen share does.
  const [pinnedKey, setPinnedKey] = React.useState<string | null>(null)
  const pinned = tracks.find((t) => tileKey(t) === pinnedKey)
  const featured =
    pinned ?? tracks.find((t) => t.source === Track.Source.ScreenShare)
  const pin = (trackRef: TrackReferenceOrPlaceholder) =>
    setPinnedKey((key) =>
      key === tileKey(trackRef) ? null : tileKey(trackRef)
    )

  if (featured) {
    const rest = tracks.filter((t) => t !== featured)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <Tile
          trackRef={featured}
          pinned={pinned !== undefined}
          onPin={() => pin(featured)}
          className="min-h-0 flex-1"
        />
        {rest.length > 0 && (
          <div className="flex gap-4 overflow-x-auto pb-1">
            {rest.map((trackRef) => (
              <Tile
                key={tileKey(trackRef)}
                trackRef={trackRef}
                onPin={() => pin(trackRef)}
                className="aspect-video w-48 shrink-0"
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // A phone held upright stacks the tiles; a wide screen lays them side by
  // side.
  const columns =
    tracks.length <= 1
      ? "grid-cols-1"
      : tracks.length <= 2
        ? "grid-cols-1 landscape:grid-cols-2"
        : tracks.length <= 4
          ? "grid-cols-2"
          : tracks.length <= 9
            ? "grid-cols-2 landscape:grid-cols-3"
            : "grid-cols-2 landscape:grid-cols-4"
  return (
    <div className={cn("grid min-h-0 flex-1 auto-rows-fr gap-6", columns)}>
      {tracks.map((trackRef) => (
        <Tile
          key={tileKey(trackRef)}
          trackRef={trackRef}
          onPin={() => pin(trackRef)}
        />
      ))}
    </div>
  )
}

function tileKey(trackRef: TrackReferenceOrPlaceholder) {
  return `${trackRef.participant.identity}:${trackRef.source}`
}

// One participant: their video when it is on, their name when it is not,
// a ring while they speak, and a mark when their microphone is off.
function Tile({
  trackRef,
  pinned = false,
  onPin,
  className,
}: {
  trackRef: TrackReferenceOrPlaceholder
  pinned?: boolean
  onPin: () => void
  className?: string
}) {
  const { participant } = trackRef
  const screen = trackRef.source === Track.Source.ScreenShare
  const speaking = useIsSpeaking(participant)
  const micMuted = useIsMuted({
    source: Track.Source.Microphone,
    participant,
  })
  const hasVideo =
    trackRef.publication !== undefined &&
    trackRef.publication.track !== undefined &&
    !trackRef.publication.isMuted
  const name = participant.name || participant.identity

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-control bg-muted transition-all duration-state",
        !screen && "min-h-0",
        speaking && !screen && "ring-2 ring-primary",
        className
      )}
    >
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn(
            "absolute inset-0 size-full",
            screen ? "object-contain" : "object-cover",
            participant.isLocal && !screen && "-scale-x-100"
          )}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary text-title font-medium text-primary-foreground">
            {name.slice(0, 1)}
          </span>
        </div>
      )}
      <div className="absolute right-3 bottom-3 left-3 flex w-fit max-w-full items-center gap-2 rounded-control bg-overlay px-3 py-1 backdrop-blur-md">
        <span className="truncate">{screen ? `${name} 的螢幕` : name}</span>
        {!screen && micMuted && (
          <MicOffIcon aria-label="麥克風已關" className="size-4 shrink-0" />
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={pinned ? "取消釘選" : "釘選"}
        aria-pressed={pinned}
        onClick={onPin}
        className={cn(
          "absolute top-3 right-3 bg-overlay backdrop-blur-md",
          !pinned && "text-muted-foreground"
        )}
      >
        {pinned ? <PinOffIcon /> : <PinIcon />}
      </Button>
    </div>
  )
}

// The member's own controls, in the order they reach for them.
// The controls live in the shell's top-right corner, outside this tree, so
// they reach it through a portal once the corner exists.
function ControlsInCorner(props: React.ComponentProps<typeof Controls>) {
  const slot = React.useSyncExternalStore(
    () => () => {},
    () => document.getElementById(CONTROLS_SLOT),
    () => null
  )
  return slot ? createPortal(<Controls {...props} />, slot) : null
}

// Controls in three groups: what I send (mic, camera, screen), the meeting
// (its panel, its link), and leaving.
function Controls({
  open,
  onToggle,
  pending,
}: {
  open: boolean
  onToggle: () => void
  /** Agenda items not yet discussed, shown on the panel control. */
  pending: number
}) {
  const room = useRoomContext()
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  const camera = useTrackToggle({ source: Track.Source.Camera })
  const wasSharing = React.useRef(false)
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true },
    onChange: (enabled, isUserInitiated) => {
      // The browser's own "stop sharing" bar ends the share without us.
      if (wasSharing.current && !enabled && !isUserInitiated)
        toast("已停止分享螢幕")
      wasSharing.current = enabled
    },
  })

  return (
    <TooltipProvider>
      <div className="flex items-center gap-3">
        <Control
          label={isMicrophoneEnabled ? "關麥克風" : "開麥克風"}
          active={isMicrophoneEnabled}
          pending={mic.pending}
          onClick={() => mic.toggle()}
        >
          {isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
        </Control>
        <Control
          label={isCameraEnabled ? "關鏡頭" : "開鏡頭"}
          active={isCameraEnabled}
          pending={camera.pending}
          onClick={() => camera.toggle()}
        >
          {isCameraEnabled ? <VideoIcon /> : <VideoOffIcon />}
        </Control>
        <Control
          label={isScreenShareEnabled ? "停止分享螢幕" : "分享螢幕"}
          active={isScreenShareEnabled}
          pending={screen.pending}
          onClick={() => screen.toggle()}
        >
          {isScreenShareEnabled ? <MonitorXIcon /> : <MonitorUpIcon />}
        </Control>
        <Divider />
        <Control
          label={
            (open ? "收起摘要與聊天" : "摘要與聊天") +
            (pending > 0 ? `，未討論 ${pending}` : "")
          }
          active={open}
          badge={pending > 0 ? pending : undefined}
          onClick={onToggle}
        >
          <MessagesSquareIcon />
        </Control>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                aria-label="複製會議連結"
                onClick={async () => {
                  await navigator.clipboard.writeText(window.location.href)
                  toast.success("已複製會議連結")
                }}
              />
            }
          >
            <LinkIcon />
          </TooltipTrigger>
          <TooltipContent>複製會議連結</TooltipContent>
        </Tooltip>
        <Divider />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="destructive"
                size="icon"
                aria-label="離開會議"
                onClick={() => room.disconnect()}
              />
            }
          >
            <LogOutIcon />
          </TooltipTrigger>
          <TooltipContent>離開會議</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

const Divider = () => (
  <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />
)

function Control({
  label,
  active,
  pending,
  badge,
  onClick,
  children,
}: {
  label: string
  active: boolean
  pending?: boolean
  /** A count in the corner, e.g. agenda items left. */
  badge?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "outline" : "default"}
            size="icon"
            aria-label={label}
            aria-pressed={active}
            disabled={pending}
            onClick={onClick}
            className={badge === undefined ? undefined : "relative"}
          />
        }
      >
        {children}
        {badge !== undefined && (
          <span
            aria-hidden
            className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-destructive text-primary-foreground tabular-nums"
          >
            {badge}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// The running summary the summary service publishes on its text stream:
// what the meeting is about, open questions, improvements, decisions. It is
// rewritten every minute or so and sent again to anyone who joins late.
type AgendaItem = {
  id: string
  text: string
  url?: string
  status: "pending" | "partial" | "done"
  note: string
}

type Summary = {
  summary: string
  questions: string[]
  improvements: string[]
  decisions: string[]
  /** Absent from a summary service older than the agenda. */
  agenda?: AgendaItem[]
  updatedAt: string
}

// One toast when 10 minutes are left and items are still open.
function useAgendaReminder(endsAt: Date | null, pending: number) {
  const reminded = React.useRef(false)
  React.useEffect(() => {
    if (!endsAt || pending === 0 || reminded.current) return
    const remind = () => {
      if (reminded.current) return
      reminded.current = true
      toast(`還有 ${pending} 項沒討論，剩 10 分鐘`)
    }
    const wait = endsAt.getTime() - 10 * 60 * 1000 - Date.now()
    if (wait <= 0) {
      if (endsAt.getTime() > Date.now()) remind()
      return
    }
    const timer = setTimeout(remind, wait)
    return () => clearTimeout(timer)
  }, [endsAt, pending])
}

function SummaryListener({
  onSummary,
}: {
  onSummary: (summary: Summary) => void
}) {
  const room = useRoomContext()
  React.useEffect(() => {
    room.registerTextStreamHandler("meet.summary", async (reader) => {
      try {
        onSummary(JSON.parse(await reader.readAll()) as Summary)
      } catch {
        // A summary we cannot read is not worth breaking the meeting for.
      }
    })
    return () => room.unregisterTextStreamHandler("meet.summary")
  }, [room, onSummary])
  return null
}

// The summary above, the chat below, in one panel that slides in from the
// right. It stays mounted while closed so the chat keeps its messages.
function MeetingPanel({
  open,
  summary,
}: {
  open: boolean
  summary: Summary | null
}) {
  return (
    <div
      inert={!open}
      className={cn(
        "min-h-0 overflow-hidden md:block md:transition-all md:duration-overlay md:motion-reduce:transition-none",
        open ? "flex flex-1 flex-col md:w-86 md:flex-none" : "hidden md:w-0"
      )}
    >
      <aside
        aria-label="摘要與聊天"
        className={cn(
          "flex h-full min-h-0 flex-1 flex-col rounded-control bg-muted md:ml-6 md:w-80 md:transition-all md:duration-overlay",
          open
            ? "opacity-100"
            : "opacity-0 md:translate-x-8 md:motion-reduce:translate-x-0"
        )}
      >
        <SummaryPanel summary={summary} />
        <Chat />
      </aside>
    </div>
  )
}

function SummaryPanel({ summary }: { summary: Summary | null }) {
  return (
    <section className="flex min-h-0 flex-1 basis-0 flex-col gap-4 overflow-y-auto p-4">
      <h2 className="text-muted-foreground">摘要</h2>
      {summary?.agenda && summary.agenda.length > 0 && (
        <AgendaList items={summary.agenda} />
      )}
      {!summary?.summary ? (
        <p className="text-muted-foreground">開始說話後約 1 分鐘出現摘要</p>
      ) : (
        <>
          <p className="break-words whitespace-pre-wrap">{summary.summary}</p>
          <SummaryList title="問題" items={summary.questions} />
          <SummaryList title="改進" items={summary.improvements} />
          <SummaryList title="決議" items={summary.decisions} />
          <p className="text-muted-foreground">
            更新於{" "}
            {new Date(summary.updatedAt).toLocaleTimeString("zh-TW", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </>
      )}
    </section>
  )
}

const order = { pending: 0, partial: 1, done: 2 }
const statusIcon = {
  pending: (
    <CircleDashedIcon aria-label="未討論" className="text-muted-foreground" />
  ),
  partial: <CircleDotIcon aria-label="討論中" className="text-primary" />,
  done: <CircleCheckIcon aria-label="已討論" className="text-primary" />,
}

// The agenda as a checklist, open items first.
function AgendaList({ items }: { items: AgendaItem[] }) {
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status])
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground">議程</h2>
      <ul className="flex flex-col gap-2">
        {sorted.map((item) => (
          <li key={item.id} className="flex gap-2">
            <span className="mt-0.5 shrink-0 [&_svg]:size-4">
              {statusIcon[item.status]}
            </span>
            <div className="flex min-w-0 flex-col">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-words underline-offset-4 hover:underline"
                >
                  {item.text}
                </a>
              ) : (
                <span className="break-words">{item.text}</span>
              )}
              {item.note && (
                <span className="break-words text-muted-foreground">
                  {item.note}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground">{title}</h2>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Chat() {
  const { chatMessages, send, isSending } = useChat()
  const { localParticipant } = useLocalParticipant()
  const bottom = React.useRef<HTMLLIElement>(null)
  const [draft, setDraft] = React.useState("")

  React.useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [chatMessages.length])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft("")
    await send(text)
  }

  return (
    <section className="flex min-h-0 flex-1 basis-0 flex-col gap-4 border-t p-4">
      <h2 className="text-muted-foreground">聊天</h2>
      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {chatMessages.length === 0 && (
          <li className="text-muted-foreground">還沒有人說話</li>
        )}
        {chatMessages.map((message) => {
          const mine = message.from?.identity === localParticipant.identity
          return (
            <li key={message.id ?? message.timestamp} className="flex flex-col">
              <span className="text-muted-foreground">
                {mine ? "我" : (message.from?.name ?? message.from?.identity)}
              </span>
              <span className="break-words whitespace-pre-wrap">
                {message.message}
              </span>
            </li>
          )
        })}
        <li ref={bottom} aria-hidden />
      </ol>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="說點什麼"
          aria-label="訊息"
          maxLength={2000}
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          aria-label="送出"
          disabled={isSending || !draft.trim()}
        >
          <SendIcon />
        </Button>
      </form>
    </section>
  )
}
