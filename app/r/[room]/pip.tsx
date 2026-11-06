"use client"

import {
  useLocalParticipant,
  useRoomContext,
  useTrackToggle,
  useTracks,
  VideoTrack,
  type TrackReference,
} from "@livekit/components-react"
import {
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from "livekit-client"
import {
  LogOutIcon,
  MicIcon,
  MicOffIcon,
  PictureInPicture2Icon,
} from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Picture-in-picture: the person speaking stays on screen while the member
// looks at slides or another app. Chromium opens a small window of our own
// (Document Picture-in-Picture) with the speaker, the microphone and leave;
// Safari and Firefox float the speaker's video instead. Either way the
// window follows whoever spoke last. Chromium also opens it by itself when
// the tab is hidden during a call (the enterpictureinpicture media action).

type DocumentPip = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>
  window: Window | null
}

const documentPip = () =>
  (window as unknown as { documentPictureInPicture?: DocumentPip })
    .documentPictureInPicture

/** The last remote person who spoke, else the first remote, else me. */
function useFeatured(): { participant: Participant; track?: TrackReference } {
  const room = useRoomContext()
  const [lastSpeaker, setLastSpeaker] = React.useState<string | null>(null)
  React.useEffect(() => {
    const onSpeakers = (speakers: Participant[]) => {
      const remote = speakers.find((p) => !p.isLocal)
      if (remote) setLastSpeaker(remote.identity)
    }
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers)
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers)
    }
  }, [room])
  const cameras = useTracks([Track.Source.Camera], { onlySubscribed: true })
  const remotes = [...room.remoteParticipants.values()].filter(
    (p) => !p.permissions?.hidden
  )
  const participant =
    remotes.find((p) => p.identity === lastSpeaker) ??
    remotes[0] ??
    room.localParticipant
  const track = cameras.find(
    (t) =>
      t.participant.identity === participant.identity && !t.publication.isMuted
  )
  return { participant, track }
}

/** Copies the page's styles into the picture-in-picture window. */
function copyStyles(target: Window) {
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = target.document.createElement("style")
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join("\n")
      target.document.head.append(style)
    } catch {
      if (!sheet.href) continue
      const link = target.document.createElement("link")
      link.rel = "stylesheet"
      link.href = sheet.href
      target.document.head.append(link)
    }
  }
  target.document.documentElement.className = document.documentElement.className
  target.document.body.className = "bg-background text-foreground"
}

export function PipControl() {
  const featured = useFeatured()
  const [pipWindow, setPipWindow] = React.useState<Window | null>(null)
  const [floating, setFloating] = React.useState(false)
  const video = React.useRef<HTMLVideoElement>(null)

  const open = React.useCallback(async () => {
    const api = documentPip()
    if (api) {
      if (api.window) return
      try {
        const opened = await api.requestWindow({ width: 360, height: 240 })
        copyStyles(opened)
        opened.addEventListener("pagehide", () => setPipWindow(null))
        setPipWindow(opened)
      } catch {
        toast.error("開不了子母畫面")
      }
      return
    }
    // Safari and Firefox: float a video of the speaker.
    const element = video.current
    if (!element || !("requestPictureInPicture" in element)) {
      toast.error("這個瀏覽器不支援子母畫面")
      return
    }
    try {
      await element.requestPictureInPicture()
      setFloating(true)
    } catch {
      toast.error("沒有可以浮動的畫面")
    }
  }, [])

  const close = () => {
    if (pipWindow) pipWindow.close()
    else if (document.pictureInPictureElement)
      void document.exitPictureInPicture()
  }

  // The fallback video always shows the featured person's camera.
  const track = featured.track?.publication.track as RemoteTrack | undefined
  React.useEffect(() => {
    const element = video.current
    if (!element || !track) return
    track.attach(element)
    return () => {
      track.detach(element)
    }
  }, [track])
  React.useEffect(() => {
    const element = video.current
    if (!element) return
    const left = () => setFloating(false)
    element.addEventListener("leavepictureinpicture", left)
    return () => element.removeEventListener("leavepictureinpicture", left)
  }, [])

  // Chromium opens picture-in-picture when the tab is hidden mid-call.
  React.useEffect(() => {
    if (!documentPip() || !("mediaSession" in navigator)) return
    try {
      navigator.mediaSession.setActionHandler(
        "enterpictureinpicture" as MediaSessionAction,
        () => void open()
      )
    } catch {
      return
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler(
          "enterpictureinpicture" as MediaSessionAction,
          null
        )
      } catch {}
    }
  }, [open])

  const active = pipWindow !== null || floating
  return (
    <>
      <Button
        variant={active ? "default" : "outline"}
        size="icon"
        aria-label={active ? "關閉子母畫面" : "子母畫面"}
        aria-pressed={active}
        onClick={() => (active ? close() : void open())}
      >
        <PictureInPicture2Icon />
      </Button>
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        aria-hidden
        className="pointer-events-none fixed size-px opacity-0"
      />
      {pipWindow &&
        createPortal(<PipView featured={featured} />, pipWindow.document.body)}
    </>
  )
}

function PipView({
  featured,
}: {
  featured: { participant: Participant; track?: TrackReference }
}) {
  const room = useRoomContext()
  const { isMicrophoneEnabled } = useLocalParticipant()
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  const name = featured.participant.name || featured.participant.identity
  return (
    <div className="fixed inset-0 bg-background">
      {featured.track ? (
        <VideoTrack
          trackRef={featured.track}
          className={cn(
            "absolute inset-0 size-full object-cover",
            featured.participant.isLocal && "-scale-x-100"
          )}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary text-title font-medium text-primary-foreground">
            {name.slice(0, 1)}
          </span>
        </div>
      )}
      <div className="absolute right-3 bottom-3 left-3 flex items-center gap-2">
        <span className="min-w-0 truncate rounded-control bg-overlay px-3 py-1 backdrop-blur-md">
          {name}
        </span>
        <span className="flex-1" />
        <Button
          variant={isMicrophoneEnabled ? "outline" : "default"}
          size="icon"
          aria-label={isMicrophoneEnabled ? "關麥克風" : "開麥克風"}
          aria-pressed={isMicrophoneEnabled}
          disabled={mic.pending}
          onClick={() => mic.toggle()}
        >
          {isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
        </Button>
        <Button
          variant="destructive"
          size="icon"
          aria-label="離開會議"
          onClick={() => room.disconnect()}
        >
          <LogOutIcon />
        </Button>
      </div>
    </div>
  )
}
