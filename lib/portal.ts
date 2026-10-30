// The lab's project groups, from portal: the slug prefixes a recording's
// file name so the GitLab helper files it under the right project.
export type ProjectGroup = { name: string; label: string }

let cache: { at: number; groups: ProjectGroup[] } | null = null
const ttl = 5 * 60 * 1000

export async function projectGroups(): Promise<ProjectGroup[]> {
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
  const data = (await response.json()) as { groups: ProjectGroup[] }
  const groups = data.groups
    .map(({ name, label }) => ({ name, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-TW"))
  cache = { at: Date.now(), groups }
  return groups
}
