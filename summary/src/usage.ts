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
