# Sandbox V3 to Toshiba SSD: guarded, reversible cold cutover

Date: 2026-11-02. Product runtime and existing Mac session only.
This release has NOT been run on the Mac.

Mac user confirmed:
- Initial live staging completed with r3 success receipt.
- SSD cutover read-only R2 doctor returned all PASS markers.
- Active Docker source mounts remain on the original internal Mac data root.

## One-time protected startup upgrade

The canonical installed sandbox command MUST verify the external SSD
UUID (A6268296-0330-4A69-9BE3-059BE8E4016A) when
~/.cloud-sandbox-mcp-data becomes a symlink to
/Volumes/SSD/Sandbox/persistent/cloud-sandbox-mcp-data.
The existing CLI installer checks signed package manifest hashes,
previous installed CLI hash, and backs up the prior installed V3 entry.

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-cold-cutover-20261102"
    node "$BASE/install-on-mac.mjs" --upgrade

This upgrade does NOT stop services, move data or change Docker.

## Real cutover (user-run, interactive Mac Terminal)

Do NOT run while unrelated agents or user workloads are active.
The command stops live controller and dev-main, gracefully stops
nested Docker workloads, pauses the audited Mac Bridge LaunchAgent,
and makes a final incremental cold rsync (the existing 40 GB stage
is reused). The rsync target paths are explicitly allowlisted.
The controlled --delete flags affect ONLY THE SSD STAGING MIRROR,
removing stale database WALs and old files from prior live copies.
Never delete source or original Mac backups. Persistent Linux data is
copied with -aH to avoid macOS AppleDouble ENAMETOOLONG; the native
controller checkout is copied with -aEH.
This is not full xattr/ACL parity: preserve Mac originals until
independent system-level acceptance.

    node "$BASE/cold-cutover-on-mac.mjs" --activate

It demands sudo auth BEFORE downtime, validates the signed package,
Toshiba UUID, stage receipt, both Docker bind mounts, original
controller .env, and installed CLI startup guard. It disables Docker
autostart (restart policy no) to prevent unguarded startup without
the SSD. It keeps existing named containers and their Docker IDs.

The ONLY Mac path cutovers are:
- ~/.cloud-sandbox-mcp-data -> /Volumes/SSD/Sandbox/persistent/cloud-sandbox-mcp-data
- ~/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation ->
  /Volumes/SSD/Sandbox/source/cloud-sandbox-workstation

Original Mac folders are renamed on their original filesystem to
.pre-ssd-cutover-DATE backups (not erased). If a symlink or startup
does not work, the script stops affected containers, unlinks its
known symlinks, restores original directories, starts the original
two containers, restores originally running inner Docker containers,
restores Docker restart policies and the Mac Bridge LaunchAgent.
A small recovery state file is on the INTERNAL Mac at:
  ~/.local/share/sandbox-v3/ssd-cutover-state.json
If interrupted mid-cutover before success, operator can rerun:
  node "$BASE/cold-cutover-on-mac.mjs" --rollback
Do not attempt rollback after success without reviewing data written
on the SSD since cutover: old Mac backups become intentionally stale.

The script checks physical SSD access via host-to-container read
probes for ALL 5 important bind destinations and an independent
container-to-host write probe. It verifies controller /healthz,
nested Docker daemon health and restores nested previously running
containers and the native Mac Bridge. On success the SSD controller
checkout's .env HOST_DATA_DIR is changed to the physical SSD data
path and Compose restart policy to no, but the retained Mac original
controller backup is NOT changed.

The successful result marker is:
  [SSD Final Cutover] RESULT=CUTOVER_TO_EXTERNAL_SSD_PASS

## Docker Desktop disk image is SEPARATE

This Mac application setting is NOT modified by the script.
After SSD bind cutover acceptance, or immediately before it during
planned downtime, use the Docker Desktop GUI:
  Settings > Resources > Advanced > Disk image location
  Browse -> /Volumes/SSD/Sandbox/docker-desktop
  Apply / Apply & restart

Do NOT manually move Docker.raw with Finder or shell. Do NOT
change disk-image size or choose "Replace" if Docker Desktop finds
an existing image. Docker Desktop may restart and the two containers
will not auto-start because the migration explicitly switches their
restart policies to no. Use the GUARDED sandbox command on the Mac
after verifying the Toshiba is mounted to start the EXISTING V3
controller and dev-main, never a new workstation.

## Acceptance and cleanup later

- Confirm SSD UUID, correct path and persistent read/write from
  both containers, nested Docker runtime and restored inner services.
- Confirm same workspace / git state, shared-auth, Browser Bridge,
  and protected public HTTPS health checks.
- Confirm Docker Desktop disk image path now resolves to SSD.
- Assess any macOS ACL/xattr parity needed for specific host apps.
- Retain BOTH Mac original folders until acceptance is proven after
  a Docker Desktop restart and a separate reconnect.
- Only then consider removing old Mac backups with a separate,
  explicitly authorized, carefully verified cleanup.
- Mac launch-on-login / scheduled tasks must use the guarded
  sandbox CLI rather than calling docker start directly.
- Existing historical V2 SSD checkout at
  /Volumes/SSD/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation
  must remain untouched; it is not the active controller.

## Limitations

The scripts were validated by Linux-side unit, security and
reversibility fixtures; no direct Mac physical cutover has been
executed from this ChatGPT session. A real macOS/Docker Desktop
environment can still reject symlink-backed binds or external
VirtioFS paths; the tool's physical read/write probes must pass,
or automatic rollback is required. Do not call a mere rsync success
proof of a consistent live application.
