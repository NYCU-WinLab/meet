"use client"

import * as React from "react"
import { toast } from "sonner"

import { revokeGuestLinkAction } from "@/app/actions"
import { Button } from "@/components/ui/button"

// Stops a link at once; the page refreshes itself after the change.
export function RevokeButton({ id }: { id: string }) {
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revokeGuestLinkAction(id)
          if (result.ok) toast.success("已撤銷訪客連結")
          else toast.error(result.error)
        })
      }
    >
      {pending ? "撤銷中…" : "撤銷"}
    </Button>
  )
}
