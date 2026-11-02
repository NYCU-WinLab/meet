import { runAction } from "@/lib/actions/define"
import { recordingFile } from "@/lib/actions/recordings"
import { getSession } from "@/lib/auth/session"

// One file of a member's recording, streamed from Nextcloud: the MP4 (with
// Range, so the player can seek), transcript, subtitles or notes. The
// recording_file action decides whether this member may have it.
export const runtime = "nodejs"

const passed = [
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
]

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/recordings/[id]/[file]">
) {
  const session = await getSession()
  if (!session) return new Response(null, { status: 401 })
  const { id, file } = await params
  let upstream: Response
  try {
    upstream = await runAction(
      recordingFile,
      { userId: session.user.id, via: "web" },
      { id, file, range: request.headers.get("range") }
    )
  } catch {
    return new Response("找不到這個檔案", { status: 404 })
  }
  const headers = new Headers()
  for (const name of passed) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // The type comes from the extension, never from Nextcloud: nothing here
  // may render as a page on meet's origin.
  const type = typeOf(file)
  headers.set("content-type", type)
  const download =
    new URL(request.url).searchParams.has("download") ||
    type === "application/octet-stream"
  headers.set(
    "content-disposition",
    `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file)}`
  )
  headers.set("cache-control", "private, no-store")
  headers.set("x-content-type-options", "nosniff")
  headers.set("content-security-policy", "sandbox; default-src 'none'")
  return new Response(upstream.body, { status: upstream.status, headers })
}

function typeOf(file: string) {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase()
  if (ext === "mp4") return "video/mp4"
  if (ext === "txt" || ext === "srt" || ext === "md")
    return "text/plain; charset=utf-8"
  if (ext === "json") return "application/json"
  return "application/octet-stream"
}
