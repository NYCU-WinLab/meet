import { errorMessage, runAction } from "@/lib/actions/define"
import { actions } from "@/lib/actions/registry"

// Actions for trusted services, portal above all: POST the action's input
// as JSON with "Authorization: Bearer <key>". SERVICE_KEYS in the
// environment is "portal:<key>,other:<key>"; the service's name becomes the
// actor's service and the action names the member itself.
export const runtime = "nodejs"

function serviceOf(authorization: string | null) {
  const key = authorization?.replace(/^Bearer\s+/i, "")
  if (!key) return null
  for (const pair of (process.env.SERVICE_KEYS ?? "").split(",")) {
    const [name, secret] = pair.trim().split(":")
    if (name && secret && secret === key) return name
  }
  return null
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/actions/[name]">
) {
  const service = serviceOf(request.headers.get("authorization"))
  if (!service) return new Response(null, { status: 401 })
  const { name } = await params
  const action = actions.find((a) => a.name === name && !a.mcpExcludedBecause)
  if (!action)
    return Response.json({ error: "no such action" }, { status: 404 })
  try {
    const input = await request.json().catch(() => ({}))
    const result = await runAction(
      action,
      { userId: "", via: "service", service },
      input
    )
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 })
  }
}
