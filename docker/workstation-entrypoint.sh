#!/usr/bin/env bash
set -euo pipefail

mkdir -p /var/lib/docker /var/log /var/run /home/agent/.cache /home/agent/.config

# A nested daemon gives the agent a complete Docker CLI/Compose experience
# without mounting the host Docker socket into the workstation.
dockerd \
  --host=unix:///var/run/docker.sock \
  --storage-driver="${INNER_DOCKER_STORAGE_DRIVER:-vfs}" \
  --data-root=/var/lib/docker \
  --pidfile=/var/run/docker.pid \
  > /var/log/dockerd.log 2>&1 &
DOCKERD_PID=$!

for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$DOCKERD_PID" >/dev/null 2>&1; then
    cat /var/log/dockerd.log >&2 || true
    exit 1
  fi
  sleep 1
done

if ! docker info >/dev/null 2>&1; then
  cat /var/log/dockerd.log >&2 || true
  exit 1
fi

# Keep the workstation alive while allowing `docker exec` to be the primary shell.
exec sleep infinity
