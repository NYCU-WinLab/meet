import { MeetShell } from "@/components/meet-shell"
import { PageHeader } from "@/components/page-header"
import { SectionHeader } from "@/components/page-header"
import { dashboard } from "@/lib/actions/dashboard"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { Figures, WeeklyChart } from "./figures"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const actor = await requireActor("/dashboard")
  const data = await runAction(dashboard, actor, {})
  return (
    <MeetShell page={{ label: "儀表板", href: "/dashboard", tip: "" }}>
      <div className="flex flex-col gap-12">
        <PageHeader title="儀表板" />
        <section className="flex flex-col gap-6">
          <SectionHeader title="現在" />
          <Figures
            items={[
              { label: "會議室", value: data.now.rooms },
              { label: "人", value: data.now.members },
              { label: "錄影中", value: data.now.recording },
            ]}
          />
        </section>
        <section className="flex flex-col gap-6">
          <SectionHeader title="本週" />
          <Figures items={periodItems(data.thisWeek)} />
        </section>
        <section className="flex flex-col gap-6">
          <SectionHeader title="本月" />
          <Figures items={periodItems(data.thisMonth)} />
        </section>
        <section className="flex flex-col gap-6">
          <SectionHeader title="每週" />
          <WeeklyChart weeks={data.weekly} />
        </section>
      </div>
    </MeetShell>
  )
}

function periodItems(stats: {
  meetings: number
  memberMinutes: number
  recordings: number
  recordingMinutes: number
  recordingBytes: number
  failedRecordings: number
}) {
  return [
    { label: "會議", value: stats.meetings },
    { label: "人分鐘", value: stats.memberMinutes },
    { label: "錄影", value: stats.recordings },
    { label: "錄影分鐘", value: stats.recordingMinutes },
    { label: "錄影 GB", value: Math.round(stats.recordingBytes / 1e8) / 10 },
    { label: "錄影失敗", value: stats.failedRecordings },
  ]
}
