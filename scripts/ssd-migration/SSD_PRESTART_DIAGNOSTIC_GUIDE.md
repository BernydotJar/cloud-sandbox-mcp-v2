# Safe macOS SSD Worker prestart diagnostic (2026-11-03)

Purpose: isolate Docker Engine HTTP 500 raised while starting a
fully configured SSD workstation before making another migration
attempt. Operator's Mac already returned combined privileged
six-mount runtime=PASS, and the prior copy was completed:
FINAL_RSYNC_PERSISTENT=PASS; FINAL_RSYNC_CONTROLLER=PASS;
ROLLBACK=ORIGINAL_CONTAINERS_RUNNING_AND_BINDS_VERIFIED.

The initial cutover caught the HTTP 500 from the Engine API but
did not capture the Engine message. The failed START occurred
immediately after NEW_CONTAINER_CREATED=cloud-sandbox-dev-main,
before cloud-sandbox-edge attach, nested Docker or controller start.
The old script MUST NOT be rerun; it would repeat a large metadata
scan and might fail in the same place.

The signed release validates the original Mac recovery journal
phase ROLLBACK_COMPLETE, exact Toshiba APFS UUID, 4 physical SSD
worker root paths, and identity of the running Docker Engine.

The operator runs:
    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-worker-prestart-20261103"
    node "$BASE/ssd-worker-prestart-diagnostic-on-mac.mjs" --test

This creates a uniquely named TEMPORARY stopped workstation
candidate with the exact original privileged HostConfig,
image digest, 6 mounts and primary bridge network, but deliberately
replaces its ENTRYPOINT and CMD with an inert "sleep infinity".
It then tries Docker Engine START, captures the Engine JSON error
message, sanitizes all original Env values and host paths before
printing a short classification/detail, stops/removes only the
temporary candidate, and verifies the original worker ID,
running state and all original mounts have not changed.

If the exact candidate start fails, it tries a second inert
candidate with clean primary network endpoint options (no
copied aliases or IPAM reservations). The difference tells
whether copied network endpoint metadata caused the failure.
The tool does not run dockerd inside the temporary candidate,
launch app processes, attach secondary cloud-sandbox-edge, execute
rsync, stop original containers, move Docker.raw, or delete any
source data. It NEVER touches the original controller.

Outputs:
  RESULT=FULL_RUNTIME_START_COMPATIBLE
  RESULT=ORIGINAL_ENDPOINT_CONFIG_SUSPECT
  RESULT=FULL_RUNTIME_START_FAILURE_CAUSE_CAPTURED

Even a successful diagnostic is NOT a completed data cutover.
The next patched cutover release must account for the exact Docker
failure and avoid unnecessary full metadata resync. Since original
containers resumed writing to the Mac sources after rollback,
a final bounded consistency reconciliation is still required.
Docker.raw migration through Docker Desktop GUI remains separate.

## APFS diskutil property compatibility fix (v2, 2026-11-03)

The v1 Mac operator invocation stopped BEFORE Docker with:
  STOP=SSD_VOLUME_PIN_MISMATCH

Root cause in the v1 source: it demanded APFS from the
FileSystemPersonality property only. The Mac audit that previously
passed validates BOTH FileSystemPersonality and FilesystemType,
because diskutil plist may populate either key. The v2 fix
reuses the auditor's exact FS-property/APFS detection and
read-write/External/UUID/MountPoint constraints, without dropping
a single identity gate. Each individual pin now prints PASS/FAIL
without exposing the actual device UUID or any secrets:
  SSD_APFS, SSD_WRITABLE, SSD_UUIDMATCH, SSD_EXTERNAL, SSD_MOUNT.
A mismatch still fails closed before Docker.

Use immutable v2 release directory:
  sandbox-v3-ssd-worker-prestart-v2-20261103

The original v1 bundle MUST NOT be overwritten or reused.
