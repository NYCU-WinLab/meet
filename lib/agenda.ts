// A scheduled meeting's agenda: what the booking says the meeting is for,
// one line per item, plus the epic's open issues portal adds. The summary
// service ticks items off during the meeting; the final record's coverage
// is written later by the GitLab helper from the full transcript.
import { createHash } from "node:crypto"

import { z } from "zod"

export const AGENDA_MAX = 30

export const agendaIn = z.object({
  text: z.string().trim().min(1).max(200),
  source: z.enum(["booking", "issue"]),
  url: z.string().url().max(500).optional(),
})
export type AgendaIn = z.infer<typeof agendaIn>
export type AgendaItem = AgendaIn & { id: string }

export const agendaList = z.array(agendaIn).max(AGENDA_MAX)

const normalized = (text: string) => text.replace(/\s+/g, " ").trim()

/** Stable across re-pushes of the same item, so its status survives. */
export function itemId(item: AgendaIn) {
  const key = `${item.source}\n${item.url ?? normalized(item.text)}`
  return createHash("sha256").update(key).digest("hex").slice(0, 8)
}

/** Items with ids, the first of any repeated id kept. */
export function withIds(items: AgendaIn[]): AgendaItem[] {
  const seen = new Set<string>()
  return items.slice(0, AGENDA_MAX).flatMap((item) => {
    const id = itemId(item)
    if (seen.has(id)) return []
    seen.add(id)
    return [{ ...item, id }]
  })
}

/** "- A\n* B\n1. C" as items, one per non-empty line. */
export function agendaLines(text: string): AgendaIn[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, AGENDA_MAX)
    .map((line) => ({ text: line.slice(0, 200), source: "booking" as const }))
}
