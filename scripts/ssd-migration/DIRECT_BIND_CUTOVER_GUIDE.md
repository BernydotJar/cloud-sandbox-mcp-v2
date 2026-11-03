# Toshiba APFS SSD - guarded direct-bind cutover after successful rehearsal

Date: 2026-11-03. PREPARED ONLY. MAC CUTOVER NOT YET EXECUTED.

## Verified evidence

- Original symlink-based cutover failed after a completed 95-minute cold rsync
  and Docker exec error. The user independently verified the rollback:
  RECUPERACION_OPERATIVA=PASS; both Mac roots are physical directories,
  both original containers running, all original five binds correct,
  original restart policies restored.
- The user's real Mac audited both containers, then verified
  CONTROLLER_EXEC=PASS, WORKSTATION_EXEC=PASS, SSD_DIRECT_BIND=PASS.
- The exact Docker CREATE rehearsal passed for the controller and worker
  with SSD binds. Temporary containers were removed and the live originals
  stayed unchanged.
- Real controller has custom image, port 3000, Compose network,
  extra /app/dist read-only bind and docker.sock. Real worker has
  bridge plus cloud-sandbox-edge, privileged mode, two extra host binds,
  and custom security settings. These must remain.

Never run the old symlink-based cold-cutover-on-mac.mjs --activate.

## Mac operator commands

1. Upgrade the already installed sandbox CLI to enforce pinned external
   UUID and physical Docker source path checks BEFORE existing starts:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-direct-bind-cutover-20261103"
    node "$BASE/install-on-mac.mjs" --upgrade

2. Read-only final preflight, no Docker changes, no data transfer:

    node "$BASE/direct-bind-cutover-on-mac.mjs" --inspect

Expected:
    RESULT=DIRECT_SSD_CUTOVER_PREFLIGHT_PASS

3. During an explicitly planned downtime, the real data-bind cutover:

    node "$BASE/direct-bind-cutover-on-mac.mjs" --activate

This last command prompts for sudo BEFORE pausing services. It might
require another long cold metadata scan; it should copy only changed
files but cannot promise short duration on millions of files.

## Guarded runtime sequence

- A private recovery journal on INTERNAL Mac:
  ~/.local/share/sandbox-v3/ssd-direct-cutover-state.json
  Never contains passwords, token values or full Docker inspect.
  During transition, canonical sandbox command refuses to start
  Docker services until journal is success or rollback complete.
- Temporarily disable original restart policies; pause existing Mac
  Bridge LaunchAgent, stop running nested Docker child containers,
  then gracefully stop the current worker and controller via Docker
  Engine API, verifying actual stopped state even after spurious
  stop errors.
- Final cold rsync from original Mac sources to exact previously
  populated Toshiba leaves, no source deletion. Target-only
  --delete removes stale WAL/SHM in SSD staging. Linux-origin
  persistent data uses -aH to avoid AppleDouble ENAMETOOLONG;
  Mac controller uses -aEH. Original uV cache alone is excluded.
- Rename both ORIGINAL STOPPED containers to unique
  ssd-old-cloud-sandbox-... names, retaining original IDs, their
  host binds, and internal Mac data.
- Using the entire verified Docker Config/HostConfig, create new
  canonical controller + workstation using pinned image IDs.
  Change only five physical host bind mounts. Keep extra binds
  and secrets intact; set new restart policy no (guarded CLI start).
- Explicitly change controller HOST_DATA_DIR from original Mac root
  to SSD physical root. The server uses this variable to provision
  NEW workspaces; leaving it unchanged would create split data.
  Every other environment variable must match byte-for-byte.
- Start worker first, attach secondary cloud-sandbox-edge AFTER
  start (some Docker Engine versions refuse this while stopped).
  Restore and verify nested Docker state, then start controller.
  Verify 5 mounted SSD source locations and read/write probes,
  both worker networks, image/privilege/resources, extra mounts,
  environment parity and controller /healthz.
- Resume Mac Bridge. Mark success; keep original containers stopped
  with their original bind sources for separate rollback acceptance.

Expected:
    RESULT=DIRECT_SSD_BIND_CUTOVER_PASSED

## Recovery

Any failure attempts automatic rollback:
- STOP and remove ONLY positively identified NEW candidate containers.
- Rename the SAME original container IDs to canonical names.
- Start originals, restore original restart policies, nested Docker
  children and Mac Bridge.
- Independently verify all five original mounts and running state.
- Preserve original Mac roots and all SSD files.

If a power loss or abnormal exit interrupts the transaction, a later
Mac Terminal command can use the internal journal:

    node "$BASE/direct-bind-cutover-on-mac.mjs" --rollback

Do not use rollback after successful cutover without reconciling
post-cutover writes that may exist only on Toshiba.

## Still pending even after data-bind success

- Compose env / overrides are NOT automatically rewritten. Do not
  run Docker Compose up/down until their exact overlay/image parity
  is reconciled, or it may recreate a wrong container.
- Mac-side native helpers and local shared-auth handoff paths still
  reference the original Mac home path, and must be retargeted and
  verified in a separate compatibility change. Direct Docker bind
  success is NOT full Mac host path migration.
- Docker.raw remains internal: move ONLY in Docker Desktop GUI
  Settings > Resources > Advanced > Disk image location using
  /Volumes/SSD/Sandbox/docker-desktop. Do not copy a live Docker.raw.
- Browser Bridge, Cloudflare public HTTPS, plugin handshake, Git
  persistent workspaces, nested Docker and CLI restart need E2E QA.
- Metadata ACL/xattr parity for host-sensitive files is pending.
- Backed-up Mac original files and Docker containers must be retained
  until independent acceptance and separate explicit cleanup approval.
- Historical V2 SSD checkout under /Volumes/SSD/Development remains
  untouched.

## Testing

Linux-side unit tests include a fake Docker Engine Unix socket
simulating a misleading HTTP 500 stop after the container has
actually stopped, container rename, restart policies, candidate
removal, and protection against deleting a similarly named
unrelated container. The tests do NOT substitute for Mac activation.

## Second guarded activation after rollback: version 2

2026-11-03, first Mac attempt completed the 2 cold syncs and created
both temporary SSD-backed containers, but returned generic
ENGINE_HTTP_POST_500 and rolled back successfully. The restored
original containers were verified running with original Mac bind
sources. A sequence of independent macOS tests then proved:
- full worker mount set and privileged flags on SSD: PASS;
- exact original worker host + network configuration with inert PID1:
  START=PASS, cleanup PASS;
- exact original cloud-sandbox-edge SECONDARY network attachment:
  PASS, cleanup PASS;
- real workstation entrypoint starting nested Docker with vfs on a
  fresh empty Toshiba SSD test directory: PASS.

These checks do NOT prove that the prior copied production nested
Docker data is healthy. The original Docker Engine 500 response
was discarded, so it is still possible to hit the error again.

V2 changes the direct-bind cutover only (no installed CLI update):
- Logs the exact currently running Engine operation and durable
  journal phase before worker START, secondary-network CONNECT
  and controller START. This disambiguates HTTP POST failures.
- Classifies and redacts Docker Engine error response. Secrets from
  both original container Env blocks are redacted in memory;
  no raw Docker API response or full inspect is written to disk.
- Verifies Docker Engine state if it reports an error after a
  successful worker/container start; accepts actual RUNNING only.
- Likewise verifies actual cloud-sandbox-edge network attachment
  if Docker responds with an error.
- Retains the existing SSD UUID guard, original image/config
  parity, renamed stopped source containers, private transaction
  journal, sudo preflight, final cold delta reconciliation,
  health checks and fully guarded original rollback.

Signed release directory:
sandbox-v3-ssd-direct-bind-cutover-v2-20261103

Commands on the operator Mac:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-direct-bind-cutover-v2-20261103"
    node "$BASE/direct-bind-cutover-on-mac.mjs" --inspect
    node "$BASE/direct-bind-cutover-on-mac.mjs" --activate

The Mac original workloads were resumed after the prior rollback
and may have written data since then. The final cold rsync is still
required for consistency, and may traverse several million files
even if few bytes change. Skipping it would be unsafe.
On success, verify new mounts and critical application workflows
BEFORE reclaiming old Mac storage. The success receipt explicitly
states DELETE_MAC_DATA=NO. Do not delete
~/.cloud-sandbox-mcp-data/shared-auth: native Mac browser bridge and
handoff paths may still refer to it. Do not delete the internal Mac
controller worktree until its native/Compose helpers are retargeted.
Never move a live Docker.raw manually; Docker Desktop GUI can
move it independently after the direct bind cutover is proven.

## Version 3: guarded fast cutover after two completed cold rsync runs

Last real macOS cutover:
- COLD_SYNC_ACTIVE persisted 82 minutes; BOTH final syncs PASS;
- two SSD-backed candidates created;
- worker START PASS, cloud-sandbox-edge CONNECT PASS;
- nested docker info and restoration of previously running inner
  containers succeeded, as the sequence reached controller start;
- controller START failed because HOST PORT 3000 ALREADY ALLOCATED,
  error class and phase explicitly verified;
- automatic rollback restored both original running Mac containers,
  original binds, and Mac bridge, leaving SSD copy intact.

The previous copy is NOT invalid; the failure was a published host
network port reservation for the controller, not an SSD volume fault.

v3 adds --activate-fast with these constraints:

1. Run full original preflight (pinned Toshiba APFS UUID, original
   directories, CLI guard, staging receipts, original container
   image/config and Docker Engine identity).
2. Confirm no other running Docker container claims host port 3000.
3. Require exact previous private rollback journal phase
   ROLLBACK_COMPLETE, both unchanged ORIGINAL CONTAINER IDs and
   image digests, and fresh nonempty private reports from the
   preceding full persistent/controller cold sync, within that
   journal's createdAt/restoredAt window.
4. Stop all original writers with the existing guarded transaction.
   Wait for macOS lsof to report that host TCP 3000 is free. Never
   kill a process or a Docker container that owns the port. If
   still busy, rollback automatically without running rsync.
5. Reuse the existing SSD snapshot. NO full-tree rsync, no clone
   copy, no file deletion or symlink replacement.
6. Recreate/validate same two canonical containers, 5 direct
   bind sources, cloud-sandbox-edge, real nested Docker, restored
   inner workloads, controller healthz, read/write probes and
   Mac bridge. Preserve all original Mac source files and renamed
   stopped original container instances.

Because workloads were restarted on Mac after the prior full
sync, FAST mode does NOT reconcile any writes/deletes that took
place AFTER the last sync. In particular, recent SQLite/Firestore
files, code changes, nested Docker volumes, authentication changes
and project updates may be absent from the SSD snapshot. The
operator must validate important projects and accept this
limitation before using the new environment for further writes.

On success the output is:
  RESULT=DIRECT_SSD_BIND_CUTOVER_PASSED_FAST_UNRECONCILED
  DELETE_SOURCE_ORIGINALS=BLOCKED_UNTIL_POSTCUTOVER_RECONCILIATION_AND_VERIFICATION

The result is intentionally different from the fully reconciled
cutover. A fast success does NOT authorize deleting original Mac
workspace or shared-auth data. When SSD is subsequently changed,
blindly copying the older Mac source onto it can overwrite newly
created SSD data; later reconciliation needs a two-sided,
change-aware procedure or an archival backup of the original data.

Operator commands:
    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-direct-bind-cutover-v3-20261103"
    node "$BASE/direct-bind-cutover-on-mac.mjs" --inspect
    node "$BASE/direct-bind-cutover-on-mac.mjs" --activate-fast

Release is a new immutable signed package. Do NOT overwrite v1/v2
files or run old --activate; old command still triggers full sync.

Port diagnosis without mutations:
    docker ps --format '{{.Names}} {{.Ports}}' | grep ':3000->'
    lsof -nP -iTCP:3000 -sTCP:LISTEN
This is expected to show original cloud-sandbox-mcp when running.
A transient lsof owner AFTER the old controller is stopped must
clear before the new controller starts.

For fast space recovery, move Docker.raw only via the Docker
Desktop settings GUI AFTER the new SSD runtime is verified; do not
manually move or delete an active disk image. Full original-data
cleanup is an independent, explicitly guarded operation after
source reconciliation, acceptance and Mac helper retargeting.
