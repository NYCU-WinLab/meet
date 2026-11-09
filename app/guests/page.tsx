import { EmptyState } from "@/components/empty-state"
import { MeetShell } from "@/components/meet-shell"
import { PageHeader } from "@/components/page-header"
import { runAction } from "@/lib/actions/define"
import { listGuestLinks } from "@/lib/actions/guests"
import { requireActor } from "@/lib/auth/session"

import { RevokeButton } from "./revoke-button"

export const dynamic = "force-dynamic"

const when = new Intl.DateTimeFormat("zh-TW", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
})

// Guest links: a member sees the ones they made; an admin sees everyone's,
// with who made each one, when, and the names guests typed coming in.
export default async function GuestsPage() {
  const actor = await requireActor("/guests")
  const { admin, links } = await runAction(listGuestLinks, actor, {})
  return (
    <MeetShell page={{ label: "訪客連結", href: "/guests", tip: "" }}>
      <div className="flex flex-col gap-12">
        <PageHeader title={admin ? "所有訪客連結" : "我的訪客連結"} />
        {links.length === 0 ? (
          <EmptyState noun="訪客連結" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex min-h-20 items-center gap-6 border-b py-4"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {link.title || link.room}
                    {link.label ? `，給 ${link.label}` : ""}
                  </span>
                  <span className="truncate text-muted-foreground tabular-nums">
                    {[
                      admin ? `${link.madeBy || "某人"} 產生` : "",
                      `${when.format(link.createdAt)} 產生`,
                      link.revokedAt
                        ? `${when.format(link.revokedAt)} 撤銷`
                        : link.active
                          ? `${when.format(link.expiresAt)} 前有效`
                          : `${when.format(link.expiresAt)} 過期`,
                    ]
                      .filter(Boolean)
                      .join("，")}
                  </span>
                  <span className="truncate text-muted-foreground tabular-nums">
                    {link.guests.length === 0
                      ? "還沒有訪客進來"
                      : `訪客：${link.guests
                          .map((g) => `${g.name}（${when.format(g.joinedAt)}）`)
                          .join("、")}`}
                  </span>
                </div>
                {link.active && <RevokeButton id={link.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </MeetShell>
  )
}
