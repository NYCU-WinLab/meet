import { describe, expect, test } from "bun:test"
import { RoomMics } from "../src/room-mic.js"
import { parseDiarized } from "../src/transcribe.js"

describe("parseDiarized", () => {
  test("strips labels and counts speakers", () => {
    const heard = parseDiarized(
      "[SPEAKER_00] 那我們先看這個 workflow\n[SPEAKER_01] 主題詞是從國圖抓的嗎\n[SPEAKER_00] 對，缺的才用 AI 生成"
    )
    expect(heard.text).toBe(
      "那我們先看這個 workflow 主題詞是從國圖抓的嗎 對，缺的才用 AI 生成"
    )
    expect(heard.speakers).toBe(2)
  })

  test("a word or two from another speaker does not count", () => {
    const heard = parseDiarized(
      "[SPEAKER_00] 早期 NPU 叫做 network processing unit，現在可能是 neural processing unit\n[SPEAKER_01] 好"
    )
    expect(heard.speakers).toBe(1)
  })

  test("an undiarized transcript is one speaker", () => {
    expect(parseDiarized("只有一個人在講").speakers).toBe(1)
    expect(parseDiarized("").speakers).toBe(0)
  })
})

describe("RoomMics", () => {
  test("one chunk with several speakers is not enough", () => {
    const mics = new RoomMics()
    expect(mics.observe("a", 3)).toBe(false)
    expect(mics.observe("a", 1)).toBe(false)
    expect(mics.observe("a", 1)).toBe(false)
    expect(mics.has("a")).toBe(false)
  })

  test("2 of the last 3 chunks make a room microphone, and it stays one", () => {
    const mics = new RoomMics()
    mics.observe("a", 2)
    expect(mics.observe("a", 1)).toBe(false)
    expect(mics.observe("a", 4)).toBe(true)
    expect(mics.has("a")).toBe(true)
    expect(mics.observe("a", 1)).toBe(false)
    expect(mics.has("a")).toBe(true)
  })

  test("silent chunks are skipped and microphones are separate", () => {
    const mics = new RoomMics()
    mics.observe("a", 2)
    mics.observe("a", 0)
    mics.observe("b", 2)
    expect(mics.observe("a", 2)).toBe(true)
    expect(mics.has("b")).toBe(false)
  })
})
