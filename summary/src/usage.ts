// Tells meet what each Claude call used, so the dashboard can show what the
// agent costs. A report that fails is logged and dropped: the meeting goes on.
const meetUrl = process.env.MEET_URL ?? "https://meet.winlab.tw"
const key = process.env.MEET_SERVICE_KEY ?? ""

export type Usage = {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
  server_tool_use?: { web_search_requests?: number }
}

export function reportUsage(
  room: string,
  kind: "summary" | "answer",
  model: string,
  usage: Usage
) {
  if (!key) return
  void fetch(`${meetUrl}/api/actions/record_ai_usage`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      room,
      kind,
      model,
      inputTokens: usage.input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    }),
    signal: AbortSignal.timeout(5000),
  })
    .then((response) => {
      if (!response.ok)
        console.log(
          new Date().toISOString(),
          room,
          "usage report",
          response.status
        )
    })
    .catch((error) =>
      console.log(
        new Date().toISOString(),
        room,
        "usage report failed",
        String(error)
      )
    )
}

/**
 * Keeps the meeting's running summary and every line heard in meet, so the
 * recording page can show it after the meeting. Sent after each rewrite and
 * when the service leaves; a failure is logged and the next one replaces it.
 */
export function keepSummary(
  room: string,
  startedAt: number,
  summary: unknown,
  lines: { at: number; who: string; text: string }[]
) {
  if (!key) return
  void fetch(`${meetUrl}/api/actions/save_live_summary`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      room,
      startedAt: new Date(startedAt).toISOString(),
      summary,
      lines: lines.map(({ at, who, text }) => ({ at, who, text })),
    }),
    signal: AbortSignal.timeout(15_000),
  })
    .then((response) => {
      if (!response.ok)
        console.log(new Date().toISOString(), room, "keep", response.status)
    })
    .catch((error) =>
      console.log(new Date().toISOString(), room, "keep failed", String(error))
    )
}

/**
 * The summary and lines last kept for this room, when they are recent
 * enough to be the same meeting, or null. A failure is null too: the
 * meeting then starts a new summary, as it did before this existed.
 */
export async function keptSummary(room: string): Promise<{
  startedAt: number
  summary: Record<string, unknown>
  lines: { at: number; who: string; text: string }[]
} | null> {
  if (!key) return null
  try {
    const response = await fetch(`${meetUrl}/api/actions/get_live_summary`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ room }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`get_live_summary ${response.status}`)
    const data = (await response.json()) as {
      found?: boolean
      startedAt?: string
      summary?: Record<string, unknown>
      lines?: { at: number; who: string; text: string }[]
    }
    if (!data.found || !data.startedAt || !data.summary) return null
    return {
      startedAt: new Date(data.startedAt).getTime(),
      summary: data.summary,
      lines: data.lines ?? [],
    }
  } catch (error) {
    console.log(new Date().toISOString(), room, "resume failed", String(error))
    return null
  }
}
