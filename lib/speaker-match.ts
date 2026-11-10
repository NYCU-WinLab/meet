// Names the diarized speakers of a recording's transcript (SPEAKER_00, …)
// from what the summary service heard live, where every line carries the
// name of the microphone it came from. The two transcripts are matched by
// text, not by time: the uploader cuts empty stretches out of a recording
// and joins a booking's parts, so a file's clock is not the meeting's.
//
// Each transcript segment is matched to the live line that shares most of
// its character pairs; the segment's length is a vote for that line's name.
// A speaker gets a name only when one name holds most of its votes and the
// votes cover a fair part of what it said. A room microphone's lines say
// "會議室": several people, so they never name a speaker.

export type Segment = { speaker: string; text: string }
export type LiveLine = { who: string; text: string }

/** A segment shorter than this ("好", "對") is too short to match. */
const MIN_CHARS = 6
/** Share of a segment's pairs a line must hold to count as the same words. */
const SAME_WORDS = 0.5
/** Share of a speaker's votes the leading name must hold. */
const LEADING = 0.7
/** Share of a speaker's text that must have matched any line at all. */
const COVERED = 0.3
/** The room microphone's label in the live lines. */
const ROOM = "會議室"

export type SpeakerMatch = {
  speaker: string
  /** The name given, or null when the evidence is not enough. */
  name: string | null
  /** The leading name and its share of the votes, for the log. */
  leading: string | null
  share: number
  /** How much of the speaker's text matched a live line. */
  covered: number
  chars: number
}

const clean = (text: string) =>
  text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")

function pairs(text: string) {
  const out = new Set<string>()
  const t = clean(text)
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

/** Strips the chat mark: typed lines are not speech, so they never vote. */
const spoken = (lines: LiveLine[]) =>
  lines.filter((line) => !line.who.endsWith("（聊天）") && line.text)

export function matchSpeakers(
  segments: Segment[],
  lines: LiveLine[]
): SpeakerMatch[] {
  const live = spoken(lines).map((line) => ({
    who: line.who,
    pairs: pairs(line.text),
  }))
  // Pair → the lines holding it, so a segment only scores lines it shares
  // something with.
  const index = new Map<string, number[]>()
  live.forEach((line, i) => {
    for (const pair of line.pairs) {
      const list = index.get(pair)
      if (list) list.push(i)
      else index.set(pair, [i])
    }
  })

  const votes = new Map<string, Map<string, number>>()
  const totals = new Map<string, number>()
  for (const segment of segments) {
    const chars = clean(segment.text).length
    totals.set(segment.speaker, (totals.get(segment.speaker) ?? 0) + chars)
    if (chars < MIN_CHARS) continue
    const mine = pairs(segment.text)
    const shared = new Map<number, number>()
    for (const pair of mine)
      for (const i of index.get(pair) ?? [])
        shared.set(i, (shared.get(i) ?? 0) + 1)
    let best = -1
    let bestCount = 0
    for (const [i, count] of shared)
      if (count > bestCount) {
        best = i
        bestCount = count
      }
    if (best < 0 || bestCount / mine.size < SAME_WORDS) continue
    const byName = votes.get(segment.speaker) ?? new Map<string, number>()
    const who = live[best].who
    byName.set(who, (byName.get(who) ?? 0) + chars)
    votes.set(segment.speaker, byName)
  }

  return [...totals.keys()].sort().map((speaker) => {
    const chars = totals.get(speaker) ?? 0
    const byName = votes.get(speaker) ?? new Map<string, number>()
    const voted = [...byName.values()].reduce((a, b) => a + b, 0)
    let leading: string | null = null
    let top = 0
    for (const [who, n] of byName)
      if (n > top) {
        leading = who
        top = n
      }
    const share = voted > 0 ? top / voted : 0
    const covered = chars > 0 ? voted / chars : 0
    const name =
      leading && leading !== ROOM && share >= LEADING && covered >= COVERED
        ? leading
        : null
    return { speaker, name, leading, share, covered, chars }
  })
}
