#!/usr/bin/env bash
# The image as deployed: compose up with Postgres, migrations, then probe
# sign-in, the webhook, OAuth discovery and the MCP challenge.
# ci runs it with the image loaded as ghcr.io/nycu-winlab/meet:ci.
set -euo pipefail
trap 'docker compose logs' EXIT

cat > .env <<ENV
MEET_VERSION=ci
MEET_PORT=3000
POSTGRES_PASSWORD=ci-$(openssl rand -hex 8)
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
KEYCLOAK_ISSUER=https://auth.winlab.tw/realms/winlab
KEYCLOAK_CLIENT_ID=ci
KEYCLOAK_CLIENT_SECRET=ci
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=ci
LIVEKIT_API_SECRET=ci-secret-ci-secret-ci-secret-ci
ENV
docker compose up -d --wait web

docker compose logs migrate | grep -q "migrations applied"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/api/livekit/webhook -d '{}')" = 401
test "$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/sign-in)" = 303
test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/)" = 307
curl -sf localhost:3000/.well-known/oauth-protected-resource/mcp | grep -q '"resource":"http://localhost:3000/mcp"'
curl -sf localhost:3000/.well-known/oauth-authorization-server/api/auth | grep -q '"client_id_metadata_document_supported":true'
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/mcp -H 'content-type: application/json' -d '{}')" = 401
curl -s -D - -o /dev/null -X POST localhost:3000/mcp -H 'content-type: application/json' -d '{}' | grep -qi 'www-authenticate: Bearer resource_metadata='
echo "smoke passed"
