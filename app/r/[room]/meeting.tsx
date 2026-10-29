"use client"

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTrackToggle,
  useTracks,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react"
import { ConnectionState, Track } from "livekit-client"
import {
  LinkIcon,
  LogOutIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  MonitorXIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
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
export function Meeting({
  title,
  serverUrl,
  token,
}: {
  title: string
  serverUrl: string
  token: string
}) {
  const router = useRouter()
  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      video
      onDisconnected={() => router.push("/")}
      onError={(error) => toast.error(error.message)}
      onMediaDeviceFailure={(failure) => {
        if (failure) toast.error("開不了鏡頭或麥克風，請檢查瀏覽器權限")
      }}
      className="flex min-h-full flex-col gap-6"
    >
      <RoomAudioRenderer />
      <Header title={title} />
      <Stage />
      <Controls />
    </LiveKitRoom>
  )
}

function Header({ title }: { title: string }) {
  const participants = useParticipants()
  const state = useConnectionState()
  const status =
    state === ConnectionState.Connected
      ? `${participants.length} 人`
      : state === ConnectionState.Reconnecting
        ? "重新連線中…"
        : "連線中…"
  return (
    <PageHeader
      title={
        <span className="flex items-baseline gap-3">
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-body font-normal text-muted-foreground">
            {status}
          </span>
        </span>
      }
      actions={
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(window.location.href)
            toast.success("已複製會議連結")
          }}
        >
          <LinkIcon />
          複製連結
        </Button>
      }
    />
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
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Tile trackRef={screens[0]} screen className="flex-1" />
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
    <div className={cn("grid flex-1 content-center gap-4", columns)}>
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
        screen ? "min-h-64" : "aspect-video",
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
function Controls() {
  const room = useRoomContext()
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  const camera = useTrackToggle({ source: Track.Source.Camera })
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true },
    onChange: (enabled, isUserInitiated) => {
      if (!enabled && !isUserInitiated) toast("已停止分享螢幕")
    },
  })

  return (
    <TooltipProvider>
      <div className="flex justify-center gap-3">
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
  pending: boolean
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
