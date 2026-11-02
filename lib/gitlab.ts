// Finds the meeting record winlab-helper opened in the lab's GitLab for a
// recording, with a read_api token (GITLAB_API_TOKEN). The helper stamps
// each record's description with `winlab:booking request="<key>"`: the
// portal booking id for a booked room, else `meet:<owner>:<day>` (or that
// plus the egress id once a person closed the day's record).

const base = () => process.env.GITLAB_URL ?? "https://gitlab.winlab.tw"
const group = () => process.env.GITLAB_GROUP ?? "winlab"

export const gitlabConfigured = () => Boolean(process.env.GITLAB_API_TOKEN)

type Epic = { web_url: string; description: string | null; state: string }

/** The record's web URL for the first key found, or null. Searches the
 * lab's epics that mention meet.winlab.tw, updated from a day before the
 * recording started (filing a recording updates its record). */
export async function recordUrl(keys: string[], since: Date) {
  const token = process.env.GITLAB_API_TOKEN
  if (!token || keys.length === 0) return null
  const query = new URLSearchParams({
    search: "meet.winlab.tw",
    include_descendant_groups: "true",
    state: "all",
    updated_after: new Date(since.getTime() - 86_400_000).toISOString(),
    per_page: "100",
  })
  const response = await fetch(
    `${base()}/api/v4/groups/${encodeURIComponent(group())}/epics?${query}`,
    {
      headers: { "private-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }
  )
  if (!response.ok) throw new Error(`GitLab ${response.status}`)
  const epics = (await response.json()) as Epic[]
  for (const key of keys) {
    const marker = `request="${key}"`
    const found = epics.find((e) => e.description?.includes(marker))
    if (found) return found.web_url
  }
  return null
}
