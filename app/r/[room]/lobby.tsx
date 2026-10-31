"use client"

import {
  useMediaDevices,
  usePersistentUserChoices,
  usePreviewTracks,
} from "@livekit/components-react"
import {
  type LocalAudioTrack,
  type LocalVideoTrack,
  Track,
} from "livekit-client"
import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { Meeting } from "./meeting"

/** What the member chose before going in. */
export type MediaChoices = {
  audio: boolean
  video: boolean
  audioDeviceId: string
  videoDeviceId: string
}

// The way into a meeting: the member sees their camera, watches their
// microphone move, picks the devices, and only then joins. The choices are
// kept in the browser for next time.
export function Room({
  title,
  serverUrl,
  token,
  endsAt,
}: {
  title: string
  serverUrl: string
  token: string
  endsAt: Date | null
}) {
  const [joined, setJoined] = React.useState<MediaChoices | null>(null)
  if (joined)
    return (
      <Meeting
        serverUrl={serverUrl}
        token={token}
        endsAt={endsAt}
        choices={joined}
      />
    )
  return <Lobby title={title} onJoin={setJoined} />
}

function Lobby({
  title,
  onJoin,
}: {
  title: string
  onJoin: (choices: MediaChoices) => void
}) {
  const {
    userChoices,
    saveAudioInputEnabled,
    saveVideoInputEnabled,
    saveAudioInputDeviceId,
    saveVideoInputDeviceId,
  } = usePersistentUserChoices({
    defaults: { audioEnabled: true, videoEnabled: true },
  })
  const [failed, setFailed] = React.useState(false)
  // A new options object restarts the devices, so it changes only with a
  // choice.
  const { audioEnabled, videoEnabled, audioDeviceId, videoDeviceId } =
    userChoices
  const options = React.useMemo(
    () => ({
      audio: audioEnabled ? { deviceId: audioDeviceId || undefined } : false,
      video: videoEnabled ? { deviceId: videoDeviceId || undefined } : false,
    }),
    [audioEnabled, videoEnabled, audioDeviceId, videoDeviceId]
  )
  const onError = React.useCallback(() => setFailed(true), [])
  const tracks = usePreviewTracks(options, onError)
  const video = tracks?.find((t) => t.kind === Track.Kind.Video) as
    LocalVideoTrack | undefined
  const audio = tracks?.find((t) => t.kind === Track.Kind.Audio) as
    LocalAudioTrack | undefined
  // Device labels only show once the browser has granted access.
  const cameras = useMediaDevices({ kind: "videoinput" })
  const microphones = useMediaDevices({ kind: "audioinput" })

  return (
    // The same frame as the meeting, with the lobby in its middle; a short
    // window scrolls instead of cutting it off.
    <div className="fixed top-18 right-6 bottom-6 left-6 flex flex-col overflow-y-auto md:top-22">
      <div className="m-auto flex w-full max-w-2xl flex-col gap-6">
        <h1 className="text-title font-medium">{title}</h1>
        <Preview track={video} />
        <Level track={audio} />
        {failed && (
          <p className="text-destructive">
            開不了鏡頭或麥克風，請在瀏覽器網址列允許使用
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <DeviceRow
            on={userChoices.audioEnabled}
            onToggle={() => saveAudioInputEnabled(!userChoices.audioEnabled)}
            onLabel="關麥克風"
            offLabel="開麥克風"
            onIcon={<MicIcon />}
            offIcon={<MicOffIcon />}
            devices={microphones}
            value={userChoices.audioDeviceId || deviceOf(audio)}
            onPick={saveAudioInputDeviceId}
            placeholder="麥克風"
          />
          <DeviceRow
            on={userChoices.videoEnabled}
            onToggle={() => saveVideoInputEnabled(!userChoices.videoEnabled)}
            onLabel="關鏡頭"
            offLabel="開鏡頭"
            onIcon={<VideoIcon />}
            offIcon={<VideoOffIcon />}
            devices={cameras}
            value={userChoices.videoDeviceId || deviceOf(video)}
            onPick={saveVideoInputDeviceId}
            placeholder="鏡頭"
          />
        </div>
        <Button
          autoFocus
          onClick={() =>
            onJoin({
              audio: userChoices.audioEnabled,
              video: userChoices.videoEnabled,
              audioDeviceId: userChoices.audioDeviceId,
              videoDeviceId: userChoices.videoDeviceId,
            })
          }
        >
          加入會議
        </Button>
      </div>
    </div>
  )
}

// The device a preview track opened when none was picked: the default.
const deviceOf = (track?: LocalAudioTrack | LocalVideoTrack) =>
  track?.mediaStreamTrack.getSettings().deviceId ?? ""

// The camera as others will see it, mirrored like the tile in the meeting.
function Preview({ track }: { track?: LocalVideoTrack }) {
  const ref = React.useRef<HTMLVideoElement>(null)
  React.useEffect(() => {
    const element = ref.current
    if (!element || !track) return
    track.attach(element)
    return () => {
      track.detach(element)
    }
  }, [track])
  return (
    <div className="relative aspect-video overflow-hidden rounded-control bg-muted">
      {track ? (
        <video
          ref={ref}
          muted
          playsInline
          className="absolute inset-0 size-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          鏡頭已關
        </div>
      )}
    </div>
  )
}

// A bar that moves with the microphone, so a muted or wrong device shows
// before anyone has to say "can you hear me".
function Level({ track }: { track?: LocalAudioTrack }) {
  const bar = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!track?.mediaStreamTrack) return
    const context = new AudioContext()
    const source = context.createMediaStreamSource(
      new MediaStream([track.mediaStreamTrack])
    )
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    let frame = 0
    const draw = () => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const sample of samples)
        peak = Math.max(peak, Math.abs(sample - 128))
      if (bar.current)
        bar.current.style.transform = `scaleX(${Math.min(1, (peak / 128) * 2.5)})`
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      void context.close()
    }
  }, [track])
  return (
    <div
      aria-hidden
      className={cn(
        "h-2 overflow-hidden rounded-full bg-muted",
        !track && "opacity-50"
      )}
    >
      <div ref={bar} className="h-full origin-left scale-x-0 bg-primary" />
    </div>
  )
}

function DeviceRow({
  on,
  onToggle,
  onLabel,
  offLabel,
  onIcon,
  offIcon,
  devices,
  value,
  onPick,
  placeholder,
}: {
  on: boolean
  onToggle: () => void
  onLabel: string
  offLabel: string
  onIcon: React.ReactNode
  offIcon: React.ReactNode
  devices: MediaDeviceInfo[]
  value: string
  onPick: (deviceId: string) => void
  placeholder: string
}) {
  const items = devices
    .filter((device) => device.deviceId)
    .map((device, i) => ({
      value: device.deviceId,
      label: device.label || `${placeholder} ${i + 1}`,
    }))
  return (
    <div className="flex items-center gap-3">
      <Button
        variant={on ? "outline" : "default"}
        size="icon"
        aria-label={on ? onLabel : offLabel}
        aria-pressed={on}
        onClick={onToggle}
      >
        {on ? onIcon : offIcon}
      </Button>
      <Select
        value={items.some((item) => item.value === value) ? value : null}
        items={items}
        onValueChange={(next) => next && onPick(String(next))}
        disabled={!on || items.length === 0}
      >
        <SelectTrigger aria-label={placeholder} className="min-w-0 flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
