// One chunk of speech to text through the lab's transcribe service: a WAV in,
// a job id back, the transcript once the job is done. Silence is dropped
// before it leaves, so an open microphone with nobody talking costs nothing.
const base = process.env.TRANSCRIBE_URL ?? "https://transcribe.winlab.tw"
const token = process.env.TRANSCRIBE_TOKEN ?? ""
// Whisper guesses Japanese for Mandarin lectures when left to detect.
const language = process.env.SUMMARY_LANGUAGE ?? "zh"
/** A chunk quieter than this (RMS of 16-bit samples) is treated as silence. */
const quiet = Number(process.env.SUMMARY_QUIET_RMS ?? 300)
/** Less speech than this is not worth a job. */
const minMs = 2000

export async function transcribeChunk(
  pcm: Buffer,
  sampleRate: number
): Promise<string> {
  if (!token) throw new Error("TRANSCRIBE_TOKEN is not set")
  if (pcm.byteLength < (sampleRate * 2 * minMs) / 1000) return ""
  if (rms(pcm) < quiet) return ""
  const form = new FormData()
  form.set(
    "file",
    new Blob([wav(pcm, sampleRate)], { type: "audio/wav" }),
    "chunk.wav"
  )
  form.set("language", language)
  form.set("diarize", "false")
  const created = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  if (!created.ok) throw new Error(`transcribe ${created.status}`)
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
  return (await text.text()).replace(/\s+/g, " ").trim()
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
