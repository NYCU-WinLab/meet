"use client"

import {
  useIsSpeaking,
  useLocalParticipant,
  useParticipantAttributes,
  useParticipants,
} from "@livekit/components-react"
import type { Participant } from "livekit-client"
import { HandIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

// Raise hand: a participant attribute holding when the hand went up, so
// late joiners see it and the queue orders by who asked first. The hand
// comes down by itself after a few seconds of the person talking.

const HAND_ATTRIBUTE = "meet.hand"
/** Talking this long with a hand up lowers it. */
const SPOKE_MS = 3000

const raisedAt = (p: Participant) => p.attributes[HAND_ATTRIBUTE] || ""

/** Identities with a hand up, first raised first. */
export function useHandQueue() {
  const participants = useParticipants()
  return React.useMemo(
    () =>
      participants
        .filter((p) => raisedAt(p))
        .sort((a, b) => raisedAt(a).localeCompare(raisedAt(b)))
        .map((p) => p.identity),
    [participants]
  )
}

export function useMyHand() {
  const { localParticipant } = useLocalParticipant()
  const { attributes } = useParticipantAttributes({
    participant: localParticipant,
  })
  const up = Boolean(attributes?.[HAND_ATTRIBUTE])
  const set = React.useCallback(
    async (next: boolean) => {
      try {
        await localParticipant.setAttributes({
          [HAND_ATTRIBUTE]: next ? new Date().toISOString() : "",
        })
      } catch {
        toast.error(next ? "舉手失敗，請再試一次" : "放下手失敗，請再試一次")
      }
    },
    [localParticipant]
  )
  return { up, set }
}

/** Lowers my hand once I have been talking for a few seconds. */
export function LowerHandWhenSpeaking() {
  const { localParticipant } = useLocalParticipant()
  const speaking = useIsSpeaking(localParticipant)
  const { up, set } = useMyHand()
  React.useEffect(() => {
    if (!up || !speaking) return
    const timer = setTimeout(() => void set(false), SPOKE_MS)
    return () => clearTimeout(timer)
  }, [up, speaking, set])
  return null
}

/** The hand and the place in the queue, in a tile's top-left corner. */
export function TileHand({
  identity,
  queue,
}: {
  identity: string
  queue: string[]
}) {
  const place = queue.indexOf(identity)
  if (place < 0) return null
  return (
    <span
      aria-label={`舉手，第 ${place + 1} 位`}
      className="absolute top-3 left-3 flex h-10 items-center gap-1 rounded-control bg-primary px-3 font-medium text-primary-foreground tabular-nums [&_svg]:size-4"
    >
      <HandIcon aria-hidden />
      {place + 1}
    </span>
  )
}
