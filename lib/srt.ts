// SubRip subtitles (what transcribe writes as <stem>.srt) as cues in ms.

export type Cue = { startMs: number; endMs: number; text: string }

/** "00:01:02,345" (or "01:02,345") in ms; NaN when it is not a time. */
function ms(stamp: string) {
  const match = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(stamp)
  if (!match) return NaN
  const [, h = "0", m, sec, frac] = match
  return (
    (Number(h) * 3600 + Number(m) * 60 + Number(sec)) * 1000 +
    Number(frac.padEnd(3, "0").slice(0, 3))
  )
}

export function parseSrt(source: string): Cue[] {
  return source
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").filter(Boolean)
      const at = lines.findIndex((line) => line.includes("-->"))
      if (at < 0) return []
      const [from, to] = lines[at].split("-->")
      const text = lines
        .slice(at + 1)
        .join(" ")
        .trim()
      const startMs = ms(from)
      const endMs = ms(to)
      if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs))
        return []
      return [{ startMs, endMs, text }]
    })
}
