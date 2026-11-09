"use client"

import * as React from "react"

import { joinAsGuestAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { JoinState } from "@/lib/actions/rooms"

import { Room } from "@/app/r/[room]/lobby"

const NAME_KEY = "meet.guest-name"

// A guest types the name others will see, then goes through the same lobby
// as members. Leaving brings them back here.
export function GuestJoin({
  secret,
  title,
}: {
  secret: string
  title: string
}) {
  const [state, setState] = React.useState<JoinState | null>(null)
  const [error, setError] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const [left, setLeft] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)

  // The name from last time, filled in after hydration.
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY)
      if (saved && input.current && !input.current.value)
        input.current.value = saved
    } catch {}
  }, [left])

  if (state?.state === "ready" && !left)
    return (
      <Room
        title={state.title}
        serverUrl={state.serverUrl}
        token={state.token}
        endsAt={state.endsAt}
        host={false}
        guest
        onLeave={() => {
          setLeft(true)
          setState(null)
        }}
      />
    )

  const notice =
    state?.state === "early"
      ? "會議還沒開始，請晚點再來"
      : state?.state === "ended"
        ? "會議已結束"
        : state?.state === "full"
          ? "會議室暫時滿了，請稍後再試"
          : left
            ? "你已離開會議"
            : ""

  return (
    <div className="fixed top-16 right-4 bottom-4 left-4 flex overflow-y-auto md:top-20">
      <form
        className="m-auto flex w-full max-w-md flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          setError("")
          const name = String(
            new FormData(event.currentTarget).get("name") ?? ""
          )
          startTransition(async () => {
            const result = await joinAsGuestAction(secret, name)
            if (!result.ok) {
              setError(result.error)
              return
            }
            try {
              localStorage.setItem(NAME_KEY, name.trim())
            } catch {}
            setLeft(false)
            setState(result.joined)
          })
        }}
      >
        <h1 className="text-title font-medium">{title}</h1>
        {notice && <p>{notice}</p>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="guest-name">你的名字</Label>
          <Input
            id="guest-name"
            ref={input}
            name="name"
            maxLength={40}
            required
            autoFocus
          />
        </div>
        {error && <p className="text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "進入中…" : left ? "重新加入" : "下一步"}
        </Button>
      </form>
    </div>
  )
}
