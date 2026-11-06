"use client"

import {
  useIsMuted,
  useParticipantAttributes,
  useRoomContext,
} from "@livekit/components-react"
import { RoomEvent, Track, type Participant } from "livekit-client"
import { EllipsisIcon } from "lucide-react"
import { useParams } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { moderateAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Host controls: the member who opened the room can mute someone, stop
// their camera, lower their hand or remove them. The server checks who is
// host on every call (moderate_participant); this flag only shows the menu.

const HostContext = React.createContext(false)
export const HostProvider = HostContext.Provider

const TOPIC = "meet.moderation"
const told: Record<string, string> = {
  mute_mic: "主持人已將你靜音",
  stop_camera: "主持人已關閉你的鏡頭",
  lower_hand: "主持人已放下你的手",
}

/** Tells me what the host did to me. */
export function ModerationListener() {
  const room = useRoomContext()
  React.useEffect(() => {
    const decoder = new TextDecoder()
    const onData = (
      payload: Uint8Array,
      participant?: Participant,
      _kind?: unknown,
      topic?: string
    ) => {
      // The server sends it, so there is no participant.
      if (topic !== TOPIC || participant) return
      const message = told[decoder.decode(payload)]
      if (message) toast(message)
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => {
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [room])
  return null
}

/** The host's menu on someone else's tile. */
export function TileModeration({ participant }: { participant: Participant }) {
  const host = React.useContext(HostContext)
  const { room } = useParams<{ room: string }>()
  const micMuted = useIsMuted({ source: Track.Source.Microphone, participant })
  const cameraMuted = useIsMuted({ source: Track.Source.Camera, participant })
  const { attributes } = useParticipantAttributes({ participant })
  if (!host || participant.isLocal) return null
  const name = participant.name || participant.identity
  const run = async (
    action: "mute_mic" | "stop_camera" | "lower_hand" | "remove",
    done: string
  ) => {
    const result = await moderateAction(room, participant.identity, action)
    if (result.ok) toast(done)
    else toast.error(result.error)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`管理 ${name}`}
            className="absolute top-3 right-16 bg-overlay text-muted-foreground backdrop-blur-md"
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={micMuted}
          onClick={() => void run("mute_mic", `已將 ${name} 靜音`)}
        >
          靜音
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={cameraMuted}
          onClick={() => void run("stop_camera", `已關閉 ${name} 的鏡頭`)}
        >
          關閉鏡頭
        </DropdownMenuItem>
        {attributes?.["meet.hand"] && (
          <DropdownMenuItem
            onClick={() => void run("lower_hand", `已放下 ${name} 的手`)}
          >
            放下手
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => void run("remove", `已請 ${name} 離開`)}
        >
          請出會議
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
