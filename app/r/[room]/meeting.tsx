"use client"

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionQualityIndicator,
  useConnectionState,
  useIsMuted,
  useIsRecording,
  useIsSpeaking,
  useLocalParticipant,
  useRoomContext,
  useTrackToggle,
  useTracks,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react"
import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  Room,
  Track,
  type RoomOptions,
} from "livekit-client"
import {
  BellIcon,
  BellOffIcon,
  CircleCheckIcon,
  HandIcon,
  CircleDashedIcon,
  CaptionsIcon,
  CaptionsOffIcon,
  CircleDotIcon,
  EllipsisIcon,
  LinkIcon,
  LogOutIcon,
  MicIcon,
  MessagesSquareIcon,
  MicOffIcon,
  MonitorUpIcon,
  MonitorXIcon,
  PinIcon,
  PinOffIcon,
  SignalLowIcon,
  SwitchCameraIcon,
  UserPlusIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import * as React from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"

import { Chat, OPEN_CHAT_EVENT } from "@/components/chat"
import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { fromSummary } from "@/lib/participants"

import {
  Captions,
  CaptionsControl,
  CaptionsProvider,
  useCaptions,
} from "./captions"
import { DeviceMenu } from "./device-menu"
import { GuestInvite } from "./guest-invite"
import { HostProvider, ModerationListener, TileModeration } from "./host"
import type { MediaChoices } from "./lobby"
import { ReactionListener, ReactionPicker, TileReactions } from "./reactions"
import {
  LowerHandWhenSpeaking,
  TileHand,
  useHandQueue,
  useMyHand,
} from "./raise-hand"
import { PipControl } from "./pip"

// One meeting: everyone's camera (or their name when it is off), a shared
// screen when there is one, and the member's own controls. Camera and
// microphone start as the member left them in the lobby.
/** The top-right corner the page leaves empty for the controls. */
export const CONTROLS_SLOT = "meet-controls"

// Subscribers get each video at the size its tile shows, and publishers stop
// sending layers nobody watches.
const ROOM_OPTIONS: RoomOptions = { adaptiveStream: true, dynacast: true }

export function Meeting({
  serverUrl,
  token,
  endsAt,
  host,
  invite = false,
  guest = false,
  onLeave,
  choices,
}: {
  serverUrl: string
  token: string
  /** When a scheduled meeting ends, for the last-10-minutes reminder. */
  endsAt: Date | null
  /** Whether this member opened the room and may moderate it. */
  host: boolean
  /** Whether this person may make guest links: every member. */
  invite?: boolean
  /** A person without an account, in through a guest link. */
  guest?: boolean
  /** Where leaving goes; the room list when left out. */
  onLeave?: () => void
  choices: MediaChoices
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const pending =
    // 未討論 counts items nobody has touched; a partial one has been raised.
    summary?.agenda?.filter((item) => item.status === "pending").length ?? 0
  useAgendaReminder(endsAt, pending)
  const toggle = () => setOpen((was) => !was)
  React.useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_CHAT_EVENT, show)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, show)
  }, [])
  return (
    <HostProvider value={host}>
      <CaptionsProvider>
        <LiveKitRoom
          serverUrl={serverUrl}
          token={token}
          connect
          options={ROOM_OPTIONS}
          audio={
            choices.audio
              ? { deviceId: choices.audioDeviceId || undefined }
              : false
          }
          video={
            choices.video
              ? { deviceId: choices.videoDeviceId || undefined }
              : false
          }
          onDisconnected={(reason) => {
            if (reason === DisconnectReason.PARTICIPANT_REMOVED)
              toast("主持人已請你離開會議")
            if (onLeave) onLeave()
            else router.push("/")
          }}
          onError={(error) => toast.error(error.message)}
          onMediaDeviceFailure={(failure) => {
            if (failure) toast.error("開不了鏡頭或麥克風，請檢查瀏覽器權限")
          }}
          className="fixed top-16 right-4 bottom-4 left-4 flex flex-col gap-6 md:top-20 md:flex-row md:gap-0"
        >
          <RoomAudioRenderer />
          <SummaryListener onSummary={setSummary} />
          <ModerationListener />
          <ReactionListener />
          <LowerHandWhenSpeaking />
          <Shortcuts />
          <Reconnecting />
          {/* A phone shows the open panel instead of the stage; wider screens show both. */}
          <div
            className={cn(
              "relative min-h-0 min-w-0 flex-1 flex-col",
              open ? "hidden md:flex" : "flex"
            )}
          >
            <Stage />
            <Captions />
          </div>
          <MeetingPanel open={open} summary={summary} />
          <div className="flex justify-center md:hidden">
            <Controls
              open={open}
              onToggle={toggle}
              pending={pending}
              invite={invite}
              guest={guest}
            />
          </div>
          <ControlsInCorner
            open={open}
            onToggle={toggle}
            pending={pending}
            invite={invite}
            guest={guest}
          />
        </LiveKitRoom>
      </CaptionsProvider>
    </HostProvider>
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
          <Filmstrip>
            {(tile) =>
              rest.map((trackRef) => (
                <Tile
                  key={tileKey(trackRef)}
                  trackRef={trackRef}
                  onPin={() => pin(trackRef)}
                  className={tile}
                />
              ))
            }
          </Filmstrip>
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

// The cameras under a screen share. The handle above them drags their
// height (arrow keys too, double-click resets); dragged near the bottom the
// row hides, so the share fills the stage. The height is kept in this browser.
const STRIP_DEFAULT = 108
const STRIP_MIN = 64
const STRIP_MAX = 320
const STRIP_KEY = "meet.strip-height"

function Filmstrip({
  children,
}: {
  children: (tileClassName: string) => React.ReactNode
}) {
  const frame = React.useRef<HTMLDivElement>(null)
  const handle = React.useRef<HTMLDivElement>(null)
  const height = React.useRef(STRIP_DEFAULT)
  const [dragging, setDragging] = React.useState(false)

  const apply = React.useCallback((wanted: number) => {
    const most = Math.max(
      STRIP_MIN,
      Math.min(STRIP_MAX, window.innerHeight * 0.4)
    )
    const next =
      wanted < STRIP_MIN / 2
        ? 0
        : Math.round(Math.min(most, Math.max(STRIP_MIN, wanted)))
    frame.current?.style.setProperty("--strip", `${next}px`)
    handle.current?.setAttribute("aria-valuenow", String(next))
    height.current = next
    // An attribute, not state: the row hides through CSS.
    frame.current?.toggleAttribute("data-hidden", next === 0)
    return next
  }, [])

  React.useEffect(() => {
    let saved = STRIP_DEFAULT
    try {
      const stored = localStorage.getItem(STRIP_KEY)
      if (stored !== null && Number.isFinite(Number(stored)))
        saved = Number(stored)
    } catch {}
    apply(saved)
  }, [apply])

  const save = (value: number) => {
    try {
      localStorage.setItem(STRIP_KEY, String(value))
    } catch {}
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  function drag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const bottom =
      frame.current?.getBoundingClientRect().bottom ?? window.innerHeight
    apply(bottom - event.clientY - GUTTER / 2)
  }
  function endDrag() {
    if (!dragging) return
    setDragging(false)
    save(height.current)
  }

  return (
    // The handle sits in the gutter between the share and the cameras.
    <div ref={frame} className="group/strip -mt-6 flex flex-col">
      <div
        ref={handle}
        role="separator"
        aria-orientation="horizontal"
        aria-label="調整下方人像的高度"
        aria-valuemin={0}
        aria-valuemax={STRIP_MAX}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => save(apply(STRIP_DEFAULT))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
          event.preventDefault()
          const now = height.current
          save(
            apply(
              event.key === "ArrowUp" ? Math.max(STRIP_MIN, now + 32) : now - 32
            )
          )
        }}
        className="group flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none"
      >
        <span
          aria-hidden
          className={cn(
            "h-1 w-12 rounded-full bg-border transition-colors duration-state group-hover:bg-muted-foreground group-focus-visible:bg-primary",
            dragging && "bg-primary"
          )}
        />
      </div>
      {/* A scroller clips on every side; the padding keeps the speaking
          ring around each tile visible, the negative margin keeps the
          tiles where they were. */}
      <div className="-m-1 flex gap-4 overflow-x-auto p-1 group-data-[hidden]/strip:hidden">
        {children(
          cn("aspect-video h-(--strip) shrink-0", dragging && "transition-none")
        )}
      </div>
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
  const queue = useHandQueue()

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
        {!screen && <WeakSignal participant={participant} />}
      </div>
      {!screen && <TileReactions identity={participant.identity} />}
      {!screen && <TileHand identity={participant.identity} queue={queue} />}
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
      {!screen && <TileModeration participant={participant} />}
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
  invite,
  guest,
}: {
  open: boolean
  onToggle: () => void
  /** Agenda items not yet discussed, shown on the panel control. */
  pending: number
  /** May make guest links: every member. */
  invite: boolean
  /** In through a guest link: no room microphone, no meeting link to copy. */
  guest: boolean
}) {
  const room = useRoomContext()
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  const camera = useTrackToggle({ source: Track.Source.Camera })
  const hand = useMyHand()
  const [inviting, setInviting] = React.useState(false)
  const wasSharing = React.useRef(false)
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true },
    onChange: (enabled, isUserInitiated) => {
      // The browser's own "stop sharing" bar ends the share without us.
      if (wasSharing.current && !enabled && !isUserInitiated)
        toast("已停止分享螢幕")
      // Safari shares a screen without its sound (#16).
      if (enabled && !wasSharing.current && isSafari())
        toast("Safari 分享螢幕不含聲音", {
          description: "要分享影片或簡報的聲音，請改用 Chrome。",
        })
      wasSharing.current = enabled
    },
  })

  return (
    <TooltipProvider>
      <div className="flex items-center gap-3">
        <RecordingState />
        <span className="contents max-md:hidden">
          <Divider />
        </span>
        <div className="flex items-center gap-1">
          <Control
            label={`${isMicrophoneEnabled ? "關麥克風" : "開麥克風"}（${MOD}D）`}
            active={isMicrophoneEnabled}
            pending={mic.pending}
            onClick={() => mic.toggle()}
          >
            {isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
          </Control>
          <span className="contents max-md:hidden">
            <DeviceMenu kind="audioinput" label="麥克風" />
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Control
            label={`${isCameraEnabled ? "關鏡頭" : "開鏡頭"}（${MOD}E）`}
            active={isCameraEnabled}
            pending={camera.pending}
            onClick={() => camera.toggle()}
          >
            {isCameraEnabled ? <VideoIcon /> : <VideoOffIcon />}
          </Control>
          <span className="contents max-md:hidden">
            <DeviceMenu kind="videoinput" label="鏡頭" />
          </span>
        </div>
        <div className="flex items-center gap-3 max-md:hidden">
          <Control
            label={isScreenShareEnabled ? "停止分享螢幕" : "分享螢幕"}
            active={isScreenShareEnabled}
            pending={screen.pending}
            onClick={() => screen.toggle()}
          >
            {isScreenShareEnabled ? <MonitorXIcon /> : <MonitorUpIcon />}
          </Control>
        </div>
        <ReactionPicker />
        <div className="flex items-center gap-3 max-md:hidden">
          <CaptionsControl />
          {/* Raising a hand is an attribute a guest's token may not set. */}
          {!guest && (
            <Control
              label={hand.up ? "放下手" : "舉手"}
              active={!hand.up}
              onClick={() => void hand.set(!hand.up)}
            >
              <HandIcon />
            </Control>
          )}
          <Divider />
        </div>
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
        <MoreMenu
          hand={hand}
          sharing={isScreenShareEnabled}
          onShare={() => screen.toggle()}
          guest={guest}
          onInvite={invite ? () => setInviting(true) : undefined}
        />
        {invite && <GuestInvite open={inviting} onOpenChange={setInviting} />}
        <div className="flex items-center gap-3 max-md:hidden">
          {invite && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="邀請訪客"
                    onClick={() => setInviting(true)}
                  />
                }
              >
                <UserPlusIcon />
              </TooltipTrigger>
              <TooltipContent>邀請訪客</TooltipContent>
            </Tooltip>
          )}
          {!guest && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="複製會議連結"
                    onClick={() => void copyLink()}
                  />
                }
              >
                <LinkIcon />
              </TooltipTrigger>
              <TooltipContent>複製會議連結</TooltipContent>
            </Tooltip>
          )}
          <PipControl />
          <Divider />
        </div>
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

const copyLink = async () => {
  await navigator.clipboard.writeText(window.location.href)
  toast.success("已複製會議連結")
}

// A phone has room for the main controls only (mic, camera, reactions, the
// panel, leave); the rest sit in this menu. Wider screens never show it.
function MoreMenu({
  hand,
  sharing,
  onShare,
  guest,
  onInvite,
}: {
  hand: ReturnType<typeof useMyHand>
  sharing: boolean
  onShare: () => void
  guest: boolean
  /** Opens the guest link form; members only. */
  onInvite?: () => void
}) {
  const room = useRoomContext()
  const captions = useCaptions()
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"

  // Front and back cameras: each tap moves to the next camera.
  const nextCamera = async () => {
    try {
      const cameras = await Room.getLocalDevices("videoinput")
      if (cameras.length < 2) {
        toast("只有一個鏡頭")
        return
      }
      const now = room.getActiveDevice("videoinput")
      const at = cameras.findIndex((c) => c.deviceId === now)
      await room.switchActiveDevice(
        "videoinput",
        cameras[(at + 1) % cameras.length].deviceId
      )
    } catch {
      toast.error("切換鏡頭失敗")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label="更多"
            className="md:hidden"
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuItem onClick={() => void nextCamera()}>
          <SwitchCameraIcon />
          切換鏡頭
        </DropdownMenuItem>
        {!guest && (
          <DropdownMenuItem onClick={() => void hand.set(!hand.up)}>
            <HandIcon />
            {hand.up ? "放下手" : "舉手"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={captions.toggle}>
          {captions.on ? <CaptionsOffIcon /> : <CaptionsIcon />}
          {captions.on ? "關閉字幕" : "字幕"}
        </DropdownMenuItem>
        {canShare && (
          <DropdownMenuItem onClick={onShare}>
            {sharing ? <MonitorXIcon /> : <MonitorUpIcon />}
            {sharing ? "停止分享螢幕" : "分享螢幕"}
          </DropdownMenuItem>
        )}
        {!guest && (
          <DropdownMenuItem onClick={() => void copyLink()}>
            <LinkIcon />
            複製會議連結
          </DropdownMenuItem>
        )}
        {onInvite && (
          <DropdownMenuItem onClick={onInvite}>
            <UserPlusIcon />
            邀請訪客
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const isSafari = () =>
  /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(
    navigator.userAgent
  )

const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+"

// Keys: ⌘D or Ctrl+D the microphone, ⌘E or Ctrl+E the camera, and Space
// held down talks while the microphone is off. Typing in a field is left
// alone.
function Shortcuts() {
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  const camera = useTrackToggle({ source: Track.Source.Camera })
  const holding = React.useRef(false)
  React.useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    const down = (event: KeyboardEvent) => {
      if (typing(event.target)) return
      const key = event.key.toLowerCase()
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (key === "d") {
          event.preventDefault()
          void mic.toggle()
        } else if (key === "e") {
          event.preventDefault()
          void camera.toggle()
        }
        return
      }
      if (key === " " && !event.repeat && !mic.enabled) {
        event.preventDefault()
        holding.current = true
        void mic.toggle(true)
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === " " && holding.current) {
        holding.current = false
        void mic.toggle(false)
      }
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [mic, camera])
  return null
}

// A bar across the top while the connection is lost and coming back.
function Reconnecting() {
  const state = useConnectionState()
  const lost =
    state === ConnectionState.Reconnecting ||
    state === ConnectionState.SignalReconnecting
  if (!lost) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex justify-center bg-destructive py-1 text-primary-foreground"
    >
      連線中斷，重新連線中
    </div>
  )
}

// A mark on a tile whose connection is poor, so a frozen picture or broken
// voice has a visible cause.
function WeakSignal({
  participant,
}: {
  participant: TrackReferenceOrPlaceholder["participant"]
}) {
  const { quality } = useConnectionQualityIndicator({ participant })
  if (quality !== ConnectionQuality.Poor && quality !== ConnectionQuality.Lost)
    return null
  return (
    <SignalLowIcon
      aria-label="連線不穩"
      className="size-4 shrink-0 text-destructive"
    />
  )
}

// Whether the room is being recorded. The recorder joins a few seconds after
// the first member, so a room is only called unrecorded after a grace.
const RECORDING_GRACE_MS = 20_000

function RecordingState() {
  const recording = useIsRecording()
  const [late, setLate] = React.useState(false)
  React.useEffect(() => {
    const timer = setTimeout(() => setLate(true), RECORDING_GRACE_MS)
    return () => clearTimeout(timer)
  }, [])
  const label = recording ? "錄影中" : late ? "未錄影" : "錄影準備中"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            className={cn(
              "flex h-9 items-center gap-2 px-1",
              !recording && "text-muted-foreground",
              !recording && late && "text-destructive"
            )}
          />
        }
      >
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full",
            recording
              ? "animate-pulse bg-destructive"
              : late
                ? "bg-destructive"
                : "bg-muted-foreground"
          )}
        />
        <span className="hidden lg:inline">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {recording
          ? "這場會議正在錄影，結束後會上傳並產生逐字稿"
          : late
            ? "這場會議沒有在錄影"
            : "錄影機加入中"}
      </TooltipContent>
    </Tooltip>
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
    room.registerTextStreamHandler("meet.summary", async (reader, from) => {
      // Only the summary service writes the summary.
      if (!fromSummary(from.identity)) return
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
// right. It stays mounted while closed so the chat keeps its messages. Its
// left edge drags to resize it (arrow keys too, double-click resets), and
// the width is kept in this browser.
const PANEL_DEFAULT = 400
const PANEL_MIN = 320
const PANEL_MAX = 800
const PANEL_KEY = "meet.panel-width"
/** The gutter between the stage and the panel. */
const GUTTER = 24

function MeetingPanel({
  open,
  summary,
}: {
  open: boolean
  summary: Summary | null
}) {
  const frame = React.useRef<HTMLDivElement>(null)
  const handle = React.useRef<HTMLDivElement>(null)
  // A ref, not state: dragging repaints through CSS variables only.
  const width = React.useRef(PANEL_DEFAULT)
  const [dragging, setDragging] = React.useState(false)

  // Widths live in CSS variables set from here, so the transition still
  // runs on open and close, and stops while dragging.
  const apply = React.useCallback((wanted: number) => {
    const most = Math.max(
      PANEL_MIN,
      Math.min(PANEL_MAX, window.innerWidth * 0.6)
    )
    const next = Math.round(Math.min(most, Math.max(PANEL_MIN, wanted)))
    frame.current?.style.setProperty("--panel", `${next}px`)
    frame.current?.style.setProperty("--panel-outer", `${next + GUTTER}px`)
    handle.current?.setAttribute("aria-valuenow", String(next))
    width.current = next
    return next
  }, [])

  React.useEffect(() => {
    let saved = PANEL_DEFAULT
    try {
      saved = Number(localStorage.getItem(PANEL_KEY)) || PANEL_DEFAULT
    } catch {}
    apply(saved)
  }, [apply])

  const save = (value: number) => {
    try {
      localStorage.setItem(PANEL_KEY, String(value))
    } catch {}
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  function drag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const right =
      frame.current?.getBoundingClientRect().right ?? window.innerWidth
    apply(right - event.clientX - GUTTER / 2)
  }
  function endDrag() {
    if (!dragging) return
    setDragging(false)
    save(width.current)
  }

  return (
    <div
      ref={frame}
      inert={!open}
      className={cn(
        "relative min-h-0 overflow-hidden md:block md:transition-all md:duration-overlay md:motion-reduce:transition-none",
        dragging && "md:transition-none",
        open
          ? "flex flex-1 flex-col md:w-(--panel-outer) md:flex-none"
          : "hidden md:w-0"
      )}
    >
      <div
        ref={handle}
        role="separator"
        aria-orientation="vertical"
        aria-label="調整摘要與聊天的寬度"
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        tabIndex={open ? 0 : -1}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => save(apply(PANEL_DEFAULT))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          save(apply(width.current + (event.key === "ArrowLeft" ? 32 : -32)))
        }}
        className="group absolute inset-y-0 left-0 hidden w-6 cursor-col-resize touch-none items-center justify-center outline-none md:flex"
      >
        <span
          aria-hidden
          className={cn(
            "h-12 w-1 rounded-full bg-border transition-colors duration-state group-hover:bg-muted-foreground group-focus-visible:bg-primary",
            dragging && "bg-primary"
          )}
        />
      </div>
      <aside
        aria-label="摘要與聊天"
        className={cn(
          "flex h-full min-h-0 flex-1 flex-col rounded-control bg-muted md:ml-6 md:w-(--panel) md:transition-all md:duration-overlay",
          dragging && "md:transition-none",
          open
            ? "opacity-100"
            : "opacity-0 md:translate-x-8 md:motion-reduce:translate-x-0"
        )}
      >
        <PanelTabs open={open} summary={summary} />
      </aside>
    </div>
  )
}

type PanelTab = "summary" | "chat"
const TAB_KEY = "meet.panel-tab."
const SOUND_KEY = "meet.mention-sound"

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange)
  return () => document.removeEventListener("visibilitychange", onChange)
}

/** False while the meeting is in a background tab or a hidden window. */
function usePageVisible() {
  return React.useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true
  )
}

/** "(3) 標題" in the browser tab while messages wait unread. */
function useUnreadTitle(unread: number) {
  const base = React.useRef<string | null>(null)
  React.useEffect(() => {
    base.current ??= document.title.replace(/^\(\d+\) /, "")
    document.title = unread > 0 ? `(${unread}) ${base.current}` : base.current
  }, [unread])
  React.useEffect(
    () => () => {
      if (base.current) document.title = base.current
    },
    []
  )
}

// The panel holds one thing at a time, so each gets its full height. Both
// stay mounted: the chat keeps its messages and counts what arrives while
// the summary is in front. The tab is remembered per room.
function PanelTabs({
  open,
  summary,
}: {
  open: boolean
  summary: Summary | null
}) {
  // From the URL: the LiveKit room has no name until it connects, after
  // this first render reads the saved tab.
  const { room } = useParams<{ room: string }>()
  const key = TAB_KEY + room
  // The meeting mounts only in the browser, after the lobby.
  const [tab, setTab] = React.useState<PanelTab>(() => {
    try {
      return localStorage.getItem(key) === "chat" ? "chat" : "summary"
    } catch {
      return "summary"
    }
  })
  const [unread, setUnread] = React.useState(0)
  const pageVisible = usePageVisible()
  const [sound, setSound] = React.useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off"
    } catch {
      return true
    }
  })
  const toggleSound = () => {
    setSound(!sound)
    try {
      localStorage.setItem(SOUND_KEY, sound ? "off" : "on")
    } catch {}
  }
  const pick = React.useCallback(
    (next: PanelTab) => {
      setTab(next)
      try {
        localStorage.setItem(key, next)
      } catch {}
    },
    [key]
  )
  React.useEffect(() => {
    const show = () => pick("chat")
    window.addEventListener(OPEN_CHAT_EVENT, show)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, show)
  }, [pick])
  useUnreadTitle(unread)
  const current = summary?.agenda?.find((item) => item.status === "partial")

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => pick(next as PanelTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
        <TabsList className="flex-1">
          <TabsTrigger value="summary">摘要</TabsTrigger>
          <TabsTrigger value="chat">
            聊天
            {unread > 0 && (
              <span
                aria-label={`${unread} 則未讀`}
                className="flex size-5 items-center justify-center rounded-full bg-destructive text-primary-foreground tabular-nums"
              >
                {unread}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={sound ? "關閉提及鈴聲" : "開啟提及鈴聲"}
                aria-pressed={sound}
                onClick={toggleSound}
              />
            }
          >
            {sound ? <BellIcon /> : <BellOffIcon />}
          </TooltipTrigger>
          <TooltipContent>
            {sound ? "關閉提及鈴聲" : "開啟提及鈴聲"}
          </TooltipContent>
        </Tooltip>
      </div>
      <TabsContent
        value="summary"
        keepMounted
        className="flex min-h-0 flex-1 flex-col [&[hidden]]:hidden"
      >
        <SummaryPanel summary={summary} />
      </TabsContent>
      <TabsContent
        value="chat"
        keepMounted
        className="flex min-h-0 flex-1 flex-col [&[hidden]]:hidden"
      >
        {current && (
          <button
            type="button"
            onClick={() => pick("summary")}
            className="mx-4 mt-4 flex shrink-0 items-center gap-2 rounded-control bg-background/60 px-3 py-2 text-left transition-colors duration-state hover:bg-background [&_svg]:size-4 [&_svg]:shrink-0"
          >
            {statusIcon.partial}
            <span className="truncate">{current.text}</span>
          </button>
        )}
        <Chat
          visible={open && tab === "chat" && pageVisible}
          onUnread={setUnread}
          sound={sound}
        />
      </TabsContent>
    </Tabs>
  )
}

function SummaryPanel({ summary }: { summary: Summary | null }) {
  return (
    <section className="flex min-h-0 flex-1 basis-0 flex-col gap-6 overflow-y-auto p-4 leading-7">
      {summary?.agenda && summary.agenda.length > 0 && (
        <AgendaList items={summary.agenda} />
      )}
      {!summary?.summary ? (
        <p className="text-muted-foreground">開始說話後約 1 分鐘出現摘要</p>
      ) : (
        <>
          <Markdown>{summary.summary}</Markdown>
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
      <ul className="flex flex-col gap-3">
        {sorted.map((item) => (
          <li key={item.id} className="flex gap-2">
            <span className="mt-1.5 shrink-0 [&_svg]:size-4">
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
                <Markdown inline>{item.text}</Markdown>
              )}
              {item.note && (
                <Markdown inline className="text-muted-foreground">
                  {item.note}
                </Markdown>
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
      <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="break-words">
            <Markdown inline>{item}</Markdown>
          </li>
        ))}
      </ul>
    </section>
  )
}
