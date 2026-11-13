# Toshiba SSD isolated nested Docker preflight

Previous evidence:
- A full cold source-to-SSD rsync completed with PASS for persistent
  data and controller.
- Reversible Engine direct bind cutover created both new containers
  but failed with HTTP POST 500 during workstation START.
- Automatic rollback restored original Docker IDs and mount paths.
- Read-only and combined privileged bind checks all PASS.
- An inert privileged candidate with the exact original network
  and six direct SSD mounts also START=PASS, with cleanup PASS.

The normal image Dockerfile declares the entrypoint:
    /usr/local/bin/cloud-sandbox-workstation

The entrypoint in docker/workstation-entrypoint.sh runs a nested
Docker daemon using data root /var/lib/docker and storage driver vfs,
then execs sleep infinity. The previous inert candidate bypassed
this actual entrypoint, so it did NOT establish nested daemon
compatibility with Toshiba.

The isolated SSD DIND smoke runs exactly the original workstation
image with the original entrypoint and --privileged, but mounts a
fresh, empty test directory in:
    /Volumes/SSD/Sandbox/reports/ssd-dind-isolated.XXXXXXXX
at /var/lib/docker. It does NOT mount real nested Docker state,
run existing nested app services, mount source Mac workspaces,
or mutate the active workstation.

The script verifies Toshiba exact volume UUID, original Docker
worker ID and running state, entrypoint contract and immutable
image digest before test. Then starts the temporary candidate,
waits for docker info through Docker exec, stops and removes only
that candidate on exit, and verifies original worker ID/running
status unchanged. Its temporary SSD Docker data is retained
for forensics and must be cleaned separately with precise
approval once the diagnosis is complete.

Mac operator command:
    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-dind-isolated-20261103"
    bash "$BASE/ssd-dind-isolated-smoke-on-mac.sh" --test

Expected:
    [SSD DIND Smoke] SSD_VFS_NESTED_DOCKER_READY=PASS
    [SSD DIND Smoke] ORIGINAL_WORKER_UNCHANGED_RUNNING=PASS
    [SSD DIND Smoke] RESULT=SSD_REAL_ENTRYPOINT_ISOLATED_SMOKE_PASS

The smoke test proves the entrypoint with a CLEAN temporary
nested data root only. It does NOT prove the copied real
/var/lib/docker is healthy and does NOT perform the cutover.
Only after its results should the active cutover code be patched
to capture full sanitized Engine POST 500 details, verify status,
and avoid redundant cold-sync costs while preserving data integrity.
