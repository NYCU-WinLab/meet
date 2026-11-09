import { MeetShell } from "@/components/meet-shell"
import { StatusPage } from "@/components/status-page"
import { runAction } from "@/lib/actions/define"
import { guestLinkInfo } from "@/lib/actions/guests"

import { CONTROLS_SLOT } from "@/app/r/[room]/meeting"

import { GuestJoin } from "./guest-join"

export const dynamic = "force-dynamic"

// The way in for someone without a lab account. The secret in the link is
// their password; nothing else here needs a session.
export default async function GuestPage({ params }: PageProps<"/g/[secret]">) {
  const { secret } = await params
  let title: string
  try {
    ;({ title } = await runAction(
      guestLinkInfo,
      { userId: "", via: "web" },
      { secret }
    ))
  } catch {
    return (
      <MeetShell layout="spotlight" live={false}>
        <StatusPage title="這個訪客連結無效或已過期" />
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
      page={{ label: title, href: `/g/${secret}`, tip: "" }}
    >
      <GuestJoin secret={secret} title={title} />
    </MeetShell>
  )
}
