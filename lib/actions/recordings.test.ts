import { describe, expect, test } from "bun:test"

import { memberSpans } from "@/lib/actions/recordings"

const row = (
  event: string,
  at: number,
  extra: {
    participantSid?: string
    roomSid?: string
    seconds?: number
  } = {}
) => ({
  event,
  at: new Date(at),
  room: "r",
  roomSid: extra.roomSid ?? "RM1",
  participantSid: extra.participantSid ?? null,
  seconds: extra.seconds ?? null,
})

describe("memberSpans", () => {
  test("two devices with the last leave lost stay present until room_finished", () => {
    const spans = memberSpans([
      row("participant_joined", 1000, { participantSid: "PA" }),
      row("participant_joined", 2000, { participantSid: "PB" }),
      row("participant_left", 3000, { participantSid: "PA", seconds: 2 }),
      row("room_finished", 9000),
    ])
    expect(spans.get("r")).toEqual([[1000, 9000]])
  })

  test("a join with no end counts only at its own moment", () => {
    const spans = memberSpans([
      row("participant_joined", 1000, { participantSid: "PA" }),
      row("room_finished", 2000, { roomSid: "RM0" }),
    ])
    expect(spans.get("r")).toEqual([[1000, 1000]])
  })

  test("null sid keeps one join per room", () => {
    const spans = memberSpans([
      row("participant_joined", 1000),
      row("participant_left", 5000, { seconds: 4 }),
      row("participant_joined", 6000),
      row("room_finished", 8000),
    ])
    expect(spans.get("r")).toEqual([
      [1000, 5000],
      [6000, 8000],
    ])
  })

  test("a leave with a lost join still counts", () => {
    const spans = memberSpans([
      row("participant_left", 5000, { participantSid: "PA", seconds: 3 }),
    ])
    expect(spans.get("r")).toEqual([[2000, 5000]])
  })

  test("a leave with a sid ends a join written before sids", () => {
    const spans = memberSpans([
      row("participant_joined", 1000),
      row("participant_left", 2000, { participantSid: "PA", seconds: 1 }),
      row("room_finished", 9000),
    ])
    expect(spans.get("r")).toEqual([[1000, 2000]])
  })
})
