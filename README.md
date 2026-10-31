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
- **Books a room ahead** for a portal room booking: the link exists at once, opens 10 minutes before the meeting and dies an hour after it ends.
- **Carries an agenda**: a booked room gets its items from portal (the booking's lines and the epic's open issues), asked again when the room opens; a room opened on the spot takes one line per item. The summary panel shows them as a checklist the running summary ticks off, and warns once when 10 minutes are left with items open.
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
| `create_room` | Opens a room now and returns its link |
| `schedule_room`, `update_scheduled_room`, `cancel_scheduled_room` | A room booked ahead, by portal booking id |
| `end_room` | Closes a room for everyone |

## Agenda

`schedule_room` and `update_scheduled_room` take `agenda`, up to 30 items of `{text ≤ 200, source: "booking" | "issue", url?}`; a given list replaces the old one. Each item gets an id, the first 8 hex of `sha256(source + "\n" + (url ?? text))`, so pushing the same items again keeps their status. When the room opens, meet asks portal's `get_booking_agenda` (5 s); a cancelled booking is cancelled here too, and no answer keeps the stored list. The items ride in the room metadata; the summary service marks each `pending`, `partial` or `done` with a note of at most 40 characters, and never adds, drops or renames one. Nothing about coverage is stored: the final record's ✅/⬜ is written by winlab-helper from the full transcript.

## Recording

Every room records itself: LiveKit Egress composes the grid into an MP4 from the moment the first member is in the room until it closes. The file lands on the egress machine, whose uploader moves it to Nextcloud and hands it to the lab's GitLab helper (winlab-helper). The helper never parses titles; the fields it needs ride in the file name, separated by `~`, a character no id contains:

```
meet~<room>~<time>~<group>~<opener>~<booking>~<until>~<title>.mp4
```

| Field | What it is |
|---|---|
| `room` | The room name, the id in its link |
| `time` | When the recording started, UTC, `2006-01-02T150405` |
| `group` | The portal project group's slug, spelled as portal does; empty for a personal meeting |
| `opener` | The username of the member who opened the room; empty when the account has none |
| `booking` | The portal `room-booking-…` id the room was opened for, or empty |
| `until` | When the booking ends, UTC, `2006-01-02T150405`; empty for a room opened on the spot |
| `title` | The room title, with `/ \ : * ? " < > \| ~` and control characters removed |

An id outside `[A-Za-z0-9._-]{1,64}` is written as empty, never refused. A booked room that empties closes after 10 minutes and opens again when members come back, so one booking can leave several files; the uploader holds them until an hour after `until` and joins them into one recording. The uploader maps these to the helper's trigger variables (`MEET_ROOM`, `START_TIME`, `GROUP_NAME`, `PERSON`, `BOOKING_REQUEST_ID`, `SUBJECT`); that contract is documented in winlab-helper.

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
