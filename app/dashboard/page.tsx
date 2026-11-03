import { MeetShell } from "@/components/meet-shell"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { dashboard } from "@/lib/actions/dashboard"
import { runAction } from "@/lib/actions/define"
import { listGroups } from "@/lib/actions/rooms"
import { requireActor } from "@/lib/auth/session"

import { GroupBars, Heatmap, TrendCard } from "./figures"

export const dynamic = "force-dynamic"

// Three questions: are the rooms enough, how are they used, and by whom.
// The operator's figures sit in one line at the bottom.
export default async function DashboardPage() {
  const actor = await requireActor("/dashboard")
  const [data, { groups }] = await Promise.all([
    runAction(dashboard, actor, {}),
    runAction(listGroups, actor, {}).catch(() => ({ groups: [] })),
  ])
  const labels = new Map(groups.map((g) => [g.name, g.label]))
  const { now, thisWeek, recordings } = data
  return (
    <MeetShell page={{ label: "儀表板", href: "/dashboard", tip: "" }}>
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-3">
          <PageHeader title="儀表板" />
          <p className="text-muted-foreground">
            {`現在 ${now.maxRooms} 間開了 ${now.rooms} 間、${now.members} 人在會議裡、${now.recording} 支錄影中`}
          </p>
        </div>
        <section className="grid gap-6 md:grid-cols-3">
          <TrendCard
            label="本週會議"
            unit="場"
            trend={data.meetings}
            note={`平均 ${thisWeek.avgMinutes} 分鐘、${thisWeek.avgMembers} 人`}
          />
          <TrendCard label="本週人小時" unit="小時" trend={data.memberHours} />
          <TrendCard
            label="本週滿格"
            unit="小時"
            trend={data.fullHours}
            note={`尖峰同時 ${thisWeek.peakRooms} 間`}
          />
        </section>
        <section className="flex flex-col gap-6">
          <SectionHeader title="哪個時段最擠（近 8 週）" />
          <Heatmap heat={data.heat} />
        </section>
        <section className="flex flex-col gap-6">
          <SectionHeader title="誰在用（本月）" />
          <GroupBars
            groups={data.groups.map((g) => ({
              ...g,
              label: labels.get(g.name) ?? g.label ?? g.name,
            }))}
          />
        </section>
        <section className="flex flex-col gap-6">
          <SectionHeader title="摘要 agent 花了多少" />
          <div className="grid gap-6 md:grid-cols-3">
            <TrendCard
              label="本週花費"
              unit="美元"
              trend={data.ai.cost}
              note={`本月 ${data.ai.month.costUsd} 美元，摘要 ${data.ai.month.summaries} 次、回答提問 ${data.ai.month.answers} 次`}
            />
          </div>
        </section>
        <p className="text-muted-foreground">
          {`本月錄影 ${recordings.count} 支、${Math.round(recordings.bytes / 1e8) / 10} GB、`}
          <span
            className={recordings.failed > 0 ? "text-destructive" : undefined}
          >
            {`失敗 ${recordings.failed} 支`}
          </span>
        </p>
      </div>
    </MeetShell>
  )
}
