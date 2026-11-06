"use client"

import { useMediaDeviceSelect, useRoomContext } from "@livekit/components-react"
import { RoomEvent } from "livekit-client"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Speakers can be picked only where the browser can route audio (not Safari
// before 18, not Firefox without a flag).
const canPickOutput = () =>
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype

/**
 * The small arrow beside the microphone or camera control: a list of the
 * devices of that kind, with the one in use checked. Picking one switches the
 * live track; nobody has to leave the room. The microphone menu lists the
 * speakers too.
 */
export function DeviceMenu({
  kind,
  label,
}: {
  kind: "audioinput" | "videoinput"
  /** What the device is called in Chinese, e.g. 麥克風. */
  label: string
}) {
  // The meeting mounts only after the lobby, in the browser, so this reads
  // the browser directly.
  const output = kind === "audioinput" && canPickOutput()
  useFallbackNotice(kind, label)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="w-6"
            aria-label={`選擇${label}`}
          />
        }
      >
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80">
        <DeviceGroup kind={kind} label={label} />
        {output && (
          <>
            <DropdownMenuSeparator />
            <DeviceGroup kind="audiooutput" label="喇叭" />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DeviceGroup({
  kind,
  label,
}: {
  kind: MediaDeviceKind
  label: string
}) {
  const room = useRoomContext()
  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({ kind, room })
  const listed = devices.filter((device) => device.deviceId)
  // Chrome reports the system default as its own entry named "default".
  const active = activeDeviceId || "default"
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {listed.length === 0 && (
        <DropdownMenuItem disabled>沒有可用的{label}</DropdownMenuItem>
      )}
      {listed.map((device, i) => (
        <DropdownMenuItem
          key={device.deviceId}
          onClick={() =>
            setActiveMediaDevice(device.deviceId).catch(() =>
              toast.error(`換不了${label}`)
            )
          }
        >
          <CheckIcon
            aria-hidden
            className={device.deviceId === active ? undefined : "invisible"}
          />
          <span className="truncate">
            {device.label || `${label} ${i + 1}`}
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}

// When the device in use goes away (AirPods put back in the case), the
// browser falls back to the default; say so once.
function useFallbackNotice(kind: MediaDeviceKind, label: string) {
  const room = useRoomContext()
  React.useEffect(() => {
    const onChange = async () => {
      const id = room.getActiveDevice(kind)
      if (!id || id === "default") return
      const devices = await navigator.mediaDevices.enumerateDevices()
      if (devices.some((d) => d.kind === kind && d.deviceId === id)) return
      await room.switchActiveDevice(kind, "default").catch(() => undefined)
      toast(`${label}已中斷，改用預設${label}`)
    }
    room.on(RoomEvent.MediaDevicesChanged, onChange)
    return () => {
      room.off(RoomEvent.MediaDevicesChanged, onChange)
    }
  }, [room, kind, label])
}
