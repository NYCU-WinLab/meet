// Joins a room as a speaker and plays a 48 kHz mono s16le PCM file as its mic.
import { readFileSync } from "node:fs"
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"
const [roomName, file, holdSeconds] = process.argv.slice(2)
const room = new Room()
const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: "speaker", name: "講者" })
token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: false })
await room.connect(process.env.LIVEKIT_URL, await token.toJwt())
const source = new AudioSource(48000, 1)
const track = LocalAudioTrack.createAudioTrack("mic", source)
await room.localParticipant.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }))
console.log("speaking", roomName)
const pcm = readFileSync(file)
const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)
const step = 480 // 10 ms
for (let i = 0; i + step <= samples.length; i += step) {
  await source.captureFrame(new AudioFrame(samples.slice(i, i + step), 48000, 1, step))
}
await source.waitForPlayout()
console.log("done speaking")
await new Promise((r) => setTimeout(r, Number(holdSeconds ?? 10) * 1000))
await room.disconnect()
process.exit(0)
