import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { Input } from "@/components/ui/input"
import { MeetShell } from "@/components/meet-shell"
import { PageHeader } from "@/components/page-header"
import { runAction } from "@/lib/actions/define"
import { listMyRecordings, searchRecordings } from "@/lib/actions/recordings"
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

const clock = (second: number) =>
  `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`

// The member's own meetings: rooms they were in while it recorded, their
// project groups' meetings, and rooms they opened or booked. ?q= searches
// what was said in them; each hit opens the recording at that line.
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const actor = await requireActor("/recordings")
  const q = ((await searchParams).q ?? "").trim().slice(0, 100)
  const [{ recordings }, found] = await Promise.all([
    runAction(listMyRecordings, actor, {}),
    q ? runAction(searchRecordings, actor, { query: q, limit: 50 }) : null,
  ])
  return (
    <MeetShell page={{ label: "會議紀錄", href: "/recordings", tip: "" }}>
      <div className="flex flex-col gap-12">
        <PageHeader title="會議紀錄" />
        <form action="/recordings" role="search">
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="搜尋說過的話"
            aria-label="搜尋會議紀錄"
          />
        </form>
        {found ? (
          found.hits.length === 0 ? (
            <EmptyState noun="會議紀錄" query={q} />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {found.hits.map((hit, i) => (
                <li
                  key={`${hit.recordingId}-${hit.second}-${i}`}
                  className="border-b"
                >
                  <Link
                    href={hit.url}
                    className="flex min-h-20 flex-col justify-center py-4"
                  >
                    <span className="line-clamp-2">{hit.text}</span>
                    <span className="truncate text-muted-foreground tabular-nums">
                      {`${hit.title}，${when.format(hit.startedAt)}，${clock(hit.second)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : recordings.length === 0 ? (
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
