import { describe, expect, test } from "bun:test"
import {
  applyChanges,
  firstObject,
  initial,
  kindOf,
  resumed,
  shown,
  type Summary,
} from "../src/summarize.js"

const state: Summary = {
  kind: "discussion",
  summary: "談 RCS2 的進度。",
  lists: {
    ...initial([]).lists,
    questions: ["測試資料夠不夠？", "誰寫報告？"],
    todos: ["補上延遲的量測。"],
  },
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
    expect(next.lists.questions).toEqual(["報告由誰寫？"])
    expect(next.lists.decisions).toEqual(["測試資料用上個月的。"])
    expect(next.lists.todos).toEqual(state.lists.todos)
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
      applyChanges(state, { questions: ["只剩這一題？"] }).lists.questions
    ).toEqual(["只剩這一題？"])
  })

  test("numbers that match nothing and empty texts change nothing", () => {
    const next = applyChanges(state, {
      questions_remove: [9],
      questions_set: { "7": "不存在", "1": "" },
      questions_add: [""],
    })
    expect(next.lists.questions).toEqual(state.lists.questions)
  })

  test("an item rewritten into a long one stays as it was", () => {
    const long = "補上延遲的量測；".repeat(15)
    const next = applyChanges(state, {
      todos_set: { "1": long },
      questions_set: { "1": "測試資料的筆數夠不夠？" },
    })
    expect(next.lists.todos).toEqual(state.lists.todos)
    expect(next.lists.questions[0]).toBe("測試資料的筆數夠不夠？")
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

describe("resumed", () => {
  test("keeps the text and lists, and the status of items still listed", () => {
    const kept = {
      ...state,
      agenda: [{ id: "a1", text: "進度", status: "done", note: "報告完成" }],
    }
    const next = resumed(kept, [
      { id: "a1", text: "進度", status: "pending", note: "" },
      { id: "b2", text: "預算", status: "pending", note: "" },
    ])
    expect(next.kind).toBe("discussion")
    expect(next.summary).toBe(state.summary)
    expect(next.lists.questions).toEqual(state.lists.questions)
    expect(next.agenda).toEqual([
      { id: "a1", text: "進度", status: "done", note: "報告完成" },
      { id: "b2", text: "預算", status: "pending", note: "" },
    ])
  })

  test("a kept summary with fields missing is still a summary", () => {
    expect(contentOf(resumed({}, []))).toEqual(contentOf(initial([])))
    // One kept before the kinds: its lists are left behind.
    const old = {
      summary: "舊的",
      questions: ["舊問題？"],
      decisions: ["舊決議"],
    }
    expect(contentOf(resumed(old, []))).toEqual({
      ...contentOf(initial([])),
      summary: "舊的",
    })
  })
})

describe("kinds", () => {
  const paperAgenda = [
    { id: "p1", text: "主講：王小明", status: "pending" as const, note: "" },
    {
      id: "p2",
      text: "論文：[DeepRM](https://example.org)",
      status: "pending" as const,
      note: "",
    },
  ]

  test("the lab meeting, or an agenda naming a paper, is a paper", () => {
    expect(kindOf("lab-meeting", [])).toBe("paper")
    expect(kindOf("", paperAgenda)).toBe("paper")
    expect(kindOf("tasa-satsim", state.agenda)).toBe("")
  })

  test("the model names the kind once, and never paper", () => {
    const undecided = initial([])
    expect(applyChanges(undecided, { kind: "paper" }).kind).toBe("")
    const report = applyChanges(undecided, {
      kind: "report",
      summary: "報告這週的進度。",
      points_add: ["王小明：測了 3 個 case。"],
    })
    expect(report.kind).toBe("report")
    expect(report.summary).toBe("")
    expect(report.lists.points).toEqual(["王小明：測了 3 個 case。"])
    expect(applyChanges(report, { kind: "discussion" }).kind).toBe("report")
  })

  test("a list of another kind is dropped", () => {
    const next = applyChanges(state, {
      points_add: ["不是討論的清單"],
      todos_add: ["寄出合約草稿。"],
    })
    expect(next.lists.points).toEqual([])
    expect(next.lists.todos).toEqual(["補上延遲的量測。", "寄出合約草稿。"])
  })

  test("a paper keeps its agenda as it is and shows it as about", () => {
    const paper = applyChanges(initial(paperAgenda, "paper"), {
      points_add: ["DeepRM 用強化學習排 cluster 的 job。"],
      agenda: [{ id: "p1", status: "done", note: "講完" }],
    })
    expect(paper.agenda).toEqual(paperAgenda)
    const page = shown(paper)
    expect(page.agenda).toEqual([])
    expect(page.about).toEqual([
      { text: "主講：王小明" },
      { text: "論文：[DeepRM](https://example.org)" },
    ])
    expect(page.sections).toEqual([
      { title: "重點", items: ["DeepRM 用強化學習排 cluster 的 job。"] },
      { title: "問答", items: [] },
      { title: "報告建議", items: [] },
    ])
  })

  test("a discussion shows its lists in order, an undecided meeting none", () => {
    expect(shown(state).sections.map(({ title }) => title)).toEqual([
      "結論",
      "待辦",
      "未決問題",
    ])
    expect(shown(initial([])).sections).toEqual([])
  })
})
