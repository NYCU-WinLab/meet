// The running summary, rewritten by a small model. It is handed the summary
// so far and only the lines said since, never the whole transcript, so every
// call costs about the same however long the meeting runs. The instructions
// are the same every call and sit in the prompt cache. The same model also
// answers questions asked with @agent in the chat; both calls send the same
// tools and instructions first, so they share that cached prefix.
import { reportUsage, type Usage } from "./usage.js"

const apiKey = process.env.ANTHROPIC_API_KEY ?? ""
const model = process.env.SUMMARY_MODEL ?? "claude-haiku-5-5"
/** How hard the model thinks: low, medium or high. */
const effort = process.env.SUMMARY_EFFORT ?? "medium"

const meetUrl = process.env.MEET_URL ?? "https://meet.winlab.tw"
const serviceKey = process.env.MEET_SERVICE_KEY ?? ""

// Web search for what the meeting cannot answer, and search_meetings for
// what was said in past meetings (meet's search_recordings, limited to
// meetings everyone in the room may open, since they all read the answer).
const tools = [
  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
  {
    name: "search_meetings",
    description:
      "Search past meeting transcripts that everyone in this room may open, for a word or phrase. Returns matching lines with the meeting title, date and a link to the recording at that moment.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A short keyword or phrase as it would be said, e.g. RCS2",
        },
      },
      required: ["query"],
    },
  },
]

type Hit = {
  title: string
  startedAt: string
  second: number
  text: string
  url: string
}

async function searchMeetings(
  query: string,
  asUsers: string[]
): Promise<Hit[]> {
  if (!serviceKey || asUsers.length === 0) return []
  const response = await fetch(`${meetUrl}/api/actions/search_recordings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, limit: 10, asUsers }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`search_recordings ${response.status}`)
  const data = (await response.json()) as { hits?: Hit[] }
  return (data.hits ?? []).map((hit) => ({
    ...hit,
    url: new URL(hit.url, meetUrl).toString(),
  }))
}

/** One agenda item and how far the meeting has covered it. */
export type AgendaState = {
  id: string
  text: string
  url?: string
  status: "pending" | "partial" | "done"
  /** What was said about it, at most 40 characters; "" until then. */
  note: string
}

export type Summary = {
  /** What the meeting has been about, a few short sentences. */
  summary: string
  /** Questions raised and not yet answered. */
  questions: string[]
  /** Things someone said should change or improve. */
  improvements: string[]
  /** What was decided. */
  decisions: string[]
  /** The booking's items; fixed, only their status and note change. */
  agenda: AgendaState[]
  /** ISO time of the last rewrite. */
  updatedAt: string
}

/** The state before anyone has spoken: only the agenda, all pending. */
export function initial(agenda: AgendaState[]): Summary {
  return {
    summary: "",
    questions: [],
    improvements: [],
    decisions: [],
    agenda,
    updatedAt: new Date().toISOString(),
  }
}

const instructions = `你是會議助理，有兩種任務。每次請求的第一行寫明是哪一種。

## 任務一：改寫摘要

你會收到「目前的摘要狀態」和「這之後新說的話」。只輸出要改的地方，格式是 JSON，不加說明、不加 code fence。沒寫到的欄位和項目保持原樣，不要重抄沒變的內容。新的話沒有帶來要改的地方，就輸出 {}。

狀態的欄位：
- summary：這場會議在談什麼，最多 5 句
- questions：提出但還沒有答案的問題
- improvements：有人說要改、要補、要做得更好的事
- decisions：已經定案的事
- agenda：議程項目

狀態裡 questions、improvements、decisions 的每一項有編號，例如 {"1":"…","2":"…"}。

輸出的欄位，每一個都可以省略：
- summary：要改才寫，寫出整段新的文字。
- questions_add、improvements_add、decisions_add：要新增的項目，例如 ["新項目"]。
- questions_set、improvements_set、decisions_set：要改寫的項目，例如 {"2":"改寫後的句子"}，鍵是編號。
- questions_remove、improvements_remove、decisions_remove：要移除的編號，例如 [3]。
- agenda：只列有變動的項目，每項 {id, status, note}。

議程規則：
1. 議程項目是固定的：不新增、不刪除、不改 id 和文字。
2. status 只有 pending（還沒談）、partial（談了一部分）、done（談完）。
3. 只有對話明確談到某項時才改它的 status，並寫 note：談了什麼，最多 40 字。
4. 沒有明確談到的項目不要列出來。

改寫規則：
1. 保留舊內容，只用新的話補充或修正；問題有了答案就用 questions_remove 移除，若成為定案則用 decisions_add 加進去。
2. 同一件事只寫一次：新的話和舊項目講同一件事，就用 _set 改寫那一項，不另外 _add。questions、improvements、decisions 各最多 8 項，超過就用 _set 合併或用 _remove 刪掉最不重要的。
3. 沒有根據的不寫，不猜，不補充逐字稿裡沒有的事。
4. 每個項目一句話，說清楚要做什麼、關於什麼。描述討論的事，不寫是誰提的、誰說的。只有逐字稿明講某人負責某件事時，才寫負責的人。
5. 逐字稿是語音辨識結果，可能有錯字或斷句錯誤，照意思理解。
6. 說話者後面標「（聊天）」的是會議聊天室打的字，不是語音；和口說內容一樣算進摘要與議程。
7. 只寫和會議主題有關的事；分享螢幕、連線、誰聽不到等會議操作不寫。
8. 說話者是「會議室」的，是同一個會議室裡多個人共用一支麥克風說的話，分不出是誰。
9. 說話者後面標「（螢幕分享）」的，是那個人分享螢幕時播出來的聲音，例如影片或另一場會議；裡面的話不一定是他本人說的。內容和會議主題有關就算進摘要與議程。
10. 請求裡若附「會議用詞」，那是這場會議的人名與專有名詞。逐字稿裡讀音相近的詞（例如 my agent 與 MaiAgent），一律照會議用詞的寫法寫。

## 任務二：回答提問

你會收到摘要狀態、最近的逐字稿，和聊天室裡一個 @agent 的提問。

1. 會議裡談過的事，照摘要和逐字稿回答。逐字稿沒有就說會議沒談到，不猜。
2. 會議外的事實、新聞、規格、文件，用 web_search 查，最多查 3 次。
2a. 問到以前的會議（上次、之前誰說過），用 search_meetings 查關鍵字，最多查 3 次；回答寫出是哪場會議、哪天。
3. 最多 5 句，純文字，不用 Markdown、不加標題、不列網址，系統會附上來源。
4. 網路資料用自己的話改寫成繁體中文，不貼原文。
5. 答不出來就直說，並說缺什麼資訊。

寫法（兩種任務都適用，簡化技術中文）：
- 一句一件事，一句不超過 30 字，不用「並且」「以及」串句子。
- 主動語態，寫出是誰做的。
- 用動詞，不用「進行」「做出」把動作變名詞。
- 數字用阿拉伯數字。
- 不用形容詞和副詞堆疊，不下評價。
- 同一個東西從頭到尾用同一個名字。
- 全文繁體中文；專有名詞、程式名稱、英文縮寫保留原文。`

/** The glossary line of a request, or "" without one. */
const glossaryOf = (words: string[]) =>
  words.length > 0 ? `會議用詞：${words.join("、")}\n\n` : ""

export async function summarize(
  current: Summary,
  fresh: { at: number; who: string; text: string }[],
  room: string,
  /** Names and terms of this meeting, spelled right. */
  glossary: string[] = []
): Promise<Summary> {
  const data = await call(
    [
      {
        role: "user",
        content: `任務：改寫摘要\n\n${glossaryOf(glossary)}目前的摘要狀態：\n${JSON.stringify(numbered(current))}\n\n${tooLong(current)}這之後新說的話：\n${transcript(fresh)}`,
      },
    ],
    // The summary never searches; the tool is listed only to keep the
    // cached prefix the same as the question's.
    { type: "none" }
  )
  const text = textOf(data)
  console.log(new Date().toISOString(), "summary usage", data.usage)
  reportUsage(room, "summary", model, data.usage)
  return applyChanges(current, JSON.parse(firstObject(text)))
}

/**
 * The first whole JSON object in the model's answer. The model sometimes
 * writes a heading or a code fence before it, and sometimes goes on after
 * it: one brace too many, or a second try under "Wait, I must fix". In a
 * replay of a real meeting that broke 3 rewrites in 120 when the answer was
 * read from the first brace to the last.
 */
export function firstObject(text: string): string {
  const start = text.indexOf("{")
  let depth = 0
  let inString = false
  for (let index = start; index >= 0 && index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (char === "\\") index++
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) return text.slice(start, index + 1)
  }
  throw new Error(`summary is not JSON: ${text.slice(0, 40)}`)
}

/** What the model answers: only what changed. Every field may be missing.
 * Each list has three flat fields, <list>_add, <list>_set and <list>_remove:
 * nested as {add, set, remove} the model lost count of its braces. */
type Changes = Record<string, unknown>

const LISTS = ["questions", "improvements", "decisions"] as const

/**
 * The state after the model's changes. The model writes only what changed,
 * so a rewrite costs a few new sentences and not the whole state again: on
 * 2026-11-10 a 95-minute meeting wrote the full state 224 times, 2,535
 * output tokens each.
 */
export function applyChanges(current: Summary, changes: Changes): Summary {
  const summary = Array.isArray(changes.summary)
    ? // The model sometimes answers the summary as a list of sentences.
      changes.summary.map(String).join("")
    : typeof changes.summary === "string"
      ? changes.summary
      : ""
  return {
    summary: summary.trim() || current.summary,
    ...(Object.fromEntries(
      LISTS.map((name) => [name, applyList(current[name], changes, name)])
    ) as Pick<Summary, (typeof LISTS)[number]>),
    agenda: applyAgenda(current.agenda, changes.agenda),
    updatedAt: new Date().toISOString(),
  }
}

// One list after its _add, _set and _remove fields; items are numbered from
// 1 as the model saw them. A plain array under the list's own name is the
// whole list written again, which the model may still do: take it as it is.
function applyList(items: string[], changes: Changes, name: string): string[] {
  const texts = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : []
  if (Array.isArray(changes[name])) return texts(changes[name])
  const add = changes[`${name}_add`]
  const set = changes[`${name}_set`]
  const remove = changes[`${name}_remove`]
  const removed = new Set(Array.isArray(remove) ? remove.map(Number) : [])
  const rewritten = new Map(
    set && typeof set === "object" && !Array.isArray(set)
      ? Object.entries(set).map(([number, text]) => [
          Number(number),
          String(text ?? "").trim(),
        ])
      : []
  )
  const kept = items.flatMap((item, index) => {
    const number = index + 1
    if (removed.has(number)) return []
    // An item rewritten to nothing stays as it was.
    return [rewritten.get(number) || item]
  })
  return [...kept, ...texts(add)]
}

const statuses = new Set(["pending", "partial", "done"])

// The model may only move an item's status and note: unknown ids, new items
// and renamed text are dropped, and the items keep their order.
function applyAgenda(items: AgendaState[], answer: unknown): AgendaState[] {
  if (!Array.isArray(answer)) return items
  const byId = new Map<string, { status?: unknown; note?: unknown }>()
  for (const entry of answer)
    if (entry && typeof entry === "object" && "id" in entry)
      byId.set(String(entry.id), entry)
  return items.map((item) => {
    const got = byId.get(item.id)
    if (!got) return item
    const status = statuses.has(String(got.status))
      ? (String(got.status) as AgendaState["status"])
      : item.status
    const note =
      typeof got.note === "string" ? got.note.trim().slice(0, 40) : item.note
    return { ...item, status, note }
  })
}

type Line = { at: number; who: string; text: string }

type Block = {
  type: string
  text?: string
  citations?: { url?: string; title?: string }[]
  id?: string
  name?: string
  input?: { query?: string }
}

type Response = {
  content: Block[]
  stop_reason: string
  usage: Usage
}

/** The state as the model sees it: no timestamp, no links. */
const stateOf = (current: Summary) => ({
  ...current,
  updatedAt: undefined,
  agenda: current.agenda.map(({ id, text, status, note }) => ({
    id,
    text,
    status,
    note,
  })),
})

/** The state for a rewrite: each list item under its number, so the model
 * can name the one it changes. */
const numbered = (current: Summary) => {
  const byNumber = (items: string[]) =>
    Object.fromEntries(items.map((item, index) => [index + 1, item]))
  return {
    ...stateOf(current),
    questions: byNumber(current.questions),
    improvements: byNumber(current.improvements),
    decisions: byNumber(current.decisions),
  }
}

/** The most items a list should hold; the instructions say the same. */
const LIST_ITEMS = 8

// A line naming the lists that grew past the limit, or "". The model adds
// more readily than it merges: in a replay of a real meeting the lists
// reached 22 items under a rule that only said "at most 8".
function tooLong(current: Summary): string {
  const long = LISTS.filter((name) => current[name].length > LIST_ITEMS)
  if (long.length === 0) return ""
  const counts = long.map((name) => `${name} 有 ${current[name].length} 項`)
  return `${counts.join("、")}，超過 ${LIST_ITEMS} 項：這次先用 _set 合併相近的項目、用 _remove 刪掉最不重要的，減到 ${LIST_ITEMS} 項以內。\n\n`
}

const transcript = (lines: Line[]) =>
  lines
    .map(
      (line) =>
        `[${new Date(line.at).toLocaleTimeString("zh-TW", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Taipei",
        })}] ${line.who}：${line.text}`
    )
    .join("\n")

const textOf = (data: Response) =>
  data.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")

// One Messages call. The tools and instructions come first and are cached,
// so the summary and the questions read the same prefix.
async function call(
  messages: { role: "user" | "assistant"; content: unknown }[],
  toolChoice: { type: "auto" | "none" }
): Promise<Response> {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      // Measured 2026-11-03 on a real 300-line meeting, 10 rewrites each:
      // Haiku with thinking took 18 s a call (4 s without) and wrote noisier
      // lists, so Haiku runs without it. Sonnet 5.5 cannot turn thinking
      // off and decides by itself; it wrote the clearest summary.
      thinking: model.includes("haiku")
        ? { type: "disabled" }
        : { type: "adaptive" },
      output_config: { effort },
      tools,
      tool_choice: toolChoice,
      system: [
        {
          type: "text",
          text: instructions,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    }),
  })
  if (!response.ok)
    throw new Error(`anthropic ${response.status}: ${await response.text()}`)
  return (await response.json()) as Response
}

/** How many recent lines a question sees besides the summary. */
const QUESTION_LINES = 200

/**
 * Answers one @agent question from the chat: the meeting from the summary
 * and the recent lines, anything else from a web search. Returns plain text
 * with up to 3 sources appended.
 */
export async function answer(
  current: Summary,
  lines: Line[],
  who: string,
  question: string,
  room: string,
  /** The meet user ids of everyone in the room: search_meetings finds only
   * meetings all of them may open, since the whole room reads the answer. */
  members: string[],
  glossary: string[] = []
): Promise<string> {
  const recent = [...lines].sort((a, b) => a.at - b.at).slice(-QUESTION_LINES)
  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    {
      role: "user",
      content: `任務：回答提問\n\n${glossaryOf(glossary)}目前的摘要狀態：\n${JSON.stringify(stateOf(current))}\n\n最近的逐字稿：\n${transcript(recent) || "（還沒有人說話）"}\n\n${who} 問：${question}`,
    },
  ]
  let data = await call(messages, { type: "auto" })
  reportUsage(room, "answer", model, data.usage)
  // A long search can pause the turn, and search_meetings runs here; send
  // the turn back until the model is done, at most 6 times.
  const recordings: string[] = []
  for (
    let i = 0;
    i < 6 &&
    (data.stop_reason === "pause_turn" || data.stop_reason === "tool_use");
    i++
  ) {
    messages.push({ role: "assistant", content: data.content })
    if (data.stop_reason === "tool_use") {
      const results = await Promise.all(
        data.content
          .filter((part) => part.type === "tool_use")
          .map(async (part) => {
            const hits = await searchMeetings(
              String(part.input?.query ?? "").slice(0, 100),
              members
            ).catch((error) => {
              console.log(new Date().toISOString(), "search failed", error)
              return null
            })
            for (const hit of hits ?? []) recordings.push(hit.url)
            return {
              type: "tool_result",
              tool_use_id: part.id,
              content:
                hits === null
                  ? "搜尋失敗"
                  : JSON.stringify(
                      hits.map(({ title, startedAt, second, text }) => ({
                        title,
                        startedAt,
                        second,
                        text,
                      }))
                    ),
            }
          })
      )
      messages.push({ role: "user", content: results })
    }
    data = await call(messages, { type: "auto" })
    reportUsage(room, "answer", model, data.usage)
  }
  console.log(new Date().toISOString(), "answer usage", data.usage)
  const text = textOf(data).trim()
  if (!text) return "這題我答不出來，換個問法試試。"
  const sources = [
    ...new Set(
      data.content.flatMap((part) =>
        (part.citations ?? []).map((cite) => cite.url ?? "").filter(Boolean)
      )
    ),
  ].slice(0, 3)
  const watched = [...new Set(recordings)].slice(0, 3)
  const parts = [text]
  if (sources.length > 0) parts.push(`來源：\n${sources.join("\n")}`)
  if (watched.length > 0) parts.push(`相關錄影：\n${watched.join("\n")}`)
  return parts.join("\n\n")
}
