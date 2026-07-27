#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"

read_env_value() {
  local key="$1"
  local file="${2:-$ENV_FILE}"
  local value
  value="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  # Trim leading/trailing whitespace without changing internal spaces.
  value="$(printf '%s' "$value" | awk '{$1=$1};1')"
  printf '%s' "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/cloud-sandbox-env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example."
fi

secret="$(read_env_value MCP_PATH_SECRET)"
case "$secret" in
  ''|'replace-with-a-long-random-value'|'development-secret-change-me')
    secret="$(generate_secret)"
    set_env_value MCP_PATH_SECRET "$secret"
    echo "Generated a strong MCP_PATH_SECRET in $ENV_FILE."
    ;;
esac

if [[ ${#secret} -lt 32 ]]; then
  echo "MCP_PATH_SECRET must contain at least 32 characters. Current value has ${#secret}." >&2
  exit 1
fi

host_data_dir="$(read_env_value HOST_DATA_DIR)"
if [[ -z "$host_data_dir" || "$host_data_dir" == '/var/lib/cloud-sandbox-mcp' ]]; then
  host_data_dir="${HOME}/.cloud-sandbox-mcp-data"
  set_env_value HOST_DATA_DIR "$host_data_dir"
  echo "Configured HOST_DATA_DIR=$host_data_dir."
fi

if [[ "$host_data_dir" != /* ]]; then
  echo "HOST_DATA_DIR must be an absolute host path: $host_data_dir" >&2
  exit 1
fi

# Normalize values that are frequently pasted with trailing whitespace.
set_env_value MCP_PATH_SECRET "$secret"
set_env_value HOST_DATA_DIR "$host_data_dir"
set_env_value GIT_AUTHOR_NAME '"ChatGPT Sandbox Agent"'

mkdir -p "$host_data_dir"
chmod 600 "$ENV_FILE" 2>/dev/null || true

printf '\nConfiguration ready.\n'
printf '  env file: %s\n' "$ROOT/$ENV_FILE"
printf '  data dir: %s\n' "$host_data_dir"
printf '  secret fingerprint: %s...%s\n' "${secret:0:8}" "${secret: -8}"
printf 'Run: ./scripts/setup.sh\n'
