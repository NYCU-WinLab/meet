// Claude list prices in US dollars per million tokens, for the dashboard's
// cost of the summary agent. Cache writes are the 5-minute kind (1.25 times
// input) and reads a tenth of input. A model missing here costs as Sonnet.
type Price = { input: number; output: number }

const prices: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
}

/** Web search: 10 dollars per 1,000 searches. */
const SEARCH = 0.01

export function costOf(usage: {
  model: string
  inputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
  webSearches: number
}) {
  const price = prices[usage.model] ?? prices["claude-sonnet-5-5"]
  const perToken = (perMillion: number) => perMillion / 1e6
  return (
    usage.inputTokens * perToken(price.input) +
    usage.cacheWriteTokens * perToken(price.input * 1.25) +
    usage.cacheReadTokens * perToken(price.input * 0.1) +
    usage.outputTokens * perToken(price.output) +
    usage.webSearches * SEARCH
  )
}
