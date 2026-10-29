import Link from "next/link"

import { MeetShell } from "@/components/meet-shell"
import { StatusPage } from "@/components/status-page"
import { buttonVariants } from "@/components/ui/button"
import { runAction } from "@/lib/actions/define"
import { joinRoom } from "@/lib/actions/rooms"
import { requireActor } from "@/lib/auth/session"

import { Meeting } from "./meeting"

export const dynamic = "force-dynamic"

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

  return (
    <MeetShell
      layout="wide"
      live={false}
      page={{ label: joined.title, href: `/r/${room}`, tip: "" }}
    >
      <Meeting
        title={joined.title}
        serverUrl={joined.serverUrl}
        token={joined.token}
      />
    </MeetShell>
  )
}
