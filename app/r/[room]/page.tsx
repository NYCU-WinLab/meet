import Link from "next/link"

import { MeetShell } from "@/components/meet-shell"
import { StatusPage } from "@/components/status-page"
import { buttonVariants } from "@/components/ui/button"
import { runAction } from "@/lib/actions/define"
import { FULL_MESSAGE, joinRoom } from "@/lib/actions/rooms"
import { requireActor } from "@/lib/auth/session"

import { CONTROLS_SLOT, Meeting } from "./meeting"

export const dynamic = "force-dynamic"

const when = new Intl.DateTimeFormat("zh-TW", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
})

export default async function RoomPage({ params }: PageProps<"/r/[room]">) {
  const { room } = await params
  const actor = await requireActor(`/r/${room}`)

  let joined
  try {
    joined = await runAction(joinRoom, actor, { name: room })
  } catch {
    return (
      <MeetShell layout="spotlight" live={false}>
        <StatusPage
          title="沒有這個會議室"
          action={
            <Link href="/" prefetch className={buttonVariants()}>
              回到會議室列表
            </Link>
          }
        />
      </MeetShell>
    )
  }

  if (joined.state !== "ready") {
    return (
      <MeetShell layout="spotlight" live={false}>
        <StatusPage
          title={
            joined.state === "early"
              ? `${joined.title} ${when.format(joined.startsAt)} 開始，${when.format(joined.opensAt)} 起可進入`
              : joined.state === "full"
                ? `${joined.title} 還不能開始：${FULL_MESSAGE}`
                : `${joined.title} 已結束`
          }
          action={
            <Link href="/" prefetch className={buttonVariants()}>
              回到會議室列表
            </Link>
          }
        />
      </MeetShell>
    )
  }

  return (
    <MeetShell
      layout="wide"
      live={false}
      footer={false}
      topRight={
        <div id={CONTROLS_SLOT} className="hidden items-center gap-3 md:flex" />
      }
      page={{ label: joined.title, href: `/r/${room}`, tip: "" }}
    >
      <Meeting
        serverUrl={joined.serverUrl}
        token={joined.token}
        endsAt={joined.endsAt}
      />
    </MeetShell>
  )
}
