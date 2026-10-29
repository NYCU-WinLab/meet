import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"

import { runAction } from "@/lib/actions/define"
import { actions } from "@/lib/actions/registry"

export const instructions =
  "WinLab Meet, the video meeting rooms of NYCU Wireless Internet Lab on the self-hosted LiveKit at livekit.winlab.tw. Every tool acts as the signed-in member, with exactly the permissions the web app gives them. Start with whoami."

// A fresh server per request, built from the action registry, so there is
// no hand-kept tool list to drift away from the pages. Serves both the
// 2026-07-28 protocol and 2025-era clients.
export const mcpHandler = createMcpHandler(({ authInfo }) => {
  const userId = authInfo?.extra?.userId
  const server = new McpServer(
    { name: "winlab-meet", version: "0.1.0" },
    { instructions }
  )
  for (const action of actions) {
    if (action.mcpExcludedBecause) continue
    server.registerTool(
      action.name,
      {
        title: action.title,
        description: action.description,
        inputSchema: action.input,
        annotations: { readOnlyHint: action.kind === "query" },
      },
      async (input) => {
        if (typeof userId !== "string") throw new Error("not signed in")
        const result = await runAction(
          action,
          { userId, via: "mcp" },
          input ?? {}
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        }
      }
    )
  }
  return server
})
