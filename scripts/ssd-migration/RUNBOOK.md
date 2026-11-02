# Sandbox V3 -> Toshiba APFS SSD: staged, reversible migration

Status: **PREPARATION ONLY — NO CUTOVER EXECUTED**  
Date: November 1, 2026. Target is the **same macOS operator machine**, existing Sandbox V3 controller and the single persistent cloud-sandbox-dev-main workstation.

## Non-negotiable constraints

- Toshiba existing 2 TB APFS SSD, mounted previously at /Volumes/SSD, with approximately 1.6 TB free. Verify actual Volume UUID, filesystem, mount path and capacity on the Mac **again** before migration.
- The SSD already contains downloads, documents, V2 work, historical datasets and other development. **Never erase, reformat, repartition, rename, prune, overwrite, or delete those files.** Keep previous SSD directories and /Volumes/SSD/MacStorage untouched.
- Do not run diskutil erase*, docker system prune, docker volume prune, rm -rf, Docker Desktop Reset, mass chmod/chown, or change Docker Desktop's disk-size limit.
- Never move Docker.raw or Docker.qcow2 directly via Finder, shell, rsync or symbolic links. Docker Desktop must migrate its own disk image via Settings > Resources > Advanced > Disk image location.
- Never copy a live nested-Docker directory or database and claim that copy is consistent. Final filesystem snapshot requires coordinated writer shutdown and verification.
- Never create a second Docker Desktop daemon, controller, workstation, Cloudflare tunnel or macOS VM.
- Keep the existing Mac Bridge, LaunchAgents, Caddy, Cloudflare, Keychain credentials, native tools and browser profiles on **this Mac**.
- Once storage depends on the SSD, fail closed if the expected APFS Volume UUID is missing. Avoid Docker silently creating a replacement directory on the internal disk.
- Original internal data remains available for rollback until independently accepted; cleanup is a separate future decision.

## Proposed dedicated layout

    /Volumes/SSD/                         existing APFS volume, preserve all
      Documents/                          existing — untouched
      Downloads/                          existing — untouched
      Development/                        existing V2 and other work — untouched
      MacStorage/                         separate Mac files — untouched
      SandboxV3/                          proposed dedicated directory, only if absent
        docker-desktop/                   Docker Desktop UI-managed VM disk
        persistent/
          cloud-sandbox-mcp-data/         validated copy of original Mac data root
            workspaces/                   existing worktrees/home/nested Docker
            shared-auth/                 V2/V3 shared material, credentials and handoffs
            ...                          other original data kept intact
        reports/                          sanitized migration evidence
        snapshots/                        optional safe rollback copies

Agent-visible paths must remain /workspace/projects, /workspace/_shared and /shared-auth. Command must remain sandbox and connector preference remains Sandbox V3.

**No host binding, symlink, user permission, or Docker Desktop setting has been changed.**

## Phase A — read-only Mac preflight

Command on the operator Mac:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-migration-20261101"
    node "$BASE/preflight-on-mac.mjs" --inspect

The executable reads the disk metadata with diskutil and plutil, confirms:
- Mounted path exactly /Volumes/SSD, external volume, APFS, read/write, valid Volume UUID
- Free SSD storage >= 500 GiB, actual size, current free internal storage
- Confirmed APFS encryption status (or manual review if encryption
  cannot be proven), especially before moving shared-auth or Docker images
- Existing source ~/.cloud-sandbox-mcp-data, workspaces and shared-auth
- docker inspect for BOTH actual Mac Docker Desktop containers: cloud-sandbox-mcp and cloud-sandbox-dev-main
- Actual allowlisted bind mounts, compose working directory, and optional Docker disk-image location metadata
- Existing folders on Toshiba are detected without reading their contents
- Target /Volumes/SSD/SandboxV3 must be absent or sent for explicit collision reconciliation
- Source path symlinks and external mount ambiguities are surfaced, not silently repaired

A small sanitized JSON report is written **only** to:

    ~/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-migration-20261101/last-mac-preflight.json

Sandbox V3 can read the report at:

    /shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-migration-20261101/last-mac-preflight.json

The script performs NO disk writes on the Toshiba and does not move data, reboot, stop services, change permissions or touch Docker settings. Linux workspace_exec **cannot inspect the Mac disk via diskutil**; its internal nested Docker daemon is not Mac Docker Desktop.

Expected gate after this step: PREPARED_NEEDS_CUTOVER, MANUAL_REVIEW_REQUIRED or BLOCKED. Preflight success is NOT migration success.

## Phase B — baseline, backup and migration design (after real preflight)

- Pin SSD Volume UUID, mount path and capacity, plus exact Mac source root real path. Establish baseline of source dataset sizes and all Docker bind mount locations.
- Snapshot existing container IDs, images, mounts, Compose labels, project status, volume references and controller health.
- Determine disk image location and actual allocated bytes in Docker Desktop.
- Security gate: If APFS encryption is NOT CONFIRMED, do not migrate
  credentials or authentication-bearing Docker data onto plaintext
  removable media. Either keep secrets on the Mac or design a separate
  approved encrypted store, without altering existing SSD partitions. A sparse file's logical size is not its physical allocated size.
- Check which historical V2 data shares the current ~/.cloud-sandbox-mcp-data source. Preserve it, even if V2 connector is no longer preferred.
- Decide path strategy using actual mounts: explicit host bind reconfiguration OR a compatibility-tested path-preserving link. Do not unconditionally symlink the entire source tree.
- Before data changes, coordinate any active agent, application and database writers. Never run infrastructure tests on corporate Jira, Confluence or timesheets.
- Create a rollback plan that points to the original (unmodified) Mac data root, original disk image location and Compose files.

## Phase C — Docker Desktop disk image relocation (separate from host bind data)

Official Docker sequence:
1. Use a NEW, EMPTY /Volumes/SSD/SandboxV3/docker-desktop folder.
2. Docker Desktop > Settings > Resources > Advanced > Disk image location.
3. Click Browse, select the dedicated SSD folder, then Apply.
4. If prompted to use an existing disk image or replace one, CANCEL until reconciled; no replacement is authorized.
5. Allow Docker Desktop to complete its own operation. Validate the *same* cloud-sandbox-mcp and cloud-sandbox-dev-main containers, images, ports and persistent filesystem.
6. Preserve rollback and verify via native Mac CLI and connected V3 plugin.

Moving Docker Desktop disk image does **not** migrate the external bind-mounted ~/.cloud-sandbox-mcp-data files by itself. Source: https://docs.docker.com/desktop/troubleshoot-and-support/faqs/macfaqs/

## Phase D — persistent host-data migration (after baseline and downtime agreement)

- Destination for the copy: /Volumes/SSD/SandboxV3/persistent/cloud-sandbox-mcp-data
- Preserve all existing V2/V3 files under original root. Stage copy without destructive flags only to a new, known-empty destination.
- If the Toshiba is not confirmed encrypted, do not mirror confidential
  shared-auth material or private credential stores to the SSD. Move
  non-sensitive large datasets first, retaining credentials on Mac
  until a separate encryption decision has been approved.
- Ensure final sync is made with services paused and mutable databases/nested Docker stopped. Preserve permissions, symlinks and extended attributes.
- Validate file counts, sizes, checksums for mutable state, Git worktrees, browser-automation evidence and app storage. Any conflicting or incomplete file blocks cutover.
- Validate Docker Desktop sharing for external host bind mounts and verify actual run-time source paths point at the SSD.
- Retain the original host data root for rollback, even if the migrated data is used in production.
- No manual deletion of Mac data, previous V2 data, or duplicated files without a separate reviewed cleanup.

## Phase E — startup guard and independent acceptance

Before relying on external storage, record the actual Volume UUID in a private migration receipt. Startup must verify mounted UUID and APFS identity **before** launching the storage-dependent Docker containers; otherwise a disconnected SSD could silently redirect writes to the Mac's internal disk.

Acceptance must independently verify:
- SSD mount UUID, APFS and minimum reserve
- Docker Desktop disk location and Mac bind source paths
- Existing controller and exactly one persistent dev-main workstation
- /workspace/projects, /workspace/_shared, /shared-auth, nested Docker state and relevant credentials
- Existing Git state, workspaces, evidence and cached tooling
- Controller /healthz and Sandbox V3 plugin handshake
- Mac Chrome/Edge Bridge, Cloudflare/Caddy and public HTTPS health
- Disposable test data persistence across a controlled service restart
- Safe failure when SSD is absent, WITHOUT creating empty replacement directories

Roll back by restoring original Docker Desktop disk location **through the UI** and original recorded bind paths, never by deleting or resetting Docker. An SSD disconnect must stop workload rather than initiate an automatic cleanup.

## Confirmed technical boundary as of preflight preparation

Sandbox V3 Linux reported that /workspace and /shared-auth use the same Mac-backed storage, currently **95% used** with around **26 GiB free**. The Toshiba path /Volumes/SSD was **not mounted inside V3 Linux**, which is expected for a Mac external disk absent from existing Docker mounts. Current APFS UUID and current Mac Docker bind source paths must be verified from macOS before cutting over.

No physical migration, Docker Desktop UI action, host bind modification, data deletion, Mac service restart, or V3 container recreation has been performed in this preparation.
