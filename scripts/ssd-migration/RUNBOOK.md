# Toshiba APFS SSD -> Sandbox persistent storage, without versioned directory names

Date: 2026-11-01. Status: **STAGING PREPARED; CUTOVER NOT EXECUTED**.
The runtime stays on the same Mac, the same Docker Desktop engine,
the same two named Sandbox V3 containers, existing Cloudflare,
Browser Bridge and authenticated browser sessions.

## Recovery for macOS AppleDouble copyfile ENAMETOOLONG on deep archived paths

The Mac recovery-r2 initial live staging proceeded for 162 minutes,
transferring 39,425,572,496 bytes across 1,074,480 files. It then
returned rsync exit 23, with these failures in its private log:

    rsync(...): error: copyfile: File name too long
    .../archive/container-root/legacy-barehands/.cache/llama.cpp-src/
         tools/ui/.../._ChatAttachmentsListItem...svelte

This is Apple-specific rsync -E converting extended attributes
and Finder metadata into ._* pseudo-files. The synthetic AppleDouble
paths can exceed copyfile() limits in deeply nested Linux-origin
archives. The previous root-only sudo read and uv cache exclusion
still apply; the prior Git pack Permission denied was not the
reported cause of the latest failure.

Recovery r3 uses rsync -aH for ONLY the PERSISTENT Linux/container
data in the existing pinned SSD staging directory, while retaining
-aEH for the smaller native macOS controller source. This disables
the troublesome ._* xattr emulation during the bulk resume.
-aH still copies regular content and normal POSIX metadata
including uid/gid, mode, timestamps, symlinks and hardlinks. It
DOES NOT guarantee native macOS extended attributes or ACL parity.
This is allowed for NON-AUTHORITATIVE LIVE STAGING ONLY. Cold final
sync and independent xattr/ACL audit are required BEFORE retarget
or deletion of source, and may need a native metadata-aware pass for
host-sensitive files and scripts. The staging receipt explicitly
records initialPersistentCopyXattrsFullyPreserved:false and
xattrAndAclParityVerificationPending:true.

The fix does NOT exclude real ._ files indiscriminately. It
excludes only the existing exact disposable uv cache path, and
still includes all Git and project files. It does not use overwrite-
skipping or --ignore-existing, because doing so could overlook
incomplete or stale files. The quick-check rsync resumes into
the existing data destination without a checksum recopy. Old
rc1/rc23 private logs are preserved; new errors go to
rsync-persistent-no-appledouble.private.log.

Run on the Mac only after checking the SSD is mounted:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-stage-resume-r3-20261102"
    node "$BASE/stage-on-mac.mjs" --stage

This is STILL NOT a Docker cutover and the original Mac data must
remain in place until all acceptance gates pass. The expected
RESULT=STAGED_COPY_ONLY_NOT_CUTOVER does not override the
required future metadata verification.

## Recovery for stage directory permissions after successful controller copy

After the first resumed attempt, the preflight passed but the guarded
stage creation stopped with:

    STAGE_DIRECTORY_NOT_PRIVATE:cloud-sandbox-workstation

This is a self-inflicted *validation* failure, not a physical Toshiba
failure. The earlier successful controller rsync used -a and restored
the source checkout's 0755 permission mode on the terminal destination
directory. The original guard unconditionally demanded 0700 on every
directory, so it refused a directory which rsync itself had just made.

The revised guard validates the pinned APFS volume UUID, stage marker,
owner and symlink status as before. It requires 0700-compatible modes
on the NEW Sandbox root and each intermediate path, but explicitly
permits source-restored 0755 or 0750 modes on ONLY the two terminal
copy roots, source/cloud-sandbox-workstation and
persistent/cloud-sandbox-mcp-data, provided group and world are not
writable. Since parent paths stay owner-only, this does not expose the
secret-bearing contents to other macOS accounts.

Nothing is deleted, chmodded or chowned to compensate. It reuses the
existing partial stage with the same sudo archived-Git read fix and
targeted volatile uv-cache exclusion. The repaired release is:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-stage-resume-r2-20261102"
    node "$BASE/stage-on-mac.mjs" --stage

This is still only live staging; it is not a Docker cutover.

## Recovery after live staging rsync rc=1 (November 2, 2026)

The first real Mac staging attempt copied the controller checkout,
then returned RSYNC_PERSISTENT_EXIT_1 after approximately three
minutes. The source remains on internal Mac; the Toshiba target
has partial staged files and the original .sandbox-v3-stage.json.
No macOS mount cutover or Docker.raw relocation occurred.

Mac private log showed TWO classes of concrete errors:
- workspaces/<UUID>/home/.cache/uv/archive-v0/**/._* source
  AppleDouble sidecars disappear during the live copy.
  The exact uv cache is disposable and excluded from the
  resume, but NOT deleted from source.
- workspaces/<UUID>/archive/container-root/legacy-barehands/
  .cache/llama.cpp-src/.git/objects/pack/*.idx returned
  Permission denied. That archived Git object is NOT excluded.
  The resume runs only the persistent-data rsync via sudo after
  a normal Mac sudo -v, so the original file can be read.

The updated signed resume kit is staged at the shared-auth handoff
sandbox-v3-ssd-stage-resume-20261102. Use its new Mac script:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-stage-resume-20261102"
    node "$BASE/stage-on-mac.mjs" --stage

The existing stage marker and its exact UUID, paths and owner must
still match. Rsync copies incrementally into exactly the SAME
/Volumes/SSD/Sandbox destination and uses NO --delete. The script
prints no credentials and records private logs on the Toshiba.
No broad chmod, chown, Docker restart, Finder move or data deletion.

User consent to unencrypted removable SSD remains in force.
When rsync returns success the result is still LIVE STAGING ONLY:
final cold sync under quiesced Docker, Docker.raw GUI relocation,
startup volume guard, mount retarget and acceptance remain pending.
Even sudo cannot fix file disappearance outside the excluded cache
if writers modify a file while it is read; those cases require cold
final sync, not blind exclusion of business data.

## Accepted user policy

- The existing Toshiba 2 TB SSD is APFS but **not encrypted**. The
  operator explicitly accepts that state. Encryption is OPTIONAL
  and does not block migration. Removable unencrypted media presents
  physical disclosure risk; follow relevant corporate data policy.
- Do not partition, erase, or add an APFS volume. The target is a
  **version-neutral ordinary folder**: /Volumes/SSD/Sandbox.
  It is NOT /Volumes/Sandbox or /Volumes/SSD/SandboxV3.
- Preserve original Documents, Downloads, Development, MacStorage,
  historical V2 workspaces, Mac data root, browser sessions and
  Docker image. No prune or deletion without later separate approval.
- Mac code/agent storage uses stable names that do not change in V4.

## Grounded Mac preflight results (November 2, 05:53 UTC)

SSD: /Volumes/SSD, APFS external, UUID
A6268296-0330-4A69-9BE3-059BE8E4016A.
Free SSD: 1663.56 GiB. Free internal: 25.74 GiB.
Mount read/write: diskutil Writable=true, mount rw, macOS W_OK true.
No actual SSD write was made during the initial two inspections.
Encryption: optional, currently unencrypted.

Original data root:
  /Users/eduardosacahui/.cloud-sandbox-mcp-data

LIVE Mac controller Compose directory:
  /Users/eduardosacahui/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation

Different, historical SSD Git checkout:
  /Volumes/SSD/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation

Historical SSD Git HEAD: bbe13f9fc4e51ddbf01cc50191f404959097fb92.
The historical directory is NOT an active Docker bind source but has
30 top-level entries including Git, .env, Dockerfile, sources, npm
dependencies, config and possible untracked data. NEVER DELETE it
without file-level comparison, backup and separate explicit decision.

Existing Mac Docker bind mounts:
  cloud-sandbox-mcp /data -> ~/.cloud-sandbox-mcp-data
  dev-main /workspace -> original workspaces/<same UUID>/repo
  dev-main /home/agent -> original workspaces/<same UUID>/home
  dev-main /shared-auth -> original shared-auth
  dev-main /var/lib/docker -> original workspaces/<same UUID>/docker

Docker.raw logical maximum: 460.43 GiB, actually allocated 31.21 GiB.
The Docker Desktop disk file is distinct from all host bind mounts.

## Version-neutral folder layout

    /Volumes/SSD/
      Documents/                          existing, untouched
      Downloads/                          existing, untouched
      Development/                        historical V2, untouched
      MacStorage/                         other Mac data, untouched
      Sandbox/                            NEW dedicated directory
        .sandbox-v3-stage.json            staging identity, not version tag
        source/
          cloud-sandbox-workstation/      active Mac Compose checkout copy
        persistent/
          cloud-sandbox-mcp-data/         complete live host-data staging
        docker-desktop/                   initially empty for Docker GUI
        reports/                          private logs and status receipts

Agent-visible Linux paths must stay /workspace/projects,
/workspace/_shared, /shared-auth and /home/agent.
Mac command must remain sandbox. When code reaches V4/V5,
re-use these same storage paths without renaming.

## Phase 1: guarded staging copy (CODE PREPARED, MAC NOT EXECUTED)

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-stage-20261101"
    node "$BASE/stage-on-mac.mjs" --stage

Use --inspect instead of --stage for an entirely read-only check.

The script pins SSD UUID and exact real APFS mount, confirms
diskutil Writable, free space >=500 GiB, Mac user permissions,
source directory ownership, both running Docker containers and
the exact original bind sources. It refuses an unknown existing
target, symlink, renamed disk or stale container mount.

For --stage it creates ONLY the new Sandbox folder and descendants
with a private owner-only staging marker. It makes one disposable
32-byte SSD create/readback probe in Sandbox/reports, removes that
probe, then copies the original Mac controller checkout and full
~/.cloud-sandbox-mcp-data into the new source/ and persistent/
destinations using macOS rsync -aEH with --stats and NO --delete.
Rsync stdout/stderr are private logs under Sandbox/reports and
are not sent to chat. Any partial or failed rsync is NOT PASS.
A repeat is permitted only when the original staging marker
matches the current source and pinned SSD UUID.

The resulting receipt is at:
  /Volumes/SSD/Sandbox/reports/staging-receipt.json
and the shared Mac handoff last-mac-stage.json.

Important: the live initial stage may copy files while databases,
nested Docker or git are changing. It is NOT a consistent snapshot
and cannot authorize production cutover or old-data deletion.
The script does not stop Docker, change .env, copy Docker.raw,
retarget mounts, delete old data, restart services or free Mac disk.

## Phase 2: coordinated cold sync and verification (NOT EXECUTED)

- Inventory source and staged target file counts and usage.
- Record image/container IDs, labels, bind mounts, original Mac
  Compose config and original .env cryptographic hash.
- Quiesce all active agent workflows and writing services. Stop
  both existing named containers and the nested Docker writer,
  but do not prune/clean anything.
- Perform final source-to-SSD sync preserving metadata and symlinks
  without destructive flags; verify all files with strong checksums.
- Do not trust a partial copy, a diff made during active writes or
  a green rsync exit alone as application-consistency evidence.
- Keep original internal source directory intact for rollback.

## Phase 3: Docker Desktop image migration (NOT EXECUTED)

In the Mac Docker Desktop GUI, use:
Settings > Resources > Advanced > Disk image location >
Browse to /Volumes/SSD/Sandbox/docker-desktop > Apply.
Do NOT manually move Docker.raw or resize/reduce the disk image.
If Docker prompts to replace an existing image, STOP.

Official guidance:
https://docs.docker.com/desktop/troubleshoot-and-support/faqs/macfaqs/

The Docker Desktop disk image migration is separate from the
host bind mount migration and may restart Docker. Perform this
only during coordinated downtime and verify the same containers
after Docker Desktop performs the move.

## Phase 4: live mount cutover (NOT EXECUTED)

The Mac controller Compose and workspace provisioning must
point HOST_DATA_DIR and the five required mounts to
/Volumes/SSD/Sandbox/persistent/cloud-sandbox-mcp-data.
Do not assume the historical SSD Git checkout is the active
Compose source. Update source/cloud-sandbox-workstation with
a guarded backup and corresponding .env path, then test the
single dev-main worker and the existing controller without
duplicating their names, IDs or writable data.

Before starting Docker on a migrated host, the canonical sandbox
command needs a fail-closed check of the SSD's APFS Volume UUID.
Missing SSD must not cause Docker or Compose to create a new empty
/Volumes/SSD/Sandbox directory on the internal disk.
Docker Desktop File Sharing must allow the external bind paths.

Do not blindly replace the whole Mac ~/.cloud-sandbox-mcp-data
with an untested symlink; macOS tools, keychain-related helpers,
Bridge, agent configs, startup scripts and home paths may
expect original locations. Retarget all resolved paths explicitly.

## Phase 5: acceptance, rollback and old checkout

Confirm original V3 plugin handshake, exactly one controller +
dev-main, persistent workspaces and Git state, shared-auth,
nested Docker state, full data checksums and disposable read/write
persistence across a controlled restart. Confirm Cloudflare,
Caddy, Mac Chrome Bridge and both public HTTPS /health routes.

Rollback: stop migrated workload; restore the original Mac
Compose/host mount sources and Docker Desktop disk location via
the GUI. Reuse original unchanged Mac data, without deleting
SSD staging or the old V2 directory. The historical SSD repository
is only a potential archive candidate after its own detailed diff.

## Tool boundary

Sandbox V3 workspace_exec runs Linux INSIDE cloud-sandbox-dev-main.
It cannot use macOS diskutil or access physical /Volumes/SSD.
The signed Mac handoff must be run on the operator's Mac.
STAGING COPY AND LIVE CUTOVER REMAIN PENDING until explicitly
verified by receipts and independent runtime checks.
