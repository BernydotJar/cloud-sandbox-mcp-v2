#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
failed=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failed=1; }
info() { printf 'INFO  %s\n' "$1"; }

read_env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  value="$(printf '%s' "$value" | awk '{$1=$1};1')"
  printf '%s' "$value"
}

command -v docker >/dev/null 2>&1 && pass "docker command found" || fail "docker command not found"
docker info >/dev/null 2>&1 && pass "Docker daemon reachable" || fail "Docker daemon is not reachable; start Docker Desktop"
docker compose version >/dev/null 2>&1 && pass "Docker Compose available" || fail "Docker Compose unavailable"

[[ -f .env ]] && pass ".env exists" || fail ".env missing; run ./scripts/bootstrap.sh"

secret="$(read_env_value MCP_PATH_SECRET)"
case "$secret" in
  ''|'replace-with-a-long-random-value'|'development-secret-change-me')
    fail "MCP_PATH_SECRET is missing or still a placeholder; run ./scripts/bootstrap.sh"
    ;;
  *)
    if [[ ${#secret} -ge 32 ]]; then
      pass "MCP_PATH_SECRET is strong and saved in .env"
    else
      fail "MCP_PATH_SECRET is shorter than 32 characters"
    fi
    ;;
esac

host_data_dir="$(read_env_value HOST_DATA_DIR)"
if [[ "$host_data_dir" == /* ]]; then
  pass "HOST_DATA_DIR is an absolute path"
else
  fail "HOST_DATA_DIR is missing or not absolute"
fi

if grep -Eq 'internal\.api\.openai\.org|applied-caas-gateway|yocto-queue-0\.1\.1\.tgz' package-lock.json; then
  fail "package-lock.json contains a private or invalid dependency URL"
else
  pass "package-lock.json registry integrity"
fi

docker image inspect cloud-sandbox-workstation:latest >/dev/null 2>&1 && pass "cloud-sandbox-workstation:latest image exists" || info "cloud-sandbox-workstation:latest has not been built yet"

if docker compose --env-file .env config >/dev/null 2>&1; then
  pass "Compose configuration parses with .env"
else
  fail "Compose configuration does not parse; run docker compose --env-file .env config"
fi

container_id="$(docker compose --env-file .env ps -q mcp 2>/dev/null || true)"
if [[ -n "$container_id" ]]; then
  actual_secret="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null | sed -n 's/^MCP_PATH_SECRET=//p' | tail -n 1)"
  if [[ -n "$secret" && "$actual_secret" == "$secret" ]]; then
    pass "running container received MCP_PATH_SECRET from .env"
  else
    fail "running container secret does not match .env; recreate it with ./scripts/setup.sh"
  fi
else
  info "MCP container has not been created yet"
fi

port="$(read_env_value PORT)"; port="${port:-3000}"
if curl -fsS "http://localhost:${port}/healthz" >/dev/null 2>&1; then
  pass "MCP health endpoint"
else
  info "MCP health endpoint is not responding on port ${port}"
fi

exit "$failed"
