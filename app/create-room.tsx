"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ProjectGroup } from "@/lib/portal"

import { createRoom } from "./actions"

// Opens a room and goes straight into it. The group names where the
// recording is filed in GitLab; without one it goes under the member.
export function CreateRoom({
  groups,
  self,
  full,
}: {
  groups: ProjectGroup[]
  /** The member's username, the file prefix when no group is chosen. */
  self: string
  /** As many rooms are open as can be recorded at once. */
  full: boolean
}) {
  const router = useRouter()
  if (full)
    return (
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          會議室已滿，等其他會議結束
        </span>
        <Button disabled>開會議室</Button>
      </div>
    )
  const items = [
    { value: "", label: `自己（${self}）` },
    ...groups.map((group) => ({ value: group.name, label: group.label })),
  ]
  return (
    <FormDialog
      trigger={<Button>開會議室</Button>}
      title="開會議室"
      submitLabel="開始"
      onSubmit={async (data) => {
        const group = String(data.get("group") ?? "")
        const agenda = String(data.get("agenda") ?? "")
          .split("\n")
          .map((line) =>
            line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, "").trim()
          )
          .filter(Boolean)
        const result = await createRoom(
          String(data.get("title") ?? ""),
          group || undefined,
          agenda.length > 0 ? agenda : undefined
        )
        if (!result.ok) {
          toast.error(result.error)
          throw new Error(result.error)
        }
        router.push(`/r/${result.name}`)
      }}
    >
      <FormField label="會議名稱" required>
        <Input name="title" maxLength={80} autoFocus />
      </FormField>
      <FormField label="錄影歸檔到">
        <GroupSelect items={items} />
      </FormField>
      <FormField label="議程">
        <Textarea name="agenda" rows={4} placeholder="一行一項" />
      </FormField>
    </FormDialog>
  )
}

function GroupSelect({
  id,
  items,
}: {
  id?: string
  items: { value: string; label: string }[]
}) {
  return (
    <Select name="group" defaultValue="" items={items}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
