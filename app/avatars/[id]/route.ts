import { runAction } from "@/lib/actions/define"
import { memberAvatar } from "@/lib/actions/users"
import { getSession } from "@/lib/auth/session"

// A member's avatar for the chat, by their meet id (their LiveKit identity),
// from portal. Members only. The browser keeps it for 10 minutes; a member
// with none gets a 404 and the page shows their initial.
export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: RouteContext<"/avatars/[id]">
) {
  const session = await getSession()
  if (!session) return new Response(null, { status: 401 })
  const { id } = await params
  const avatar = await runAction(
    memberAvatar,
    { userId: session.user.id, via: "web" },
    { user_id: id }
  ).catch(() => null)
  const cache = { "Cache-Control": "private, max-age=600" }
  if (!avatar) return new Response(null, { status: 404, headers: cache })
  return new Response(Buffer.from(avatar.base64, "base64"), {
    headers: {
      ...cache,
      "Content-Type": avatar.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
