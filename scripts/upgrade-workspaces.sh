#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
./scripts/bootstrap.sh >/dev/null

read_env_value() {
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

HOST_DATA_DIR="$(read_env_value HOST_DATA_DIR)"
IMAGE="$(read_env_value SANDBOX_IMAGE)"
IMAGE="${IMAGE:-cloud-sandbox-workstation:latest}"

echo "Recreating existing workspace runtimes with $IMAGE"
find "$HOST_DATA_DIR/workspaces" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r dir; do
  id="$(basename "$dir")"
  name="cloud-sandbox-$id"
  repo="$dir/repo"
  home="$dir/home"
  docker_data="$dir/docker"
  mkdir -p "$repo" "$home" "$docker_data"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d \
    --name "$name" \
    --hostname "workstation-${id:0:8}" \
    --label cloud-sandbox-mcp=true \
    --label "cloud-sandbox-workspace=$id" \
    --workdir /workspace \
    --privileged \
    --pids-limit 2048 \
    --memory 8g \
    --cpus 4 \
    --network bridge \
    --mount "type=bind,src=$repo,dst=/workspace" \
    --mount "type=bind,src=$home,dst=/home/agent" \
    --mount "type=bind,src=$HOST_DATA_DIR/shared-auth,dst=/shared-auth" \
    --mount "type=bind,src=$docker_data,dst=/var/lib/docker" \
    --env HOME=/home/agent \
    --env GH_CONFIG_DIR=/shared-auth/gh \
    --env AWS_CONFIG_FILE=/shared-auth/aws/config \
    --env AWS_SHARED_CREDENTIALS_FILE=/shared-auth/aws/credentials \
    --env AWS_LOGIN_CACHE_DIRECTORY=/shared-auth/aws/login/cache \
    --env CI=true \
    --env INNER_DOCKER_STORAGE_DRIVER=vfs \
    "$IMAGE" >/dev/null
  echo "  recreated $id"
done
