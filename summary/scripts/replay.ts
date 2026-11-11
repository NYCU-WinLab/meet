// Replays the saved lines of a past meeting through summarize() and adds up
// what the rewrites cost, to compare a prompt or timing change on real speech.
//
//   ANTHROPIC_API_KEY=... bun scripts/replay.ts lines.json [everyMs] [maxRewrites] [out.json]
//
// lines.json is the `lines` column of live_summaries: [{at, who, text}].
import { readFileSync, writeFileSync } from "node:fs"
import { initial, summarize } from "../src/summarize.js"

type Line = { at: number; who: string; text: string }

const [file, every = "45000", max = "1000", out] = process.argv.slice(2)
if (!file) throw new Error("usage: replay.ts lines.json [everyMs] [max] [out]")
const everyMs = Number(every)
const batchLines = Number(process.env.SUMMARY_BATCH_LINES ?? 40)

const lines = (JSON.parse(readFileSync(file, "utf8")) as Line[]).sort(
  (a, b) => a.at - b.at
)

// One batch per timer tick that heard something, as the service would cut them.
const batches: Line[][] = []
let lastTick = -1
for (const line of lines) {
  const tick = Math.floor((line.at - lines[0].at) / everyMs)
  const last = batches.at(-1)
  if (last && last.length < batchLines && tick === lastTick) last.push(line)
  else batches.push([line])
  lastTick = tick
}

// Every Anthropic answer passes through here: add up its usage.
const total = { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
const realFetch = globalThis.fetch
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const response = await realFetch(...args)
  if (String(args[0]).includes("api.anthropic.com") && response.ok) {
    const { usage } = (await response.clone().json()) as {
      usage: Record<string, number>
    }
    total.calls++
    total.input += usage.input_tokens ?? 0
    total.cacheWrite += usage.cache_creation_input_tokens ?? 0
    total.cacheRead += usage.cache_read_input_tokens ?? 0
    total.output += usage.output_tokens ?? 0
  }
  return response
}) as typeof fetch

const log = console.log
console.log = () => {}
let state = initial([])
const started = Date.now()
// A rewrite that fails keeps its lines for the next one, as the service does.
let waiting: Line[] = []
const failures: string[] = []
for (const batch of batches.slice(0, Number(max))) {
  waiting.push(...batch)
  try {
    state = await summarize(state, waiting, "replay")
    waiting = []
  } catch (error) {
    failures.push(String(error).slice(0, 120))
  }
}
console.log = log

if (out) writeFileSync(out, JSON.stringify(state, null, 2))
console.log(
  JSON.stringify({
    lines: batches.slice(0, Number(max)).flat().length,
    ...total,
    outputPerCall: Math.round(total.output / Math.max(total.calls, 1)),
    seconds: Math.round((Date.now() - started) / 1000),
    failures,
    stateChars: JSON.stringify(state).length,
    items: [state.questions, state.improvements, state.decisions].map(
      (list) => list.length
    ),
  })
)
