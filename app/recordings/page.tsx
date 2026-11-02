import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { MeetShell } from "@/components/meet-shell"
import { PageHeader } from "@/components/page-header"
import { runAction } from "@/lib/actions/define"
import { listMyRecordings } from "@/lib/actions/recordings"
import { requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

const when = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
})

const minutes = (from: Date, to: Date) =>
  Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000))

// The member's own meetings: rooms they were in while it recorded, their
// project groups' meetings, and rooms they opened or booked.
export default async function RecordingsPage() {
  const actor = await requireActor("/recordings")
  const { recordings } = await runAction(listMyRecordings, actor, {})
  return (
    <MeetShell page={{ label: "會議紀錄", href: "/recordings", tip: "" }}>
      <div className="flex flex-col gap-12">
        <PageHeader title="會議紀錄" />
        {recordings.length === 0 ? (
          <EmptyState noun="會議紀錄" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {recordings.map((rec) => (
              <li key={rec.id} className="border-b">
                <Link
                  href={`/recordings/${encodeURIComponent(rec.id)}`}
                  prefetch
                  className="flex min-h-20 flex-col justify-center py-4"
                >
                  <span className="truncate font-medium">{rec.title}</span>
                  <span className="truncate text-muted-foreground tabular-nums">
                    {`${when.format(rec.startedAt)}，${minutes(rec.startedAt, rec.endedAt)} 分鐘，${rec.group || rec.opener}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MeetShell>
  )
}
