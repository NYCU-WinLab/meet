import { describe, expect, test } from "bun:test"
import { applyChanges, type Summary } from "../src/summarize.js"

const state: Summary = {
  summary: "談 RCS2 的進度。",
  questions: ["測試資料夠不夠？", "誰寫報告？"],
  improvements: ["補上延遲的量測。"],
  decisions: [],
  agenda: [{ id: "a1", text: "進度", status: "pending", note: "" }],
  updatedAt: "2026-11-10T00:00:00.000Z",
}

const contentOf = ({ updatedAt: _, ...content }: Summary) => content

describe("applyChanges", () => {
  test("an empty answer keeps everything", () => {
    expect(contentOf(applyChanges(state, {}))).toEqual(contentOf(state))
  })

  test("add, set and remove name items by their number", () => {
    const next = applyChanges(state, {
      questions: { remove: [1], set: { "2": "報告由誰寫？" } },
      decisions: { add: ["測試資料用上個月的。"] },
    })
    expect(next.questions).toEqual(["報告由誰寫？"])
    expect(next.decisions).toEqual(["測試資料用上個月的。"])
    expect(next.improvements).toEqual(state.improvements)
    expect(next.summary).toBe(state.summary)
  })

  test("a new summary replaces the old one, an empty one does not", () => {
    expect(applyChanges(state, { summary: "談 RCS2 與報告。" }).summary).toBe(
      "談 RCS2 與報告。"
    )
    expect(applyChanges(state, { summary: "" }).summary).toBe(state.summary)
  })

  test("a list written whole replaces the list", () => {
    expect(
      applyChanges(state, { questions: ["只剩這一題？"] }).questions
    ).toEqual(["只剩這一題？"])
  })

  test("numbers that match nothing and empty texts change nothing", () => {
    const next = applyChanges(state, {
      questions: { remove: [9], set: { "7": "不存在", "1": "" }, add: [""] },
    })
    expect(next.questions).toEqual(state.questions)
  })

  test("the agenda takes only the items listed", () => {
    const next = applyChanges(state, {
      agenda: [{ id: "a1", status: "done", note: "報告完成" }],
    })
    expect(next.agenda).toEqual([
      { id: "a1", text: "進度", status: "done", note: "報告完成" },
    ])
  })
})
