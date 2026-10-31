"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { Button, buttonVariants } from "@/components/ui/button"
import type { RoomSummary } from "@/lib/livekit"

import { endRoomAction } from "./actions"

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

// Every open room as one row: title, who is in it, and the way in. Rooms
// booked ahead follow, with when they start.
export function RoomList({
  rooms,
  scheduled,
}: {
  rooms: RoomSummary[]
  scheduled: Scheduled[]
}) {
  const router = useRouter()
  const [ending, startEnding] = React.useTransition()

  if (rooms.length === 0 && scheduled.length === 0)
    return <EmptyState noun="會議室" />

  return (
    <ul className="flex stagger-rise flex-col">
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
      {rooms.map((room) => (
        <li
          key={room.name}
          className="flex min-h-20 flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:gap-6"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{room.title}</span>
            <span className="truncate text-muted-foreground">
              {room.participants.length > 0
                ? room.participants.map((p) => p.name).join("、")
                : `${room.createdBy} 於 ${time.format(room.createdAt)} 開的，還沒有人`}
            </span>
          </div>
          <div className="flex shrink-0 gap-3">
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
        </li>
      ))}
    </ul>
  )
}
