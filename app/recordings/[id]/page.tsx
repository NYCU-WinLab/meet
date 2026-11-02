import { notFound } from "next/navigation"

import { FieldList, FieldRow } from "@/components/field-list"
import { MeetShell } from "@/components/meet-shell"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { buttonVariants } from "@/components/ui/button"
import { runAction } from "@/lib/actions/define"
import { getRecording } from "@/lib/actions/recordings"
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

const kinds: [suffix: string, label: string][] = [
  [".mp4", "錄影"],
  [".notes.md", "摘要"],
  [".txt", "逐字稿"],
  [".srt", "字幕"],
]

function size(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

// One meeting: the recording to watch or download, its notes, and the
// GitLab record winlab-helper filed it under.
export default async function RecordingPage({
  params,
}: PageProps<"/recordings/[id]">) {
  const { id } = await params
  const recordingId = decodeURIComponent(id)
  const actor = await requireActor(`/recordings/${id}`)
  const rec = await runAction(getRecording, actor, { id: recordingId }).catch(
    () => null
  )
  if (!rec) notFound()
  const href = (name: string) =>
    `/api/recordings/${encodeURIComponent(rec.id)}/${encodeURIComponent(name)}`
  const files = (rec.files ?? []).flatMap((file) => {
    const kind = kinds.find(([suffix]) => file.name.endsWith(suffix))
    return kind ? [{ ...file, label: kind[1] }] : []
  })
  const video = files.find((f) => f.name.endsWith(".mp4"))
  return (
    <MeetShell page={{ label: "會議紀錄", href: "/recordings", tip: "" }}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={rec.title}
          actions={
            rec.gitlab ? (
              <a
                href={rec.gitlab}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                GitLab
              </a>
            ) : undefined
          }
        />
        {video && (
          <video
            controls
            preload="metadata"
            src={href(video.name)}
            className="aspect-video w-full bg-muted"
          />
        )}
        <FieldList>
          <FieldRow label="時間">
            <span className="tabular-nums">{`${when.format(rec.startedAt)} 到 ${when.format(rec.endedAt)}`}</span>
          </FieldRow>
          <FieldRow label="歸檔">{rec.group || rec.opener}</FieldRow>
          <FieldRow label="GitLab">
            {rec.gitlab ? (
              <a
                href={rec.gitlab}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {rec.gitlab.replace(/^https:\/\//, "")}
              </a>
            ) : (
              <span className="text-muted-foreground">還沒歸檔</span>
            )}
          </FieldRow>
        </FieldList>
        <section className="flex flex-col gap-6">
          <SectionHeader title="檔案" />
          {files.length === 0 ? (
            <p className="text-muted-foreground">還沒有檔案</p>
          ) : (
            <ul className="flex flex-col">
              {files.map((file) => (
                <li
                  key={file.name}
                  className="flex min-h-14 items-center justify-between gap-6 border-b py-2"
                >
                  <span>{file.label}</span>
                  <span className="flex items-center gap-6">
                    <span className="text-muted-foreground tabular-nums">
                      {size(file.bytes)}
                    </span>
                    <a
                      href={`${href(file.name)}?download`}
                      className={buttonVariants({ variant: "outline" })}
                    >
                      下載
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-6">
          <SectionHeader title="摘要" />
          {rec.notes ? (
            <div className="whitespace-pre-wrap">{rec.notes}</div>
          ) : (
            <p className="text-muted-foreground">還沒有摘要</p>
          )}
        </section>
      </div>
    </MeetShell>
  )
}
