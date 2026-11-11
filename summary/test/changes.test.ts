import { describe, expect, test } from "bun:test"
import { applyChanges, firstObject, type Summary } from "../src/summarize.js"

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
      questions_remove: [1],
      questions_set: { "2": "報告由誰寫？" },
      decisions_add: ["測試資料用上個月的。"],
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
      questions_remove: [9],
      questions_set: { "7": "不存在", "1": "" },
      questions_add: [""],
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

describe("firstObject", () => {
  test("skips a heading and a code fence", () => {
    expect(
      firstObject('任務一：改寫摘要\n```json\n{"summary":"好"}\n```')
    ).toBe('{"summary":"好"}')
  })

  test("stops at the end of the first object", () => {
    expect(firstObject('{"a":{"b":1}}}}')).toBe('{"a":{"b":1}}')
    expect(firstObject('{"a":1}\n\nWait, I must fix: {"a":2}')).toBe('{"a":1}')
  })

  test("braces and quotes inside a string do not count", () => {
    const text = '{"summary":"用 {id} 與 \\"引號\\" 的句子}"}'
    expect(firstObject(text + " 多的字")).toBe(text)
  })

  test("an object that never closes is an error", () => {
    expect(() => firstObject('{"summary":"沒寫完')).toThrow("not JSON")
    expect(() => firstObject("沒有物件")).toThrow("not JSON")
  })
})
