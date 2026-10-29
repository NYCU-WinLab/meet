import { AppShell } from "@/components/app-shell"
import { LiveRefresh } from "@/components/live-refresh"
import { getSession } from "@/lib/auth/session"

// Meet's corners: the lab and the page in the breadcrumb, the member's
// account in the top right, the build in the bottom left.
export async function MeetShell({
  page,
  layout,
  live = true,
  footer = true,
  topRight,
  children,
}: {
  page?: { label: string; href: string; tip: string }
  layout?: "column" | "spotlight" | "wide"
  /** Refresh when rooms change; off inside a meeting, which is live itself. */
  live?: boolean
  /** Hide the bottom corners; the meeting uses that space for its controls. */
  footer?: boolean
  /** Replaces the account in the top right; the meeting puts its controls there. */
  topRight?: React.ReactNode
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
      footer={footer}
      corners={topRight ? { topRight } : undefined}
      account={
        session
          ? {
              label: session.user.name,
              href: "https://portal.winlab.tw/members",
              tip: session.user.email,
            }
          : { label: "登入", href: "/sign-in", tip: "" }
      }
    >
      {live && <LiveRefresh />}
      {children}
    </AppShell>
  )
}
