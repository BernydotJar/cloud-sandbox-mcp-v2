# Finish macOS nxnative -> Toshiba SSD without deleting originals

Operator state (2026-11-02): the original ~/Games/nxnative and SSD
staging directory both exist as real directories. Python
migrate-switch-smart.py PID 25637 was stopped and terminated;
the original Python implementation automatically deleted the
internal backup after linking it. NEVER re-run that old implementation
to finalize this migration.

The 0-byte initial checksum report is encouraging but its exit
status was not captured, because its parent Python process was
suspended then terminated. This new safe finalizer performs its
own fresh checksum comparison and captures the exit code.

## Mac execution

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/nxnative-ssd-safe-finish-20261102"
    node "$BASE/finish-on-mac.mjs" --finalize

For read-only identity/path/process review:

    node "$BASE/finish-on-mac.mjs" --inspect

The finalizer:
- Pins the actual Toshiba APFS Volume UUID to
  A6268296-0330-4A69-9BE3-059BE8E4016A.
- Requires a mounted writable external Toshiba at /Volumes/SSD.
- Requires exact source and staged directory owned by this Mac
  user, not symlinks.
- Refuses an existing final destination or active nxnative copy process.
- Runs a fresh rsync -rclni --delete with -n DRY RUN to compare
  checksums and detect extra files; no rsync copy occurs.
  Detailed results go into a private 0600 log on the SSD.
- If verification rc != 0 or report has ANY bytes, stop without
  changing original and staging paths.
- If verified, rename prepared SSD staging to
  /Volumes/SSD/MacStorage/Games-nxnative.
- Rename Mac ~/Games/nxnative to timestamped
  ~/Games/nxnative.pre-ssd-migration-YYYYMMDD-HHMMSS.
- Create ~/Games/nxnative symlink pointing at final SSD destination.
- Preserve original timestamped backup until games are validated.
  NO deletion or cleanup.
- On symlink failure, attempt to restore original source path.
- Emit success only on actual link and backup checks.
- Do not touch other SSD folders, Docker, Sandbox V3,
  prod.keys or Nintendo downloads.

Success marker:
    [nxnative finish] COMPLETE=YES
    [nxnative finish] ORIGINAL_BACKUP_DELETE=NO
    [nxnative finish] GAME_LAUNCH_ACCEPTANCE=PENDING

This finishes the nxnative storage path cutover. Game-launch tests
and original backup cleanup need separate approval and evidence.

## Recovery

If the link is broken or a game fails to launch, DO NOT remove
any data on SSD or the original Mac backup. Stop game writers,
inspect source symlink, saved backup and current data changes
before restoring the original. Rollback must preserve writes
made after cutover; never blindly overwrite files.

## Tool boundary

The script was authored and unit-tested inside Sandbox V3 Linux,
which cannot directly mount the Mac's /Volumes/SSD. Its activation
must be run on the operator's Mac Terminal.
