// SubRip subtitles (what transcribe writes as <stem>.srt) as cues in ms.

export type Cue = { startMs: number; endMs: number; text: string }

/** "00:01:02,345" in ms. */
function ms(stamp: string) {
  const [h, m, rest] = stamp.trim().split(":")
  return Math.round(
    (Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(",", "."))) * 1000
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
