#!/bin/bash
# Verify original image entrypoint launches nested Docker on Toshiba.
# Does not touch existing SSD persistence or live Mac data.
set -euo pipefail
prefix='[SSD DIND Smoke]'
ok(){ printf '%s %s=PASS\n' "$prefix" "$1"; }
fail(){ printf '%s STOP=%s\n' "$prefix" "$1" >&2; exit 2; }
[ "$#" -eq 1 ] || fail 'USAGE_ONLY_TEST'
[ "$1" = --test ] || fail 'USAGE_ONLY_TEST'
[ "$(uname -s)" = Darwin ] || fail 'MAC_ONLY'
uuid=$(/usr/sbin/diskutil info -plist /Volumes/SSD |
  /usr/bin/plutil -extract VolumeUUID raw - 2>/dev/null) ||
  fail 'SSD_DISKUTIL_UUID_UNAVAILABLE'
[ "$uuid" = 'A6268296-0330-4A69-9BE3-059BE8E4016A' ] ||
  fail 'SSD_UUID_MISMATCH'
test -d /Volumes/SSD/Sandbox/reports ||
  fail 'SSD_REPORT_DIRECTORY_MISSING'
[ ! -L /Volumes/SSD/Sandbox/reports ] ||
  fail 'SSD_REPORT_DIRECTORY_SYMLINK'
test -w /Volumes/SSD/Sandbox/reports ||
  fail 'SSD_REPORT_DIRECTORY_NOT_WRITABLE'
ok SSD_UUID
startID=$(docker inspect -f '{{.Id}}' cloud-sandbox-dev-main) ||
  fail 'ORIGINAL_WORKER_NOT_FOUND'
image=$(docker inspect -f '{{.Image}}' cloud-sandbox-dev-main) ||
  fail 'ORIGINAL_WORKER_IMAGE_UNREADABLE'
running=$(docker inspect -f '{{.State.Running}}' cloud-sandbox-dev-main) ||
  fail 'ORIGINAL_WORKER_STATUS_UNREADABLE'
[ "$running" = true ] || fail 'ORIGINAL_WORKER_NOT_RUNNING'
case "$image" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) fail 'UNPINNED_WORKER_IMAGE' ;;
esac
entrypoint=$(docker inspect -f '{{json .Config.Entrypoint}}' cloud-sandbox-dev-main) ||
  fail 'ORIGINAL_ENTRYPOINT_UNREADABLE'
[ "$entrypoint" = '["/usr/local/bin/cloud-sandbox-workstation"]' ] ||
  fail 'UNEXPECTED_WORKER_ENTRYPOINT'
ok ORIGINAL_ENTRYPOINT
name="ssd-dind-isolated-$$"
tmp=$(mktemp -d /Volumes/SSD/Sandbox/reports/ssd-dind-isolated.XXXXXXXX) ||
  fail 'SSD_TEMP_DIRECTORY_CREATE_FAILED'
cleanup(){
  docker rm -f "$name" >/dev/null 2>&1 || true
  if [ -d "$tmp" ]; then
    printf '%s ISOLATED_TEST_FILES=%s\n' "$prefix" "$tmp"
  fi
}
trap cleanup EXIT
# Only the freshly created EMPTY SSD folder is mounted as Docker data,
# preventing duplicate child applications from a copied Docker state.
if ! docker run -d --pull=never --name "$name" \
  --privileged --security-opt label=disable \
  --network bridge \
  --mount "type=bind,src=$tmp,dst=/var/lib/docker" \
  --env INNER_DOCKER_STORAGE_DRIVER=vfs \
  "$image" >/dev/null; then
  fail 'DOCKER_ENGINE_START_WITH_ORIGINAL_ENTRYPOINT_FAILED'
fi
ok OUTER_WORKER_START
ready=no
i=0
while [ "$i" -lt 30 ]; do
  if docker exec "$name" docker info \
    --format '{{.ServerVersion}}' >/dev/null 2>&1; then
    ready=yes
    break
  fi
  [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" = true ] ||
    break
  i=$((i+1))
  sleep 2
done
if [ "$ready" != yes ]; then
  printf '%s INNER_DOCKER=FAILED\n' "$prefix"
  docker logs --tail 24 "$name" 2>&1 |
    sed -E 's#(/Users/)[^/]+/#\1[HOME]/#g' || true
  fail 'INNER_DOCKER_NOT_READY'
fi
ok SSD_VFS_NESTED_DOCKER_READY
afterID=$(docker inspect -f '{{.Id}}' cloud-sandbox-dev-main) ||
  fail 'ORIGINAL_WORKER_MISSING_POST_TEST'
afterRunning=$(docker inspect -f '{{.State.Running}}' cloud-sandbox-dev-main) ||
  fail 'ORIGINAL_WORKER_STATUS_FAILED_POST_TEST'
if [ "$startID" != "$afterID" ] || [ "$afterRunning" != true ]; then
  fail 'ORIGINAL_WORKER_STATE_CHANGED'
fi
ok ORIGINAL_WORKER_UNCHANGED_RUNNING
printf '%s RESULT=SSD_REAL_ENTRYPOINT_ISOLATED_SMOKE_PASS\n' "$prefix"
