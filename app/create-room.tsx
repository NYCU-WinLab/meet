"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { createRoom } from "./actions"

// Opens a room and goes straight into it.
export function CreateRoom() {
  const router = useRouter()
  return (
    <FormDialog
      trigger={<Button>開會議室</Button>}
      title="開會議室"
      submitLabel="開始"
      onSubmit={async (data) => {
        const result = await createRoom(String(data.get("title") ?? ""))
        if (!result.ok) {
          toast.error(result.error)
          throw new Error(result.error)
        }
        router.push(`/r/${result.name}`)
      }}
    >
      <FormField label="會議名稱" required>
        <Input name="title" maxLength={40} autoFocus />
      </FormField>
    </FormDialog>
  )
}
