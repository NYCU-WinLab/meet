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
  LinkIcon,
  LogOutIcon,
  MicIcon,
  MessageSquareIcon,
  MicOffIcon,
  MonitorUpIcon,
  MonitorXIcon,
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
}: {
  serverUrl: string
  token: string
}) {
  const router = useRouter()
  const [chatOpen, setChatOpen] = React.useState(false)
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
      className="fixed top-22 right-6 bottom-6 left-6 flex gap-6"
    >
      <RoomAudioRenderer />
      <Stage />
      {chatOpen && <Chat />}
      <ControlsInCorner
        chatOpen={chatOpen}
        onChatToggle={() => setChatOpen((open) => !open)}
      />
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
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare)
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera)

  if (screens.length > 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <Tile trackRef={screens[0]} screen className="min-h-0 flex-1" />
        <div className="flex gap-4 overflow-x-auto pb-1">
          {cameras.map((trackRef) => (
            <Tile
              key={tileKey(trackRef)}
              trackRef={trackRef}
              className="w-48 shrink-0"
            />
          ))}
        </div>
      </div>
    )
  }

  const columns =
    cameras.length <= 1
      ? "grid-cols-1"
      : cameras.length <= 4
        ? "grid-cols-2"
        : cameras.length <= 9
          ? "grid-cols-2 md:grid-cols-3"
          : "grid-cols-2 md:grid-cols-4"
  return (
    <div className={cn("grid min-h-0 flex-1 auto-rows-fr gap-6", columns)}>
      {cameras.map((trackRef) => (
        <Tile key={tileKey(trackRef)} trackRef={trackRef} />
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
  screen = false,
  className,
}: {
  trackRef: TrackReferenceOrPlaceholder
  screen?: boolean
  className?: string
}) {
  const { participant } = trackRef
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

function Controls({
  chatOpen,
  onChatToggle,
}: {
  chatOpen: boolean
  onChatToggle: () => void
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
        <Control
          label={chatOpen ? "收起聊天" : "聊天"}
          active={chatOpen}
          onClick={onChatToggle}
        >
          <MessageSquareIcon />
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

function Control({
  label,
  active,
  pending,
  onClick,
  children,
}: {
  label: string
  active: boolean
  pending?: boolean
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
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// Text beside the video: what was said while the meeting is open; nothing is
// kept once it ends.
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
    <aside className="flex w-80 shrink-0 flex-col gap-4 rounded-control bg-muted p-4">
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
    </aside>
  )
}
