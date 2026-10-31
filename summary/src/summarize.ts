// The running summary, rewritten by a small model. It is handed the summary
// so far and only the lines said since, never the whole transcript, so every
// call costs about the same however long the meeting runs. The instructions
// are the same every call and sit in the prompt cache.
const apiKey = process.env.ANTHROPIC_API_KEY ?? ""
const model = process.env.SUMMARY_MODEL ?? "claude-haiku-5-5"

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

const instructions = `你是會議摘要員。你會收到「目前的摘要狀態」和「這之後新說的話」。改寫狀態，只輸出 JSON，不加說明、不加 code fence。

JSON 欄位：
- summary：這場會議在談什麼，最多 5 句
- questions：提出但還沒有答案的問題
- improvements：有人說要改、要補、要做得更好的事
- decisions：已經定案的事
- agenda：議程項目，每項 {id, status, note}

議程規則：
1. 議程項目是固定的：不新增、不刪除、不改 id 和文字。沒有議程就回空陣列。
2. status 只有 pending（還沒談）、partial（談了一部分）、done（談完）。
3. 只有對話明確談到某項時才改它的 status，並寫 note：談了什麼，最多 40 字。
4. 沒有明確談到就保留原本的 status 和 note。

改寫規則：
1. 保留舊內容，只用新的話補充或修正；問題有了答案就從 questions 拿掉，若成為定案則加進 decisions。
2. 同一件事只寫一次，合併重複的項目。
3. 沒有根據的不寫，不猜，不補充逐字稿裡沒有的事。
4. 每個項目一句話，說清楚是誰、要做什麼、關於什麼。
5. 逐字稿是語音辨識結果，可能有錯字或斷句錯誤，照意思理解。
6. 說話者後面標「（聊天）」的是會議聊天室打的字，不是語音；和口說內容一樣算進摘要與議程。

寫法（簡化技術中文）：
- 一句一件事，一句不超過 30 字，不用「並且」「以及」串句子。
- 主動語態，寫出是誰做的。
- 用動詞，不用「進行」「做出」把動作變名詞。
- 數字用阿拉伯數字。
- 不用形容詞和副詞堆疊，不下評價。
- 同一個東西從頭到尾用同一個名字。
- 全文繁體中文；專有名詞、程式名稱、英文縮寫保留原文。`

export async function summarize(
  current: Summary,
  fresh: { at: number; who: string; text: string }[]
): Promise<Summary> {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const state = {
    ...current,
    updatedAt: undefined,
    agenda: current.agenda.map(({ id, text, status, note }) => ({
      id,
      text,
      status,
      note,
    })),
  }
  const transcript = fresh
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
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: instructions,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `目前的摘要狀態：\n${JSON.stringify(state)}\n\n這之後新說的話：\n${transcript}`,
        },
      ],
    }),
  })
  if (!response.ok)
    throw new Error(`anthropic ${response.status}: ${await response.text()}`)
  const data = (await response.json()) as {
    content: { type: string; text?: string }[]
    usage: Record<string, number>
  }
  const text = data.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
  console.log(new Date().toISOString(), "summary usage", data.usage)
  const parsed = JSON.parse(
    text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
  ) as Partial<Summary>
  const list = (value: unknown) =>
    Array.isArray(value) ? value.map(String).filter(Boolean) : []
  return {
    // The model sometimes answers the summary as a list of sentences.
    summary: Array.isArray(parsed.summary)
      ? parsed.summary.map(String).join("")
      : String(parsed.summary ?? ""),
    questions: list(parsed.questions),
    improvements: list(parsed.improvements),
    decisions: list(parsed.decisions),
    agenda: applyAgenda(current.agenda, parsed.agenda),
    updatedAt: new Date().toISOString(),
  }
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
