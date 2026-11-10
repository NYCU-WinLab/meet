// One chunk of speech to text through the lab's transcribe service: a WAV in,
// a job id back, the transcript once the job is done. Silence is dropped
// before it leaves, so an open microphone with nobody talking costs nothing.
// Each chunk is diarized: the speaker count tells a microphone that several
// people in one room share from a microphone one member uses alone.
import { Limiter, runWithBackoff } from "./limiter.js"

const base = process.env.TRANSCRIBE_URL ?? "https://transcribe.winlab.tw"
const token = process.env.TRANSCRIBE_TOKEN ?? ""
// Whisper guesses Japanese for Mandarin lectures when left to detect.
const language = process.env.SUMMARY_LANGUAGE ?? "zh"
/** A chunk quieter than this (RMS of 16-bit samples) is treated as silence. */
const quiet = Number(process.env.SUMMARY_QUIET_RMS ?? 300)
/** Less speech than this is not worth a job. */
const minMs = 2000

// Every microphone shares this: at most 2 jobs in flight, the rest wait.
const limiter = new Limiter({
  concurrency: Number(process.env.SUMMARY_TRANSCRIBE_CONCURRENCY ?? 2),
  maxQueued: Number(process.env.SUMMARY_TRANSCRIBE_MAX_QUEUE ?? 20),
  onDrop: (queued) =>
    stamp(
      "transcribe queue full, dropped the oldest chunk;",
      queued,
      "waiting"
    ),
})
const stamp = (...parts: unknown[]) =>
  console.log(new Date().toISOString(), ...parts)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** What one chunk said, and how many people said a real part of it. */
export type Heard = { text: string; speakers: number }

const nothing: Heard = { text: "", speakers: 0 }

export async function transcribeChunk(
  pcm: Buffer,
  sampleRate: number
): Promise<Heard> {
  if (!token) throw new Error("TRANSCRIBE_TOKEN is not set")
  if (pcm.byteLength < (sampleRate * 2 * minMs) / 1000) return nothing
  if (rms(pcm) < quiet) return nothing
  const form = new FormData()
  form.set(
    "file",
    new Blob([wav(pcm, sampleRate)], { type: "audio/wav" }),
    "chunk.wav"
  )
  form.set("language", language)
  form.set("diarize", "true")
  // The slot is held from the POST until the transcript is read, since the
  // service counts a job as in progress until then.
  return runWithBackoff(
    limiter,
    async () => {
      const created = await fetch(`${base}/api/jobs`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      })
      if (created.status === 429) {
        await created.body?.cancel()
        return { done: false, retryAfter: created.headers.get("retry-after") }
      }
      if (!created.ok) throw new Error(`transcribe ${created.status}`)
      return { done: true, value: await finish(created) }
    },
    { sleep, log: stamp }
  )
}

async function finish(created: Response): Promise<Heard> {
  const { job_id: job } = (await created.json()) as { job_id: string }
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const status = await fetch(`${base}/api/jobs/${job}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!status.ok) throw new Error(`transcribe job ${status.status}`)
    const { stage } = (await status.json()) as { stage?: string }
    if (stage === "error") throw new Error("transcribe job failed")
    if (stage === "done") break
  }
  const text = await fetch(`${base}/api/jobs/${job}/transcript.txt`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!text.ok) throw new Error(`transcript ${text.status}`)
  return parseDiarized(await text.text())
}

/** A speaker counts when they said at least this share of the chunk. */
const SPEAKER_SHARE = 0.15

/**
 * Reads a diarized transcript ("[SPEAKER_00] text" per line) into plain text
 * and the number of speakers. A speaker with a word or two ("好", "對") is
 * not counted: diarization splits those off a single voice too.
 */
export function parseDiarized(raw: string): Heard {
  const chars = new Map<string, number>()
  const parts: string[] = []
  for (const line of raw.split("\n")) {
    const match = /^\s*\[(SPEAKER_\d+)\]\s*(.*)$/.exec(line)
    const said = (match ? match[2] : line).trim()
    if (!said) continue
    parts.push(said)
    if (match) chars.set(match[1], (chars.get(match[1]) ?? 0) + said.length)
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim()
  const total = [...chars.values()].reduce((a, b) => a + b, 0)
  const speakers = [...chars.values()].filter(
    (n) => total > 0 && n / total >= SPEAKER_SHARE
  ).length
  return { text, speakers: Math.max(speakers, text ? 1 : 0) }
}

function rms(pcm: Buffer) {
  const samples = pcm.byteLength >> 1
  if (samples === 0) return 0
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * 2)
    sum += s * s
  }
  return Math.sqrt(sum / samples)
}

function wav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.byteLength, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, pcm])
}
