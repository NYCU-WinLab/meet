"use client"

import { useLocalParticipant, useRoomContext } from "@livekit/components-react"
import { RoomEvent, type RemoteParticipant } from "livekit-client"
import { SmilePlusIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// Emoji reactions: a quick 👍 without unmuting or typing. They travel on
// the data channel, are never stored, and float up over the sender's tile.

export const REACTIONS = ["👍", "👏", "😂", "❤️", "🎉", "🤔"] as const
const TOPIC = "meet.reaction"
/** At most this many reactions per person in WINDOW_MS, sent or shown. */
const LIMIT = 5
const WINDOW_MS = 3000
const SHOW_MS = 3000

type Shown = { id: number; emoji: string; lane: string }

// Lanes across the tile, so quick reactions do not stack on one spot.
const LANES = ["left-1/5", "left-2/5", "left-3/5", "left-1/10", "left-1/2"]

// One store for the room: identity -> reactions on screen now.
const shown = new Map<string, Shown[]>()
const listeners = new Set<() => void>()
const recent = new Map<string, number[]>()
let next = 0

function emit() {
  for (const listener of listeners) listener()
}

/** Whether this person may react again, counting the reaction if so. */
function allow(identity: string) {
  const now = Date.now()
  const times = (recent.get(identity) ?? []).filter((t) => now - t < WINDOW_MS)
  if (times.length >= LIMIT) return false
  times.push(now)
  recent.set(identity, times)
  return true
}

function show(identity: string, emoji: string) {
  if (!REACTIONS.includes(emoji as (typeof REACTIONS)[number])) return
  if (!allow(identity)) return
  const id = next++
  const item = { id, emoji, lane: LANES[id % LANES.length] }
  shown.set(identity, [...(shown.get(identity) ?? []), item])
  emit()
  setTimeout(() => {
    shown.set(
      identity,
      (shown.get(identity) ?? []).filter((r) => r.id !== item.id)
    )
    emit()
  }, SHOW_MS)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const EMPTY: Shown[] = []

/** Reactions from others arrive here; mount once inside the room. */
export function ReactionListener() {
  const room = useRoomContext()
  React.useEffect(() => {
    const decoder = new TextDecoder()
    const onData = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string
    ) => {
      if (topic !== TOPIC || !participant) return
      show(participant.identity, decoder.decode(payload))
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => {
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [room])
  return null
}

/** The reactions floating over one person's tile. */
export function TileReactions({ identity }: { identity: string }) {
  const items = React.useSyncExternalStore(
    subscribe,
    () => shown.get(identity) ?? EMPTY,
    () => EMPTY
  )
  if (items.length === 0) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-12 h-0"
    >
      {items.map((item) => (
        <span
          key={item.id}
          className={cn(
            "absolute bottom-0 animate-float-away text-title motion-reduce:animate-none",
            item.lane
          )}
        >
          {item.emoji}
        </span>
      ))}
    </div>
  )
}

/** The control: a button that opens the 6 emoji. */
export function ReactionPicker() {
  const { localParticipant } = useLocalParticipant()
  const encoder = React.useMemo(() => new TextEncoder(), [])
  const send = (emoji: string) => {
    if (!allow(`self:${localParticipant.identity}`)) return
    show(localParticipant.identity, emoji)
    void localParticipant
      .publishData(encoder.encode(emoji), { reliable: true, topic: TOPIC })
      .catch(() => undefined)
  }
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button variant="outline" size="icon" aria-label="表情反應" />
              }
            />
          }
        >
          <SmilePlusIcon />
        </TooltipTrigger>
        <TooltipContent>表情反應</TooltipContent>
      </Tooltip>
      <PopoverContent className="flex w-auto gap-1 p-1">
        {REACTIONS.map((emoji) => (
          <Button
            key={emoji}
            variant="ghost"
            size="icon"
            aria-label={emoji}
            onClick={() => send(emoji)}
            className="text-title"
          >
            {emoji}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
