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
