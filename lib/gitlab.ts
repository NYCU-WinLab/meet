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
 * lab's epics for each key in turn: the record links the recording on
 * Nextcloud, not on meet.winlab.tw, so the key is the one text it is sure
 * to hold. */
export async function recordUrl(keys: string[]) {
  const token = process.env.GITLAB_API_TOKEN
  if (!token) return null
  for (const key of keys) {
    const query = new URLSearchParams({
      search: key,
      include_descendant_groups: "true",
      state: "all",
      per_page: "20",
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
    const marker = `request="${key}"`
    const found = epics.find((e) => e.description?.includes(marker))
    if (found) return found.web_url
  }
  return null
}
