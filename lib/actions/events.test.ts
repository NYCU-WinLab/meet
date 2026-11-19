import { describe, expect, test } from "bun:test"

import { stayedSeconds } from "@/lib/actions/events"

describe("stayedSeconds", () => {
  test("is the time between join and leave", () => {
    expect(stayedSeconds(BigInt(1000), BigInt(1090))).toBe(90)
  })

  test("is null when joinedAt is 0", () => {
    expect(stayedSeconds(BigInt(0), BigInt(1_700_000_000))).toBeNull()
  })

  test("is null when joinedAt is later than the leave", () => {
    expect(stayedSeconds(BigInt(2000), BigInt(1000))).toBeNull()
  })
})
