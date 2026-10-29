"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth/client"

// Ends the meet session and then Keycloak's, so the next visit asks for
// the lab account again instead of signing straight back in.
export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        // Better Auth sends the browser on to Keycloak's logout, which comes
        // back to "/" (registered as a post-logout redirect for meet).
        const { data } = await authClient.signOut({ callbackURL: "/" })
        // No Keycloak logout URL came back: the session is gone, go home.
        if (!data?.redirect) router.push("/")
      }}
    >
      {pending ? "登出中…" : "登出"}
    </Button>
  )
}
