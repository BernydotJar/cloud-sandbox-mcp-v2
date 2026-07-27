#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/Volumes/SSD/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation"
MCP_SERVICE="mcp"
MCP_PORT="3000"

NGROK_DOMAIN="john-comrade-arise.ngrok-free.dev"
NGROK_LOG="/tmp/cloud-sandbox-ngrok.log"
NGROK_PID_FILE="/tmp/cloud-sandbox-ngrok.pid"

WORKSTATIONS=(
  "cloud-sandbox-b78a97c4-d9ff-48eb-96cb-7ee5d65f8bfc"
  "cloud-sandbox-601929eb-4bf6-4900-8170-c15bf3a11ea0"
  "cloud-sandbox-7759306b-d1ea-40ed-92dc-b78424c749ba"
)

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf '\nWARN: %s\n' "$*" >&2
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    die "No se encontró el comando requerido: $1"
}

wait_for_docker() {
  local attempt=0

  until docker info >/dev/null 2>&1; do
    attempt=$((attempt + 1))

    if [ "$attempt" -ge 120 ]; then
      die "Docker Desktop no quedó disponible después de 4 minutos."
    fi

    printf '.'
    sleep 2
  done

  printf '\n'
}

wait_for_mcp() {
  local attempt=0
  local container_id=""
  local state=""

  while [ "$attempt" -lt 60 ]; do
    container_id="$(docker compose ps -q "$MCP_SERVICE" 2>/dev/null || true)"

    if [ -n "$container_id" ]; then
      state="$(
        docker inspect \
          --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "$container_id" 2>/dev/null || true
      )"

      if [ "$state" = "healthy" ] || [ "$state" = "running" ]; then
        echo "Controlador MCP: $state"
        return 0
      fi
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  docker compose logs --tail 100 "$MCP_SERVICE" 2>/dev/null || true
  die "El controlador MCP no quedó disponible."
}

start_workstation() {
  local container="$1"

  if ! docker inspect "$container" >/dev/null 2>&1; then
    warn "No existe $container. No se creará otro workspace con UUID diferente."
    return 1
  fi

  docker start "$container" >/dev/null 2>&1 || true

  local attempt=0

  while [ "$attempt" -lt 20 ]; do
    if [ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" = "true" ]; then
      echo "$container: running"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  warn "$container no quedó en ejecución."
  docker logs --tail 50 "$container" 2>&1 || true
  return 1
}

repair_dind_if_needed() {
  local container="$1"

  if docker exec "$container" sh -lc \
    'docker info >/dev/null 2>&1'; then
    echo "$container: Docker interno OK"
    return 0
  fi

  echo "$container: reparando Docker interno"

  docker exec -u 0 "$container" sh -lc '
    set -u

    pkill -9 dockerd 2>/dev/null || true
    pkill -9 containerd 2>/dev/null || true

    rm -f /var/run/docker.pid
    rm -f /var/run/docker.sock
    rm -f /var/run/docker/containerd/containerd.pid
    rm -f /var/run/docker/containerd/containerd.sock

    mkdir -p /var/run/docker/containerd

    nohup dockerd > /var/log/dockerd.log 2>&1 &

    i=0
    while [ "$i" -lt 60 ]; do
      if docker info >/dev/null 2>&1; then
        exit 0
      fi

      i=$((i + 1))
      sleep 1
    done

    echo "Docker interno no inició."
    tail -n 100 /var/log/dockerd.log 2>/dev/null || true
    exit 1
  '

  echo "$container: Docker interno reparado"
}

select_auth_container() {
  local container

  for container in "${WORKSTATIONS[@]}"; do
    if [ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" = "true" ]; then
      printf '%s\n' "$container"
      return 0
    fi
  done

  return 1
}

validate_shared_auth() {
  local container="$1"

  docker exec "$container" sh -lc '
    test -d /shared-auth &&
    test -w /shared-auth
  ' || die "$container no tiene /shared-auth montado y escribible."
}

ensure_github_auth() {
  local container="$1"

  log "Validando GitHub compartido"

  if docker exec \
    -e HOME=/home/agent \
    -e GH_CONFIG_DIR=/shared-auth/gh \
    "$container" \
    sh -lc 'gh auth status >/dev/null 2>&1'; then

    echo "GitHub: autenticado"
  else
    echo "GitHub requiere autenticación."

    docker exec -it \
      -e HOME=/home/agent \
      -e GH_CONFIG_DIR=/shared-auth/gh \
      "$container" \
      sh -lc '
        set -e
        mkdir -p "$GH_CONFIG_DIR"
        gh auth login
        gh auth setup-git
        gh auth status
      '
  fi

  docker exec \
    -e HOME=/home/agent \
    -e GH_CONFIG_DIR=/shared-auth/gh \
    "$container" \
    sh -lc '
      set -e

      gh auth setup-git >/dev/null

      cd /workspace

      if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "Git remote check: omitido; /workspace no es un repositorio Git"
        exit 0
      fi

      if ! git remote get-url origin >/dev/null 2>&1; then
        echo "Git remote check: omitido; no existe origin"
        exit 0
      fi

      git ls-remote origin >/dev/null
      echo "GitHub remote access: OK"
    '
}

ensure_aws_auth() {
  local container="$1"

  log "Validando AWS compartido"

  if docker exec \
    -e HOME=/home/agent \
    -e AWS_CONFIG_FILE=/shared-auth/aws/config \
    -e AWS_SHARED_CREDENTIALS_FILE=/shared-auth/aws/credentials \
    -e AWS_LOGIN_CACHE_DIRECTORY=/shared-auth/aws/login/cache \
    "$container" \
    sh -lc 'aws sts get-caller-identity >/dev/null 2>&1'; then

    echo "AWS: autenticado"
    return 0
  fi

  echo "AWS requiere autenticación."

  docker exec -it \
    -e HOME=/home/agent \
    -e AWS_CONFIG_FILE=/shared-auth/aws/config \
    -e AWS_SHARED_CREDENTIALS_FILE=/shared-auth/aws/credentials \
    -e AWS_LOGIN_CACHE_DIRECTORY=/shared-auth/aws/login/cache \
    "$container" \
    sh -lc '
      set -e

      mkdir -p /shared-auth/aws/login/cache

      aws login --remote
      aws sts get-caller-identity
    '
}

stop_ngrok() {
  if [ -f "$NGROK_PID_FILE" ]; then
    local pid
    pid="$(cat "$NGROK_PID_FILE" 2>/dev/null || true)"

    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 2
    fi

    rm -f "$NGROK_PID_FILE"
  fi

  pkill -f "ngrok http ${MCP_PORT}" 2>/dev/null || true
  sleep 1
}

start_ngrok() {
  log "Iniciando ngrok"

  stop_ngrok

  nohup ngrok http "$MCP_PORT" \
    --url="https://${NGROK_DOMAIN}" \
    --host-header="localhost:${MCP_PORT}" \
    >"$NGROK_LOG" 2>&1 &

  local pid=$!
  echo "$pid" > "$NGROK_PID_FILE"

  local attempt=0

  until curl -fsS http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; do
    attempt=$((attempt + 1))

    if ! kill -0 "$pid" 2>/dev/null; then
      tail -n 100 "$NGROK_LOG" 2>/dev/null || true
      die "ngrok terminó antes de publicar el túnel."
    fi

    if [ "$attempt" -ge 30 ]; then
      tail -n 100 "$NGROK_LOG" 2>/dev/null || true
      die "ngrok no quedó disponible."
    fi

    sleep 1
  done

  echo "ngrok: activo"
}

read_env_value() {
  local key="$1"
  local file="$2"

  awk -F= -v key="$key" '
    $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/\r$/, "")
      print
      exit
    }
  ' "$file"
}

validate_public_endpoint() {
  local env_file="${PROJECT_DIR}/.env"
  local secret=""
  local public_url="https://${NGROK_DOMAIN}"
  local mcp_url=""
  local status=""
  local attempt=0

  [ -f "$env_file" ] || die "No existe ${env_file}."

  secret="$(read_env_value MCP_PATH_SECRET "$env_file")"

  [ -n "$secret" ] ||
    die "MCP_PATH_SECRET no está definido en ${env_file}."

  mcp_url="${public_url}/mcp/${secret}"

  log "Validando endpoint público"

  until curl -fsS "${public_url}/healthz" >/dev/null 2>&1; do
    attempt=$((attempt + 1))

    if [ "$attempt" -ge 30 ]; then
      tail -n 100 "$NGROK_LOG" 2>/dev/null || true
      die "El endpoint ${public_url}/healthz no responde."
    fi

    sleep 1
  done

  echo "Health endpoint: OK"

  status="$(
    curl -sS \
      -o /tmp/cloud-sandbox-mcp-check.out \
      -w '%{http_code}' \
      "$mcp_url"
  )"

  case "$status" in
    200|400|405|406|415)
      echo "MCP endpoint: alcanzable, HTTP ${status}"
      ;;
    *)
      cat /tmp/cloud-sandbox-mcp-check.out 2>/dev/null || true
      die "Respuesta inesperada del endpoint MCP: HTTP ${status}."
      ;;
  esac

  printf '%s\n' "$mcp_url" > /tmp/cloud-sandbox-mcp-url.txt

  printf '\nMCP URL:\n%s\n' "$mcp_url"
}

show_status() {
  log "Estado final"

  docker compose ps

  echo
  echo "Workstations autorizadas:"

  local container
  local state

  for container in "${WORKSTATIONS[@]}"; do
    state="$(
      docker inspect \
        --format '{{.State.Status}}' \
        "$container" 2>/dev/null ||
        echo "missing"
    )"

    printf '  %-72s %s\n' "$container" "$state"
  done

  echo
  echo "ngrok inspector: http://127.0.0.1:4040"
  echo "ngrok log: $NGROK_LOG"
  echo "MCP URL file: /tmp/cloud-sandbox-mcp-url.txt"
}

main() {
  require_command docker
  require_command curl
  require_command ngrok
  require_command open

  [ -d "$PROJECT_DIR" ] ||
    die "No existe PROJECT_DIR: $PROJECT_DIR"

  cd "$PROJECT_DIR"

  log "Iniciando Docker Desktop"
  open -a Docker

  printf 'Esperando Docker'
  wait_for_docker

  log "Levantando controlador MCP"
  docker compose up -d "$MCP_SERVICE"
  wait_for_mcp

  log "Levantando solo las tres workstations autorizadas"

  local container

  for container in "${WORKSTATIONS[@]}"; do
    start_workstation "$container" || true
  done

  log "Validando Docker interno"

  for container in "${WORKSTATIONS[@]}"; do
    if [ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" = "true" ]; then
      repair_dind_if_needed "$container"
    fi
  done

  local auth_container=""
  auth_container="$(select_auth_container || true)"

  if [ -n "$auth_container" ]; then
    validate_shared_auth "$auth_container"
    ensure_github_auth "$auth_container"
    ensure_aws_auth "$auth_container"
  else
    warn "No hay workstation activa para validar GitHub y AWS."
  fi

  start_ngrok
  validate_public_endpoint
  show_status
}

main "$@"
