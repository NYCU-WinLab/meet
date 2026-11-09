// Finds the meeting record winlab-helper opened in the lab's GitLab for a
// recording, with a read_api token (GITLAB_API_TOKEN). The helper stamps
// each record's description with `winlab:booking request="<key>"`: the
// portal booking id for a booked room, else `meet:<owner>:<day>` (or that
// plus the egress id once a person closed the day's record).

const base = () => process.env.GITLAB_URL ?? "https://gitlab.winlab.tw"
const group = () => process.env.GITLAB_GROUP ?? "winlab"

export const gitlabConfigured = () => Boolean(process.env.GITLAB_API_TOKEN)

type Epic = { web_url: string; description: string | null; state: string }

// GitLab answers 429 when a page asks for many records at once. Until the
// time it names in Retry-After (60 s when it names none), no search goes out
// and the record reads as not found yet, which the page already shows.
class GitlabBusy extends Error {}
let pausedUntil = 0

// A found record keeps its URL for a day; a miss is asked again after 5
// minutes, since winlab-helper files the record after the meeting.
const FOUND_MS = 86_400_000
const MISS_MS = 5 * 60_000
const cache = new Map<string, { url: string | null; until: number }>()

async function searchEpics(search: string, since?: Date) {
  if (Date.now() < pausedUntil) throw new GitlabBusy()
  const token = process.env.GITLAB_API_TOKEN ?? ""
  const query = new URLSearchParams({
    search,
    include_descendant_groups: "true",
    state: "all",
    per_page: "100",
  })
  if (since) query.set("updated_after", since.toISOString())
  const response = await fetch(
    `${base()}/api/v4/groups/${encodeURIComponent(group())}/epics?${query}`,
    {
      headers: { "private-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }
  )
  if (response.status === 429) {
    const wait = Number(response.headers.get("retry-after"))
    pausedUntil = Date.now() + (wait > 0 ? wait : 60) * 1000
    throw new GitlabBusy()
  }
  if (!response.ok) throw new Error(`GitLab ${response.status}`)
  return (await response.json()) as Epic[]
}

/** The record's web URL, or null. First by key: each record carries its
 * `winlab:booking request="<key>"` marker. Then by the recording's file name:
 * the helper may file a recording under a booking it matched by group and
 * time, whose record carries the booking's key instead, but its Recording
 * row always names the file `[<owner>] <YYYY-MM-DD> <title>.mp4`. */
export async function recordUrl(
  keys: string[],
  recording?: { fileName: string; title: string; since: Date }
) {
  if (!gitlabConfigured()) return null
  const id = JSON.stringify([keys, recording?.fileName ?? null])
  const hit = cache.get(id)
  if (hit && hit.until > Date.now()) return hit.url
  let url: string | null
  try {
    url = await findRecord(keys, recording)
  } catch (error) {
    if (error instanceof GitlabBusy) return null
    throw error
  }
  if (cache.size > 1000) cache.clear()
  cache.set(id, { url, until: Date.now() + (url ? FOUND_MS : MISS_MS) })
  return url
}

async function findRecord(
  keys: string[],
  recording?: { fileName: string; title: string; since: Date }
) {
  for (const key of keys) {
    const marker = `request="${key}"`
    const found = (await searchEpics(key)).find((e) =>
      e.description?.includes(marker)
    )
    if (found) return found.web_url
  }
  // GitLab searches only for three characters or more.
  if (recording && recording.title.length >= 3) {
    const marker = `[${recording.fileName}]`
    const since = new Date(recording.since.getTime() - 86_400_000)
    const found = (await searchEpics(recording.title, since)).find((e) =>
      e.description?.includes(marker)
    )
    if (found) return found.web_url
  }
  return null
}
