# Bounded trusted macOS delegation — guarded rollout

The single-operator Mac Bridge currently supports 30-minute trusted grants
without a per-action modal. This release caps the *number of actions* to the
operator-requested 1..200 (default 120) while keeping the same noninteractive
trusted notice, allowlist, single-browser scope and immediate revocation.

The source patch and 2-file Mac installer are **not automatically installed**
by modifying this repository. Deployment is a separate, operator-executed
Mac action after the source is committed and tests pass.

1. Build a SHA-pinned shared-auth handoff on Linux with:
   `node deploy/session-budget/build-release.mjs`.
2. On the Mac run the emitted installer path with `--inspect`. It must report
   `SAFE_PREFLIGHT=PASS`. Unknown live source hashes fail closed; no overwrite.
3. When the preflight is valid and no session is active, run `--install`.
   The installer privately backs up both Mac Bridge source files, changes only
   recognized bounded-session patterns, restarts only the Mac Bridge LaunchAgent,
   verifies that the 30-minute/200-action policy is live, and rolls back on
   failed health or policy checks.
4. After successful installation, verify `computer_use_status`,
   `computer_use_session_status`, a task-scoped benign delegated action and
   explicit session revocation. Do not claim GH04/GH05 or any corporate
   business action PASS from a session status alone.

No Docker/workstation/source volume, user Chrome/Edge profile, browser process
or authentication cookies are modified. Preexisting authenticated sites stay
separate across browsers. The existing 20-second closable notice is retained.

Run the older bridge-toast installer only against the appropriate old
release; it was designed for unlimited grants and may not be compatible with
this bounded policy. Source tests prove transformation against the reviewed
baseline, not the unknown installed Mac binary until `--inspect` succeeds.
