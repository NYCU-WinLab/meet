import {
  AppShell,
  BuildVersion,
  CornerLink,
  CornerTip,
} from "@/components/app-shell"
import { LiveRefresh } from "@/components/live-refresh"
import { getSession } from "@/lib/auth/session"

// Meet's corners: the lab and the page in the breadcrumb, the member's
// account next to the build in the bottom left.
export async function MeetShell({
  page,
  layout,
  live = true,
  children,
}: {
  page?: { label: string; href: string; tip: string }
  layout?: "column" | "spotlight" | "wide"
  /** Refresh when rooms change; off inside a meeting, which is live itself. */
  live?: boolean
  children: React.ReactNode
}) {
  const session = await getSession()
  return (
    <AppShell
      layout={layout}
      breadcrumb={[
        { label: "WinLab", href: "https://portal.winlab.tw", tip: "" },
        { label: "Meet", href: "/", tip: "" },
        ...(page ? [page] : []),
      ]}
      nav={[{ label: "會議室", href: "/", tip: "" }]}
      corners={{
        bottomLeft: (
          <>
            {session && (
              <CornerTip tip={session.user.email} corner="bottom-left">
                <CornerLink href="/profile" prefetch>
                  {session.user.name}
                </CornerLink>
              </CornerTip>
            )}
            <BuildVersion />
          </>
        ),
      }}
    >
      {live && <LiveRefresh />}
      {children}
    </AppShell>
  )
}
