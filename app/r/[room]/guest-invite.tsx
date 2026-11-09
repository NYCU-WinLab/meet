"use client"

import { useParams } from "next/navigation"
import { toast } from "sonner"

import { createGuestLinkAction } from "@/app/actions"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const HOURS = [
  { value: "1", label: "1 小時" },
  { value: "24", label: "1 天" },
  { value: "168", label: "7 天" },
]

const until = new Intl.DateTimeFormat("zh-TW", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
})

// An admin makes a link for someone without a lab account. The link is the
// password, so it is shown once and copied; it cannot be shown again.
export function GuestInvite({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { room } = useParams<{ room: string }>()
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="邀請訪客"
      submitLabel="產生連結"
      onSubmit={async (data) => {
        const result = await createGuestLinkAction(
          room,
          Number(data.get("hours") ?? 24),
          String(data.get("label") ?? "").trim() || undefined
        )
        if (!result.ok) {
          toast.error(result.error)
          throw new Error(result.error)
        }
        const copy = () =>
          navigator.clipboard
            .writeText(result.url)
            .then(() => toast.success("已複製訪客連結"))
            .catch(() => toast.error("複製失敗，請手動選取連結"))
        // Safari may refuse a copy this long after the click; the toast's
        // button is a fresh click.
        const copied = await navigator.clipboard
          .writeText(result.url)
          .then(() => true)
          .catch(() => false)
        toast.success(copied ? "已複製訪客連結" : "訪客連結已產生", {
          description: `${result.url}\n${until.format(new Date(result.expiresAt))} 前有效`,
          duration: 60_000,
          action: { label: "複製", onClick: () => void copy() },
        })
      }}
    >
      <FormField label="有效時間">
        <HoursSelect />
      </FormField>
      <FormField label="給誰">
        <Input name="label" maxLength={80} placeholder="選填" />
      </FormField>
    </FormDialog>
  )
}

function HoursSelect({ id }: { id?: string }) {
  return (
    <Select name="hours" defaultValue="24" items={HOURS}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HOURS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
