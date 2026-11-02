// Reads the recordings the egress uploader filed in Nextcloud, over WebDAV
// with the same account it uploads with (NC_USER, an app password in
// NC_PASS). Only under NC_DIR, and only reads: listing a recording's folder,
// a sidecar's text, and one file streamed to a member who may see it.

const root = () =>
  `${process.env.NC_URL}/remote.php/dav/files/${encodeURIComponent(process.env.NC_USER ?? "")}/${encodeURIComponent(process.env.NC_DIR ?? "meet")}`

const auth = () =>
  "Basic " +
  Buffer.from(`${process.env.NC_USER}:${process.env.NC_PASS}`).toString(
    "base64"
  )

export const nextcloudConfigured = () =>
  Boolean(process.env.NC_URL && process.env.NC_USER && process.env.NC_PASS)

/** A path under NC_DIR as WebDAV wants it: each segment encoded, and no
 * segment that could climb out (.., ., empty). */
function davPath(path: string) {
  const parts = path.split("/")
  if (parts.some((p) => p === "" || p === "." || p === ".."))
    throw new Error("錄影路徑不對")
  return `${root()}/${parts.map(encodeURIComponent).join("/")}`
}

export type FolderFile = { name: string; bytes: number }

/** The files directly in a recording's folder, or [] when it is gone. */
export async function folderFiles(folder: string): Promise<FolderFile[]> {
  const response = await fetch(`${davPath(folder)}/`, {
    method: "PROPFIND",
    headers: {
      authorization: auth(),
      depth: "1",
      "content-type": "application/xml",
    },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>',
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Nextcloud ${response.status}`)
  const xml = await response.text()
  const files: FolderFile[] = []
  for (const block of xml.split(/<d:response>/).slice(1)) {
    if (block.includes("<d:collection")) continue
    const href = block.match(/<d:href>([^<]+)<\/d:href>/)?.[1]
    if (!href) continue
    const name = decodeURIComponent(href.split("/").filter(Boolean).pop()!)
    const bytes = Number(block.match(/<d:getcontentlength>(\d+)</)?.[1] ?? "0")
    files.push({ name, bytes })
  }
  return files
}

/** A small text file (notes, transcript), or null when it is not there.
 * Longer than max characters is cut there. */
export async function readText(path: string, max = 200_000) {
  const response = await fetch(davPath(path), {
    headers: { authorization: auth() },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Nextcloud ${response.status}`)
  return (await response.text()).slice(0, max)
}

/** One file as Nextcloud answers it, for streaming on to the browser; a
 * Range header is passed through so a video can seek. */
export async function openFile(path: string, range?: string | null) {
  const response = await fetch(davPath(path), {
    headers: { authorization: auth(), ...(range ? { range } : {}) },
    cache: "no-store",
  })
  if (response.status === 404) return null
  if (!response.ok && response.status !== 206)
    throw new Error(`Nextcloud ${response.status}`)
  return response
}
