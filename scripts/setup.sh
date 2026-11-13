#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is not running or is not reachable." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is required." >&2
  exit 1
fi

./scripts/bootstrap.sh

read_env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  value="$(printf '%s' "$value" | awk '{$1=$1};1')"
  printf '%s' "$value"
}

HOST_DATA_DIR="$(read_env_value HOST_DATA_DIR)"
MCP_PATH_SECRET="$(read_env_value MCP_PATH_SECRET)"
SANDBOX_IMAGE="$(read_env_value SANDBOX_IMAGE)"
PORT="$(read_env_value PORT)"
SANDBOX_IMAGE="${SANDBOX_IMAGE:-cloud-sandbox-workstation:latest}"
PORT="${PORT:-3000}"

if grep -Eq 'internal\.api\.openai\.org|applied-caas-gateway|yocto-queue-0\.1\.1\.tgz' package-lock.json; then
  echo "package-lock.json contains a private or invalid dependency URL." >&2
  exit 1
fi

# Parse the final Compose model before spending time building images.
docker compose --env-file .env config >/dev/null

printf '\nBuilding sandbox image...\n'
docker build -t "$SANDBOX_IMAGE" -f docker/sandbox.Dockerfile .

printf '\nBuilding MCP image...\n'
docker compose --env-file .env --progress=plain build mcp

printf '\nStarting MCP service...\n'
docker compose --env-file .env down --remove-orphans >/dev/null 2>&1 || true
docker compose --env-file .env up -d --force-recreate

container_id="$(docker compose --env-file .env ps -q mcp)"
if [[ -z "$container_id" ]]; then
  echo "Compose did not create the MCP container." >&2
  exit 1
fi

# Verify the actual container received the same secret that is stored in .env.
actual_secret="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" | sed -n 's/^MCP_PATH_SECRET=//p' | tail -n 1)"
if [[ "$actual_secret" != "$MCP_PATH_SECRET" ]]; then
  echo "The MCP container did not receive MCP_PATH_SECRET from .env." >&2
  echo "Expected fingerprint: ${MCP_PATH_SECRET:0:8}...${MCP_PATH_SECRET: -8}" >&2
  if [[ -n "$actual_secret" ]]; then
    echo "Actual fingerprint:   ${actual_secret:0:8}...${actual_secret: -8}" >&2
  else
    echo "Actual value is missing." >&2
  fi
  docker compose --env-file .env logs --tail=100 mcp >&2 || true
  exit 1
fi

printf 'Waiting for the MCP health endpoint on port %s...\n' "$PORT"
for _ in {1..45}; do
  if curl -fsS "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
    printf '\nCloud Sandbox MCP is running.\n'
    curl -fsS "http://localhost:${PORT}/healthz"
    printf '\n\nLocal MCP endpoint:\nhttp://localhost:%s/mcp/%s\n' "$PORT" "$MCP_PATH_SECRET"
    if [[ "$(uname -s)" == "Darwin" ]] && grep -q '^COMPUTER_USE_ENABLED=true$' .env; then
      node scripts/install-computer-use-host.mjs || {
        echo 'Mac Computer Use LaunchAgent failed; controller remains running.' >&2
        exit 1
      }
    fi
    exit 0
  fi
  if ! docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null | grep -q true; then
    break
  fi
  sleep 2
done

echo "MCP did not become healthy." >&2
docker compose --env-file .env ps >&2 || true
docker compose --env-file .env logs --tail=200 mcp >&2 || true
exit 1
