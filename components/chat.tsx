"use client"

import {
  useChat,
  useLocalParticipant,
  useParticipants,
  type ReceivedChatMessage,
} from "@livekit/components-react"
import { BotIcon, SendIcon } from "lucide-react"
import * as React from "react"
import remarkBreaks from "remark-breaks"

import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fromSummary } from "@/lib/participants"
import { cn } from "@/lib/utils"

// The meeting chat, laid out like Discord: a picture and a name on the
// first of a run of messages from one person, the rest under it. @name
// mentions anyone in the room or the agent, and links open in a new tab.

/** Who a message can mention: everyone in the room, and the agent. */
type Person = { identity: string; name: string; agent?: boolean }

const AGENT: Person = { identity: "agent", name: "agent", agent: true }

/** Messages from one person within 5 minutes share one header. */
const RUN_MS = 5 * 60 * 1000

export function Chat({
  visible,
  onUnread,
  sound,
}: {
  /** False while another tab covers the chat or the page is in the background. */
  visible: boolean
  /** Messages from others that arrived while the chat was not visible. */
  onUnread: (count: number) => void
  /** Ring when someone mentions me while the chat is not visible. */
  sound: boolean
}) {
  const { chatMessages, send, isSending } = useChat()
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants()
  const bottom = React.useRef<HTMLLIElement>(null)

  const people = React.useMemo<Person[]>(
    () => [
      ...participants.map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
      })),
      AGENT,
    ],
    [participants]
  )
  const myName = localParticipant.name || localParticipant.identity
  const mentionPlugins = React.useMemo(
    () => [remarkBreaks, remarkMentions(people, myName)],
    [people, myName]
  )

  React.useEffect(() => {
    if (visible) bottom.current?.scrollIntoView({ block: "end" })
  }, [chatMessages.length, visible])

  // Everything up to `seen` was on screen once; count the rest from others.
  const seen = React.useRef(0)
  React.useEffect(() => {
    if (visible) seen.current = chatMessages.length
    onUnread(
      chatMessages
        .slice(seen.current)
        .filter((m) => !senderOf(m, localParticipant.identity).mine).length
    )
  }, [visible, chatMessages, localParticipant.identity, onUnread])

  // A mention of me, or the agent answering my question, reaches me even
  // with the meeting in a background tab: a browser notification, and a
  // chime when the chat is not on screen. History from before I joined
  // stays quiet.
  const handled = React.useRef<number | null>(null)
  const askedAgent = React.useRef(false)
  React.useEffect(() => {
    if (handled.current === null) {
      handled.current = chatMessages.length
      return
    }
    const fresh = chatMessages.slice(handled.current)
    handled.current = chatMessages.length
    for (const message of fresh) {
      const sender = senderOf(message, localParticipant.identity)
      if (sender.mine) {
        if (mentions(message.message, AGENT.name)) askedAgent.current = true
        continue
      }
      const answer = sender.agent && askedAgent.current
      if (answer) askedAgent.current = false
      if (!answer && !mentions(message.message, myName)) continue
      if (!visible && sound) chime()
      if (document.visibilityState === "hidden")
        notify(sender.agent ? "agent 回覆你" : `${sender.name} 提到你`, message)
    }
  }, [chatMessages, localParticipant.identity, myName, visible, sound])

  return (
    <section className="flex min-h-0 flex-1 basis-0 flex-col">
      <ol className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
        {chatMessages.length === 0 && (
          <li className="px-4 py-2 text-muted-foreground">還沒有人說話</li>
        )}
        {chatMessages.map((message, i) => {
          const sender = senderOf(message, localParticipant.identity)
          const previous = chatMessages[i - 1]
          const continued =
            previous !== undefined &&
            senderOf(previous, localParticipant.identity).key === sender.key &&
            message.timestamp - previous.timestamp < RUN_MS
          const mentioned = !sender.mine && mentions(message.message, myName)
          return (
            <li
              key={message.id ?? message.timestamp}
              className={cn(
                "flex gap-3 border-l-2 border-transparent px-4 transition-colors duration-state hover:bg-background/60",
                continued ? "py-0.5" : "mt-3 py-0.5",
                mentioned && "border-primary bg-primary/10 hover:bg-primary/15"
              )}
            >
              {continued ? (
                <span aria-hidden className="w-10 shrink-0" />
              ) : (
                <Avatar sender={sender} />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                {!continued && (
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{sender.name}</span>
                    <time
                      dateTime={new Date(message.timestamp).toISOString()}
                      className="shrink-0 text-muted-foreground tabular-nums"
                    >
                      {clock(message.timestamp)}
                    </time>
                  </div>
                )}
                <Markdown remarkPlugins={mentionPlugins} className="gap-2">
                  {message.message}
                </Markdown>
              </div>
            </li>
          )
        })}
        <li ref={bottom} aria-hidden />
      </ol>
      <Composer
        people={people.filter((p) => p.identity !== localParticipant.identity)}
        disabled={isSending}
        onSend={(text) => {
          // Taking part in the chat is when to ask, not on join.
          askNotificationPermission()
          return send(text)
        }}
      />
    </section>
  )
}

/** Opens the panel on the chat tab; the meeting listens for it. */
export const OPEN_CHAT_EVENT = "meet:open-chat"

function askNotificationPermission() {
  if (typeof Notification === "undefined") return
  if (Notification.permission === "default")
    void Notification.requestPermission()
}

function notify(title: string, message: ReceivedChatMessage) {
  if (typeof Notification === "undefined") return
  if (Notification.permission !== "granted") return
  const shown = new Notification(title, {
    body: message.message.slice(0, 140),
    tag: `meet-${message.id ?? message.timestamp}`,
    icon: "/icon.png",
  })
  shown.onclick = () => {
    window.focus()
    window.dispatchEvent(new Event(OPEN_CHAT_EVENT))
    shown.close()
  }
}

// Two short notes, made on the spot so there is no sound file to load.
let audio: AudioContext | null = null
function chime() {
  try {
    audio ??= new AudioContext()
    const now = audio.currentTime
    for (const [i, frequency] of [880, 1320].entries()) {
      const tone = audio.createOscillator()
      const gain = audio.createGain()
      tone.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, now + i * 0.12)
      gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.25)
      tone.connect(gain).connect(audio.destination)
      tone.start(now + i * 0.12)
      tone.stop(now + i * 0.12 + 0.3)
    }
  } catch {}
}

type Sender = {
  key: string
  identity: string | null
  name: string
  mine: boolean
  agent: boolean
}

function senderOf(message: ReceivedChatMessage, me: string): Sender {
  // The agent is hidden, so its replies carry a mark instead of a sender.
  // Only the summary service may carry the mark; anyone else could pass a
  // made-up answer off as the agent's. The service joins hidden, so the
  // client has no participant for it and `from` is empty; every visible
  // sender, guests included, has one.
  if (
    message.attributes?.["meet.agent"] === "1" &&
    fromSummary(message.from?.identity)
  )
    return {
      key: "agent",
      identity: null,
      name: "agent",
      mine: false,
      agent: true,
    }
  const identity = message.from?.identity ?? null
  return {
    key: identity ?? "unknown",
    identity,
    name: message.from?.name || identity || "某人",
    mine: identity === me,
    agent: false,
  }
}

// A member's portal picture, or their initial when they have none.
function Avatar({
  sender,
  small = false,
}: {
  sender: Sender
  small?: boolean
}) {
  const [failed, setFailed] = React.useState(false)
  const base = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
    small ? "size-6" : "mt-1 size-10"
  )
  if (sender.agent)
    return (
      <span
        aria-hidden
        className={cn(base, "bg-primary text-primary-foreground")}
      >
        <BotIcon className={small ? "size-4" : "size-5"} />
      </span>
    )
  if (!sender.identity || failed)
    return (
      <span
        aria-hidden
        className={cn(base, "bg-primary font-medium text-primary-foreground")}
      >
        {sender.name.slice(0, 1)}
      </span>
    )
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small private avatar from our own route; next/image would only proxy it again.
    <img
      src={`/avatars/${encodeURIComponent(sender.identity)}`}
      alt=""
      onError={() => setFailed(true)}
      className={cn(base, "bg-muted object-cover")}
    />
  )
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString("zh-TW", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Whether the text mentions this name with @. */
function mentions(text: string, name: string) {
  return new RegExp(`@${escape(name)}(?![\\p{L}\\p{N}_])`, "u").test(text)
}

type MdNode = {
  type: string
  value?: string
  children?: MdNode[]
  data?: object
}

// @mentions inside the Markdown: a name in the room, longest name first, so
// "@王小明" is not read as "@王小"; mine stands out more. Code and links
// keep their text.
function remarkMentions(people: Person[], me: string) {
  const names = [...new Set(people.map((p) => p.name))].sort(
    (a, b) => b.length - a.length
  )
  const pattern =
    names.length > 0
      ? new RegExp(`@(${names.map(escape).join("|")})(?![\\p{L}\\p{N}_])`, "gu")
      : null
  const split = (value: string): MdNode[] => {
    if (!pattern) return [{ type: "text", value }]
    const out: MdNode[] = []
    let last = 0
    for (const match of value.matchAll(pattern)) {
      if (match.index > last)
        out.push({ type: "text", value: value.slice(last, match.index) })
      out.push({
        type: "mention",
        children: [{ type: "text", value: match[0] }],
        data: {
          hName: "span",
          hProperties: {
            className: cn(
              "rounded-control px-1 font-medium text-primary",
              match[1] === me ? "bg-primary/25" : "bg-primary/15"
            ),
          },
        },
      })
      last = match.index + match[0].length
    }
    if (last < value.length)
      out.push({ type: "text", value: value.slice(last) })
    return out
  }
  const walk = (node: MdNode) => {
    if (!node.children || node.type === "link") return
    node.children = node.children.flatMap((child) => {
      if (child.type === "text" && child.value) return split(child.value)
      walk(child)
      return [child]
    })
  }
  return () => (tree: MdNode) => walk(tree)
}

// The message box. Typing @ lists the people to mention; arrows move, Enter
// or Tab picks, Escape closes.
function Composer({
  people,
  disabled,
  onSend,
}: {
  people: Person[]
  disabled: boolean
  onSend: (text: string) => Promise<unknown>
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const caret = React.useRef<number | null>(null)
  const [draft, setDraft] = React.useState("")
  const [query, setQuery] = React.useState<{
    start: number
    text: string
  } | null>(null)
  const [active, setActive] = React.useState(0)

  const matches = query
    ? people
        .filter((p) => p.name.toLowerCase().includes(query.text.toLowerCase()))
        .slice(0, 6)
    : []
  const open = query !== null && matches.length > 0

  function track(value: string, caret: number) {
    const before = value.slice(0, caret)
    const at = before.lastIndexOf("@")
    const typed = at >= 0 ? before.slice(at + 1) : ""
    const startsWord = at === 0 || (at > 0 && /\s/.test(before[at - 1]))
    setQuery(
      at >= 0 && startsWord && !/\s/.test(typed)
        ? { start: at, text: typed }
        : null
    )
    setActive(0)
  }

  function pick(person: Person) {
    if (!query) return
    const end = query.start + 1 + query.text.length
    const next = `${draft.slice(0, query.start)}@${person.name} ${draft.slice(end)}`
    const position = query.start + person.name.length + 2
    caret.current = position
    setDraft(next)
    setQuery(null)
  }

  // The caret goes after the picked name as soon as the new text renders,
  // before the next key arrives; a later frame would pull back what was
  // typed in between.
  React.useLayoutEffect(() => {
    if (caret.current === null) return
    input.current?.focus()
    input.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [draft])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft("")
    setQuery(null)
    await onSend(text)
  }

  return (
    <form onSubmit={submit} className="relative flex gap-2 p-4 pt-2">
      {open && (
        <ul
          role="listbox"
          aria-label="提及"
          className="absolute right-4 bottom-full left-4 z-10 flex flex-col overflow-hidden rounded-menu border bg-background p-1 shadow-lg"
        >
          {matches.map((person, i) => (
            <li
              key={person.identity}
              role="option"
              aria-selected={i === active}
              onMouseDown={(event) => {
                event.preventDefault()
                pick(person)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1",
                i === active && "bg-muted"
              )}
            >
              <Avatar
                sender={{
                  key: person.identity,
                  identity: person.agent ? null : person.identity,
                  name: person.name,
                  mine: false,
                  agent: person.agent ?? false,
                }}
                small
              />
              <span className="truncate">{person.name}</span>
              {person.agent && (
                <span className="text-muted-foreground">問會議或上網查</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Input
        ref={input}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          track(event.target.value, event.target.selectionStart ?? 0)
        }}
        onKeyDown={(event) => {
          if (!open) return
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            const step = event.key === "ArrowDown" ? 1 : -1
            setActive((i) => (i + step + matches.length) % matches.length)
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault()
            pick(matches[active])
          } else if (event.key === "Escape") {
            event.preventDefault()
            setQuery(null)
          }
        }}
        placeholder="說點什麼，@ 提及別人或 agent"
        aria-label="訊息"
        aria-expanded={open}
        aria-autocomplete="list"
        maxLength={2000}
      />
      <Button
        type="submit"
        size="icon"
        variant="outline"
        aria-label="送出"
        disabled={disabled || !draft.trim()}
      >
        <SendIcon />
      </Button>
    </form>
  )
}
