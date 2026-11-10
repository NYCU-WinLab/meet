// Tells a room microphone (several people in one room around one laptop)
// from a microphone one member uses alone, from how many speakers each
// transcribed chunk holds. Measured 2026-11-10 on real recordings: one
// remote speaker gives 1 speaker per 30 s chunk; a meeting room gives 2 to 5.
// Diarization still splits a single voice now and then, so one chunk with
// several speakers is not enough: a microphone becomes a room microphone when
// 2 of its last 3 chunks with speech had several speakers, and stays one for
// the rest of the meeting.

/** Chunks with speech looked back on. */
const WINDOW = 3
/** Of those, how many must hold several speakers. */
const NEEDED = 2

export class RoomMics {
  private recent = new Map<string, number[]>()
  private rooms = new Set<string>()

  /** Whether this microphone is known to be a room microphone. */
  has(identity: string) {
    return this.rooms.has(identity)
  }

  /**
   * Records one chunk's speaker count for a microphone. Returns true when
   * this chunk turned it into a room microphone.
   */
  observe(identity: string, speakers: number): boolean {
    if (speakers <= 0 || this.rooms.has(identity)) return false
    const counts = [...(this.recent.get(identity) ?? []), speakers].slice(
      -WINDOW
    )
    this.recent.set(identity, counts)
    if (counts.filter((n) => n >= 2).length < NEEDED) return false
    this.rooms.add(identity)
    this.recent.delete(identity)
    return true
  }
}
