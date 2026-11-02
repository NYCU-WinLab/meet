"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import type { RoomSummary } from "@/lib/livekit"
import type { ProjectGroup } from "@/lib/portal"

import { endRoomAction } from "./actions"
import { CreateRoom } from "./create-room"

const time = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
})

const day = new Intl.DateTimeFormat("zh-TW", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
})

export type Scheduled = {
  name: string
  title: string
  prefix: string
  createdBy: string
  booking: string
  startsAt: Date
  endsAt: Date
  agenda: { text: string }[]
}

// The rooms as fixed slots, one per recorder: a slot holds an open room or
// is empty and opens one. Slots fill oldest first. Rooms booked ahead follow,
// with when they start; a booked room takes a free slot when it opens.
export function RoomList({
  rooms,
  maxRooms,
  scheduled,
  groups,
  self,
}: {
  rooms: RoomSummary[]
  maxRooms: number
  scheduled: Scheduled[]
  groups: ProjectGroup[]
  /** The member's username, the file prefix when no group is chosen. */
  self: string
}) {
  const router = useRouter()
  const [ending, startEnding] = React.useTransition()

  const open = [...rooms].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  )
  const slots = Array.from(
    { length: Math.max(maxRooms, open.length) },
    (_, i) => open[i]
  )
  const next = scheduled[0]
  // The next booking takes the first free slot, so only that slot names it.
  const firstFree = slots.findIndex((room) => !room)

  return (
    <div className="flex flex-col gap-12">
      <ul className="grid stagger-rise gap-6 md:grid-cols-2">
        {slots.map((room, i) => (
          <li
            key={room?.name ?? `free-${i}`}
            className="flex min-h-44 flex-col gap-6 rounded-surface bg-muted p-6"
          >
            <span className="text-muted-foreground">{`會議室 ${slotName(i)}`}</span>
            {room ? (
              <>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{room.title}</span>
                  <span className="truncate text-muted-foreground">
                    {room.participants.length > 0
                      ? room.participants.map((p) => p.name).join("、")
                      : `${room.createdBy} 於 ${time.format(room.createdAt)} 開的，還沒有人`}
                  </span>
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    disabled={ending}
                    onClick={() =>
                      startEnding(async () => {
                        const result = await endRoomAction(room.name)
                        if (!result.ok) toast.error(result.error)
                        else router.refresh()
                      })
                    }
                  >
                    結束
                  </Button>
                  <Link href={`/r/${room.name}`} className={buttonVariants()}>
                    進入
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">空的</span>
                  {next && i === firstFree && (
                    <span className="truncate text-muted-foreground">
                      {`下一個預約：${day.format(next.startsAt)} ${next.title}`}
                    </span>
                  )}
                </div>
                <div className="flex justify-end">
                  <CreateRoom groups={groups} self={self} />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {scheduled.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">預約</h2>
          <ul className="flex flex-col">
            {scheduled.map((room) => (
              <li
                key={room.name}
                className="flex min-h-20 flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:gap-6"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{room.title}</span>
                  <span className="truncate text-muted-foreground">
                    {`${room.createdBy} 預約，${day.format(room.startsAt)} 開始，${time.format(room.endsAt)} 結束${room.agenda.length > 0 ? `，議程 ${room.agenda.length} 項` : ""}`}
                  </span>
                </div>
                <div className="flex shrink-0 gap-3">
                  <Link href={`/r/${room.name}`} className={buttonVariants()}>
                    進入
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** A, B, C… for the slots. */
function slotName(i: number) {
  return String.fromCharCode(65 + i)
}
