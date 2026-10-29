```
███╗   ███╗███████╗███████╗████████╗
████╗ ████║██╔════╝██╔════╝╚══██╔══╝
██╔████╔██║█████╗  █████╗     ██║
██║╚██╔╝██║██╔══╝  ██╔══╝     ██║
██║ ╚═╝ ██║███████╗███████╗   ██║
╚═╝     ╚═╝╚══════╝╚══════╝   ╚═╝
```

# WinLab Meet

> The lab's video meeting rooms: a member opens a room, shares the link, and everyone meets in the browser on the lab's own LiveKit server.

`nextjs` `livekit` `webrtc` `postgres` `docker` `mcp`

[![CI](https://github.com/NYCU-WinLab/meet/actions/workflows/ci.yml/badge.svg)](https://github.com/NYCU-WinLab/meet/actions) &nbsp;[![Image](https://img.shields.io/badge/image-ghcr.io%2Fnycu--winlab%2Fmeet-111111)](https://github.com/NYCU-WinLab/meet/pkgs/container/meet) &nbsp;[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

No account to make and nothing to install: lab members sign in with their lab account, and media stays on lab machines. Every member sees which rooms are open and who is in them, live.

```
> "Open a room for the Friday sync"
  ⚡ create_room { "title": "Friday sync" }
✓ { "name": "k7m-x2p-q9d", "url": "https://meet.winlab.tw/r/k7m-x2p-q9d" }
```

## What it does

- **Opens a room** with a title; the link is a short id, and any member can join it.
- **Meets in the browser**: camera, microphone and screen share, with the speaker ringed and muted members marked.
- **Shows who is where**: the room list says who is in each room and refreshes as people come and go.
- **Ends a room** for everyone; an empty room closes by itself after 10 minutes.
- **Serves MCP** at `/mcp`, with meet as the OAuth 2.1 authorization server, so an agent can list and open rooms as a member.

## Deploy

The web app runs anywhere with Docker, next to a [LiveKit server](https://docs.livekit.io/transport/self-hosting/):

```sh
curl -fsSLO https://raw.githubusercontent.com/NYCU-WinLab/meet/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/NYCU-WinLab/meet/main/.env.example
# set POSTGRES_PASSWORD, BETTER_AUTH_*, KEYCLOAK_* and LIVEKIT_* in .env
docker compose up -d
```

> [!IMPORTANT]
> Put a reverse proxy with TLS in front of web, at the host in `BETTER_AUTH_URL`. Browsers need HTTPS to open a camera, and the LiveKit server needs its UDP port reachable.

Point the LiveKit server's webhook at `<BETTER_AUTH_URL>/api/livekit/webhook`, signed with the same API key, so open pages refresh when rooms change:

```yaml
webhook:
  api_key: <LIVEKIT_API_KEY>
  urls:
    - https://meet.example.com/api/livekit/webhook
```

### Configuration

| Variable | What it is | Default |
|---|---|---|
| `BETTER_AUTH_URL` | The public URL; also the MCP resource and issuer base | required |
| `BETTER_AUTH_SECRET` | Signs sessions (`openssl rand -base64 32`) | required |
| `KEYCLOAK_ISSUER` | The realm, e.g. `https://auth.example.com/realms/example` | required |
| `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | Meet's Keycloak client, redirect URI `<BETTER_AUTH_URL>/api/auth/callback/keycloak` | required |
| `LIVEKIT_URL` | The LiveKit server browsers connect to (`wss://`) | required |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The key pair that mints join tokens and signs webhooks | required |
| `POSTGRES_PASSWORD` | The compose Postgres | required |
| `MEET_VERSION` | Image tag | `main` |
| `MEET_BIND`, `MEET_PORT` | Where web listens on the host | `127.0.0.1`, `3000` |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | Where traces and logs go; off when empty | |

## MCP

1. Add the server to a client, for example `claude mcp add --transport http meet <BETTER_AUTH_URL>/mcp`.
2. Sign in when the client asks; the client registers itself, no setup on the server.
3. Ask it what rooms are open, or to open one.

| Tool | What it does |
|---|---|
| `whoami` | The signed-in member |
| `list_rooms` | Open rooms, who opened them, who is in them |
| `create_room` | Opens a room and returns its link |
| `end_room` | Closes a room for everyone |

## Develop

```sh
bun install
cp .env.example .env.local   # point it at a Postgres, a Keycloak client and a LiveKit server
bun run db:migrate
bun run dev
```

`bun run typecheck && bun run lint && bun run format:check && bun run tokens:check && bun run actions:check` is what CI runs. See [CLAUDE.md](CLAUDE.md) for the conventions.

## License

[MIT](LICENSE)
