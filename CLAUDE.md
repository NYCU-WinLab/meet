@AGENTS.md

# WinLab Meet

The lab's video meeting rooms at meet.winlab.tw: a Next.js app with its own Postgres for sign-in, on the self-hosted LiveKit server at livekit.winlab.tw. Built on the same skeleton as NYCU-WinLab/gallery and portal; keep them alike.

## Rules

- **Every read and write is an action** in `lib/actions/<app>.ts`, made with `defineAction` and listed in `lib/actions/registry.ts`. Pages call `runAction(action, actor, input)`; `lib/mcp/server.ts` builds the MCP tools from the same registry. Never write a separate MCP tool or a page-only query.
- **Only `lib/actions`, `lib/auth` and `lib/db` import `@/lib/db`.** `bun run actions:check` fails otherwise, and when an action is missing from the registry.
- **An action stays off MCP only with a reason** in `mcpExcludedBecause`, e.g. `join_room`, which mints a browser credential.
- **Action fields**: `name` snake_case (the tool name), `title` in Chinese (what members call it), `description` in English for agents, `kind` query or mutation.
- **Permissions live in the action's `run`**, checked against `actor.userId`; a page and an MCP call get the same answer.
- **Rooms live in LiveKit, not Postgres.** `lib/livekit.ts` is the one module that talks to the server: the room list, the join token, ending a room, and the webhook signature. A room's title and who opened it are its LiveKit metadata. The database holds sign-in only.
- **Schema**: edit `lib/db/*.ts`, run `bun run db:generate`, commit the SQL in `drizzle/`. Tables are snake_case plurals; the Better Auth tables keep its model names as export keys (`user`, `oauthClient`) so its adapter finds them.
- **External services get one module each** in `lib/<service>.ts` (`lib/keycloak.ts`, `lib/livekit.ts`). It reads its credentials from the environment, never touches the database, and only actions (and the webhook route) call it.
- **Members only.** Every page calls `requireActor`; nothing is public. A room link works for any member and for nobody else.
- **Every page updates live.** `runAction` announces each successful mutation (`lib/actions/changes.ts`, Postgres NOTIFY), the LiveKit webhook (`app/api/livekit/webhook`) announces rooms opening and closing and members joining and leaving, and every open page refreshes through `/api/events`. Inside a meeting the LiveKit room is live by itself.
- **Shell links prefetch.** Pages are per member and dynamic, so Next 16 prefetches them only when asked: links in `app-shell` carry `prefetch`, except ones that point at a route handler (`/sign-in`). Check prefetching with `next start`; dev never prefetches.
- **Measure before tuning.** When a page feels slow, look first at its server span in Sensorium (service `meet`), then the network (`curl -w`), then the client (prefetch, animations), and change the slow part only. Media goes browser to LiveKit directly; the app never carries it.
- **MCP lives at `/mcp`**; discovery is under `/.well-known/` at the site root.
- **Design** comes from ui.winlab.tw (`bunx shadcn@latest add @winlab/<item>`); its DESIGN.md is the rulebook and `bun run tokens:check` enforces the token part. The meeting UI is built from `@livekit/components-react` hooks and our own elements; the LiveKit prebuilt components and their stylesheet stay out.
- **Observability**: actions run in a span (`action <name>`, with `via` web or mcp); send ids and counts, never member content.

## Verify

`bun run typecheck && bun run lint && bun run format:check && bun run tokens:check && bun run actions:check && bun run build`. Build and run on the sandbox, not the MacBook. A real meeting needs two browsers on https://meet.winlab.tw: open a room in one, join from the other, and check video both ways and a screen share.
