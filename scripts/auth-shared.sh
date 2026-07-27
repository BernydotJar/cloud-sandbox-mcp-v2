#!/usr/bin/env bash
set -euo pipefail

AUTH_CONTAINER="$(
  docker ps \
    --format '{{.Names}}' \
    | grep '^cloud-sandbox-[0-9a-f]' \
    | head -n 1
)"

if [ -z "$AUTH_CONTAINER" ]; then
  echo "No hay ninguna workstation activa." >&2
  exit 1
fi

echo "Usando workstation: $AUTH_CONTAINER"

if ! docker inspect "$AUTH_CONTAINER" \
  --format '{{range .Mounts}}{{println .Destination}}{{end}}' \
  | grep -qx '/shared-auth'; then
  echo "ERROR: $AUTH_CONTAINER todavía no tiene /shared-auth montado." >&2
  echo "Primero hay que modificar el runtime y recrear las workstations."
  exit 1
fi

echo
echo "=== GitHub ==="

docker exec -it \
  -e HOME=/home/agent \
  -e GH_CONFIG_DIR=/shared-auth/gh \
  "$AUTH_CONTAINER" \
  gh auth login \
    --hostname github.com \
    --git-protocol https \
    --web

docker exec \
  -e HOME=/home/agent \
  -e GH_CONFIG_DIR=/shared-auth/gh \
  "$AUTH_CONTAINER" \
  gh auth setup-git

echo
echo "=== AWS ==="

docker exec \
  -e HOME=/home/agent \
  -e AWS_CONFIG_FILE=/shared-auth/aws/config \
  -e AWS_SHARED_CREDENTIALS_FILE=/shared-auth/aws/credentials \
  "$AUTH_CONTAINER" \
  sh -lc '
    command -v aws
    aws --version
    aws configure list-profiles
    aws sts get-caller-identity
  '

echo
echo "Autenticación compartida validada."
