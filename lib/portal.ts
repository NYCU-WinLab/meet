// What meet reads from portal with its API key: the lab's project groups
// (the slug files a recording under the right project, and its members
// may open that project's recordings) and a booking's agenda when its room opens.
import { agendaList, type AgendaIn } from "@/lib/agenda"

export type ProjectGroup = { name: string; label: string }

/** A group with its members' usernames, to decide who may open its
 * recordings. */
type GroupMembers = ProjectGroup & { members: string[] }

let cache: { at: number; groups: GroupMembers[] } | null = null
const ttl = 5 * 60 * 1000

export async function projectGroups(): Promise<ProjectGroup[]> {
  return (await groupsWithMembers()).map(({ name, label }) => ({ name, label }))
}

/** The usernames in each project group, by slug. */
export async function groupMembers(): Promise<Map<string, string[]>> {
  return new Map((await groupsWithMembers()).map((g) => [g.name, g.members]))
}

async function groupsWithMembers(): Promise<GroupMembers[]> {
  if (cache && Date.now() - cache.at < ttl) return cache.groups
  const key = process.env.PORTAL_API_KEY
  if (!key) return []
  const response = await fetch(
    "https://portal.winlab.tw/api/actions/list_project_groups",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    }
  )
  if (!response.ok) throw new Error(`portal ${response.status}`)
  const data = (await response.json()) as {
    groups: (ProjectGroup & { members?: { username?: string | null }[] })[]
  }
  const groups = data.groups
    .map(({ name, label, members }) => ({
      name,
      label,
      members: (members ?? []).flatMap((m) => (m.username ? [m.username] : [])),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-TW"))
  cache = { at: Date.now(), groups }
  return groups
}

export type BookingAgenda = {
  status: "booked" | "cancelled"
  items: AgendaIn[]
}

/** A booking's agenda as portal has it now, or null when portal does not
 * answer within 5 seconds; the caller keeps what it stored. */
export async function bookingAgenda(
  booking: string
): Promise<BookingAgenda | null> {
  const key = process.env.PORTAL_API_KEY
  if (!key) return null
  try {
    const response = await fetch(
      "https://portal.winlab.tw/api/actions/get_booking_agenda",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ booking }),
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!response.ok) return null
    const data = (await response.json()) as {
      status?: unknown
      items?: { text?: unknown; source?: unknown; url?: unknown }[]
    }
    const items = agendaList.safeParse(
      (data.items ?? []).map((item) => ({
        text: String(item.text ?? "").slice(0, 200),
        source: item.source === "issue" ? "issue" : "booking",
        ...(typeof item.url === "string" ? { url: item.url } : {}),
      }))
    )
    if (!items.success) return null
    return {
      status: data.status === "cancelled" ? "cancelled" : "booked",
      items: items.data,
    }
  } catch {
    return null
  }
}
