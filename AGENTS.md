## SSD stage r3 (AppleDouble long-filepath recovery, 2026-11-02)

The Mac recovery-r2 stage copied 39.4 GB then returned rsync rc23
for Apple -E xattr synthetic ._* pathnames in the very deep
legacy-barehands llama.cpp archive. Source data remains intact,
not cut over. r3 keeps the existing UUID-gated staging markers,
macOS sudo read for protected archived Git, and uv-cache-only
exclusion; it resumes the bulk Linux/container persistent data
with rsync -aH (no macOS -E AppleDouble emulation), while
the native controller checkout retains -aEH. No generic ._*
exclusion or Git exclusion, no --ignore-existing, no removal
or source permission changes. Correct result remains staging only;
xattr/ACL parity NOT assured and MUST be audited during cold
final sync before swapping Docker mounts or deleting the Mac source.
The r3 private log uses a new filename to avoid false alarms from
past rsync failures. New signed release:
shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-stage-resume-r3-20261102.

## SSD resume stage root permissions correction (2026-11-02)

A successful rsync -a controller stage applied source permissions,
normally 0755, to its new terminal destination. The original
STAGE_DIRECTORY_NOT_PRIVATE check rejected this legitimate state
on the next run. New release sandbox-v3-ssd-stage-resume-r2-20261102
allows modes such as 0755 on only terminal code and persistent data
root directories, with owner and non-symlink verification plus no
group/world write. All parent and staging marker directories remain
owner-only (0700). This is a guard correction only; no broad chmod,
no rm, no reinitialization and no Docker retarget or data deletion.

## Toshiba SSD V3 resumable staging after volatile uv cache and archived Git permission failure

After the first Mac live staging copy returned rsync exit 1, the
private log showed temporary AppleDouble files disappearing from
the exact disposable uv archive cache (under the V3 workstation
home/.cache/uv), and an unreadable Git pack index inside the
archived container-root/legacy-barehands repository. The Mac SSD
still has a partial /Volumes/SSD/Sandbox staging copy and signed
stage marker; original internal data and both Docker bind mounts
remain unchanged.

The signed recovery release is
sandbox-v3-ssd-stage-resume-20261102 under shared-auth deployment
handoff. On the SAME Mac run its stage-on-mac.mjs --stage. It
verifies the original pinned external APFS UUID, original Docker
mounts and owned private stage marker. It excludes ONLY the uv
cache in the live initial copy and runs ONLY persistent-data
rsync under sudo after interactive sudo -v, preserving owner,
group, extended attributes and archived Git history without
editing source permissions. No --delete, no blanket
chmod/chown, no Docker shutdown; unchanged copied files are
skipped in place. The cache can be regenerated.

Staging is NOT cutover or consistency: final cold sync and
integrity checks, Docker Desktop GUI disk image move and volume
UUID-gated mount retarget remain pending. Never remove the
Mac original until independent acceptance. Do not run the
old stage release if it reproduces the same rc=1.

## User accepted unencrypted Toshiba SSD; version-neutral Mac staging (2026-11-01)

The Toshiba APFS external volume /Volumes/SSD is mounted writable,
UUID A6268296-0330-4A69-9BE3-059BE8E4016A. The Mac reconciliation
found Writable=true, mount rw, and user W_OK. Encryption is optional:
the operator explicitly accepts the currently unencrypted disk.
Do not require an encrypted APFS sibling volume or block migration
only because encryption is not enabled; comply with applicable
corporate data policy.

Future stable path is an ordinary directory /Volumes/SSD/Sandbox.
No SandboxV3 path and no /Volumes/Sandbox separate volume.
All future V4/V5 releases reuse /Volumes/SSD/Sandbox and
source/cloud-sandbox-workstation, with persistent/
cloud-sandbox-mcp-data and docker-desktop directories.

The live Mac controller Compose source is
~/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation.
The historical SSD repository under
/Volumes/SSD/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation
has distinct Git HEAD bbe13f9... and is not actively bound by
Docker, but contains untracked/ignored data not reviewed.
Never erase, rename or remove it as part of migration.

Prepared signed Mac stage script under scripts/ssd-migration/
stage-on-mac.mjs. Its --inspect is read-only; --stage performs a
non-destructive, non-authoritative live copy to the new folder
with no --delete and no Mac container restart. It does not move
Docker.raw or switch mounts. A cold final sync, integrity
verification, Docker GUI image move, explicit mounts retarget,
Volume UUID startup guard and complete acceptance are still
mandatory before calling the migration complete.
The original Mac data remains intact until a separate
cleanup authorization. Earlier encrypted-volume proposals
are SUPERSEDED by this explicit user decision.

## Toshiba SSD v2 preflight: do not delete versioned legacy checkout (2026-11-01)

The Mac's actual SSD preflight showed external /Volumes/SSD,
UUID A6268296-0330-4A69-9BE3-059BE8E4016A, 1663.56 GiB free,
unencrypted. The v1 readWrite=false might be a missing diskutil
property misclassified as read-only: this is being checked by a new
read-only diagnostic, NOT by a write to the user's SSD.

The historical /Volumes/SSD/Development/Workspaces/
cloud-sandbox-mcp-v0.2.0-workstation is DIFFERENT from the currently
active controller Compose working directory under the INTERNAL Mac
~/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation.
Both must be preserved until paths, Git worktree state, content
differences, active references and backups are reconciled.
Never delete or rename either folder automatically.

Use stable future names (no V3/V4 in persistent paths):
new encrypted APFS sibling volume /Volumes/Sandbox on the same
Toshiba APFS container, and source/cloud-sandbox-workstation/
as controller checkout. Existing unencrypted SSD data remains intact.
Adding this APFS volume must be a separately reviewed user action;
do not run any diskutil mutation, use Disk Utility 'Erase',
or move Docker.raw manually.

A Mac read-only legacy reconciliation kit and revised runbook are
at scripts/ssd-migration/ and shared-auth handoff
sandbox-v3-ssd-reconcile-20261101. The original
/Volumes/SSD/SandboxV3 target is superseded and must not be used
for sensitive credentials. Startup later requires verifying the
new encrypted volume's own UUID; mount failures block workloads
rather than creating empty source folders.

## External APFS Toshiba SSD storage migration preparation (2026-11-01)

User has reconnected existing Toshiba 2 TB APFS SSD previously mounted
at /Volumes/SSD (~1.6 TB available). This disk already has Downloads,
Documents, Sandbox V2 artifacts and other working files; DO NOT
erase, repartition, delete, move or overwrite any of that data. Separate
Mac storage work can use /Volumes/SSD/MacStorage and must remain
untouched. Target proposed dedicated /Volumes/SSD/SandboxV3/ only
after a read-only Mac inventory confirms no collision.

Live Sandbox V3 Linux confirmed /workspace and /shared-auth are
Mac-backed (about 26 GiB internal free / 95% used). The Toshiba SSD
is NOT mounted inside this Linux namespace. The nested Docker daemon
inside dev-main is NOT Docker Desktop on the Mac; do not use nested
docker inspect to infer Mac container mounts or manipulate Docker.raw.

Prepared operator preflight:
  scripts/ssd-migration/preflight-on-mac.mjs --inspect
and complete staged rollback plan:
  scripts/ssd-migration/RUNBOOK.md
Mac handoff:
  ~/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/
  cloud-sandbox-computer-use/sandbox-v3-ssd-migration-20261101/

The preflight must verify external APFS, UUID, mount, free capacity,
current Docker container bind mount paths, host data root, and target
collision. It writes only a sanitized small report to shared-auth.
No migration, copying, Docker settings or Mac launchd changes
are authorized by merely preparing this code.

Docker Desktop disk image should be relocated ONLY from
Docker Desktop > Settings > Resources > Advanced > Disk image location,
never by moving Docker.raw manually. Host bind data
(~/.cloud-sandbox-mcp-data) is a second separately verified move.
After any cutover, safeguard startup against a missing/mismatched
external Volume UUID; keep all original paths/data for rollback.
Preferred controller remains Sandbox V3 with one dev-main container,
existing Bridge, Cloudflare, Caddy, macOS Keychain and original user
browsers, all on the SAME Mac.

## Handoff / reliability boundary — 2026-10-29 20:29 UTC

Read docs/computer-use-v2/TEAMS_BACKEND_TECHNICAL_HANDOFF_20261029.txt before
continuing. A real background Toyota workflow passed; later idle inspections
returned DOM_TIMEOUT_INSPECT while the broker stayed connected. Reliability
remains PARTIAL. Freezing is suspected, not confirmed by a fresh lifecycle flag.
Wake recovery is UNINSTALLED WIP preserved outside the deliverable source.
The user prefers a solution without an extension and requested a technical
handoff. Do not claim the original cloud agent independently tested this route.

## Verified per-tab Teams DOM backend — 2026-10-29

The extension_dom provider is installed in the approved Toyota Work11 Edge
profile. Read docs/computer-use-v2/TEAMS_DOM_BACKEND_20261029.md. Live Sandbox V3
tools passed own-chat marker fill, reload persistence, clear and empty reload
while the Teams tab stayed inactive and Docker stayed foreground. Calendar/Chat
navigation also passed with the final 0.1.1 payload. CKEditor requires its model API; a generic
DOM editing command was accepted but discarded. Other apps/editors are unverified.
Do not repeat the native AX setter success claim: real Teams can accept a
setter without changing its composer. No native input fallback from DOM error.
When actually installed and observed, use the existing browser tools with fresh
opaque refs/revisions and the own grant; never invent native window indices.
Verify account, recipient and persistence; preserve existing drafts and no-send
scope. New extension access requires operator review before profile loading.

## Verified background browser capability — 2026-10-29

For an explicitly requested existing Mac browser task with background required,
the current installed Sandbox V3 bridge can return an optional
`tabs[].background_ax.tab_ref` from `browser_tabs`. Select that explicit ref
with `browser_inspect` and `browser_action`; do not call foreground native
focus/screenshot/coordinate actions. `semantic_available=false` means no
DOM/ARIA. `ax_semantic_available=true` with `inspection_mode=native_ax`
is the distinct real AX provider; do not declare the whole interaction layer
unavailable merely because CDP/ARIA is absent.

Only use this route when the reference is actually present, the target app
remains behind another app, and the task permits the observed action. Own
browser grant, current revision, exact control, origin policy, independent
effect readback and grant closure remain required. Native AXPress handles
navigation; certified composer nodes advertise `fill_backend=process_unicode`
for exact-PID text entry into an empty field or fingerprint-bound clear.
Nonempty replacement is rejected. It does not use global input or an isolated
desktop; it refuses actions if the target becomes foreground. Never replay
uncertain mutations. A title change requires fresh discovery.

This path passed a live Sandbox V3 self-chat smoke: Search write/clear,
Calendar/Chat navigation, full composer marker fingerprint and verified cleanup,
foreground preserved, no sends or existing draft changes. This does not
establish universal app/control compatibility. Operative runbook:
`/workspace/projects/cloud-sandbox-mcp-v2/docs/computer-use-v2/BACKGROUND_BROWSER_AX_20261029.md`.
Ordinary unauthenticated QA still defaults to isolated headless Playwright.

## Sandbox V3 now supervises existing Mac Browser Bridge (2026-10-28)

The canonical Mac \`sandbox\` command must check and recover the existing
\`gui/$UID/com.lch.cloud-sandbox.computer-use\` LaunchAgent in addition
to Docker and Cloudflare. Running Bridge services are NEVER force
restarted: do not revoke other agents' delegated sessions or disrupt
Chrome/Edge. Stopped launchd service may be started with non-force
\`kickstart\`; unloaded services only bootstrap an existing verified
user-owned plist with exact installed helper path. No browser profile
restart, simulated keystrokes, Remote Debugging change or Caddy change.

\`sandbox status\` is read-only, showing distinct Bridge LaunchAgent,
protected listener and Chrome CDP (external V3 tool) states. A 401/403
from 9764 does not prove CDP attachment; use
\`mcp__Sandbox_V3__browser_runtime_status\` and
\`mcp__Sandbox_V3__browser_tabs({browser:"chrome"})\` for that.
The user Mac CLI must be upgraded from the hash-pinned handoff before
claiming this supervisor is installed.

## Sandbox V3 terminal health dashboard (2026-10-27)

\`sandbox status\` on the Mac provides a read-only, state-backed
retro dashboard for Docker, controller, dev-main, MCP /healthz,
existing Cloudflare launchd, public HTTPS /health routes at
lch-app.cloud and ido.lch-app.cloud, and local Mac Browser Bridge
listener. Each row has a face: 😎 healthy, 👾 failed, 🥸 warning,
🕵️ external check not possible from Mac. \`status --json\` provides
structured machine-readable results; \`status --plain\` remains
script-friendly. For an interactive terminal the statuses are
colorful; non-TTY/NO_COLOR/NO_EMOJI are handled safely.

HTTPS checks MUST require an actual HTTP 200 with valid TLS and
no redirects; do not mark public network health PASS merely because
Cloudflare launchd is running. A token-free Browser Bridge 401/403
only proves a protected listener exists, not full AX/browser
functionality. ChatGPT V3 connector health remains a separate
external plugin check. Any core or public HTTPS failure should
be presented as a failure, without restarting unrelated services.
The Mac's installed CLI is updated through the release's guarded
\`--upgrade\`; do not claim it has been applied until verified on Mac.

## Sandbox V3 CLI also supervises existing Cloudflare Tunnel (2026-10-27)

The canonical Mac `sandbox` command now checks the pre-existing
Cloudflare `cloud-sandbox-mac` tunnel via the verified system launchd
label `system/com.cloud-sandbox.cloudflared`, with only the known
`system/com.cloudflare.cloudflared` alternative. Reuse a running
service without changes; when stopped, non-force kickstart only this
known label, or bootstrap only its verified pre-existing root-owned
plist. Never create another Cloudflare tunnel, DNS route, token, or
ngrok bridge. Privilege is requested only when system launchd requires
it. `sandbox status` and `sandbox doctor` are observational. A running
launchd process is not proof of Internet tunnel connectivity. Keep
Cloudflare config, Caddy, Browser Bridge, Mac AX and Docker data intact.

## Mac Sandbox V3 CLI symlink fix and retro splash (2026-10-27)

The Mac sandbox launcher is a symlink into
~/.local/share/sandbox-v3/cli.mjs. Its initial entrypoint exited
silently because the unresolved symlink argv path differed from
the resolved ESM filename. Fixed with fs.realpathSync. The CLI
now prints 1980s Cosmic Cats by default, with optional Jupiter;
switch via sandbox theme cats or sandbox theme jupiter.

For Mac operators with V3 already activated, use the guarded
scripts/sandbox-v3-cli/install-on-mac.mjs --upgrade from the
shared release, NOT a second --activate. The upgrader preserves
the original pre-V3 backup and a copy of the previous V3 binary.
It must not recreate Docker workspaces or touch Chrome/Edge/CDP.
Do not claim the Mac CLI is fixed until the on-Mac --upgrade
has been executed and validated.

## Canonical Sandbox V3 connector and Terminal command (2026-10-27)

Operator default: use the **Sandbox V3** ChatGPT connector
\`mcp__Sandbox_V3__*\`, not \`mcp__Cloud_Sandbox_MCP_V2__*\`.
The old V2 ngrok endpoint failed an HTTP 403 live check on 2026-10-27.
The historical repo checkout path \`cloud-sandbox-mcp-v2\` is not
the product or ChatGPT connector selection.

The Mac operator's default Terminal command must be \`sandbox\`.
Its V3 launcher is under \`scripts/sandbox-v3-cli/\`; a guarded,
reversible install release is staged in the existing shared-auth
handoff. The CLI starts ONLY existing \`cloud-sandbox-mcp\` and
\`cloud-sandbox-dev-main\`; no legacy root \`start-all.sh\`,
ngrok/multiple UUID workstations, Docker prune, re-authentication,
browser profile changes or runtime recreation.

Agent defaults:
- First choose the Sandbox V3 tool namespace for all engineering work.
- Preserve root, Docker, persistent worktrees, existing Mac Bridge
  and the current delegated sessions.
- Legacy V2 connector is explicit compatibility only, never
  a silent fallback from V3 failure.
- The Mac CLI migration is staged source until the on-Mac
  \`install-on-mac.mjs --activate\` command completes. Do not claim
  the Mac Terminal command has changed merely because code was committed.
- A healthy local controller still requires the remote V3 plugin
  to pass an independent live handshake.

## P0 architecture correction: native background CUA on THIS SAME MAC (2026-10-26)

The operator rejected any VM, second Mac or external APFS volume for the
background native Computer Use requirement. Those alternatives must NOT
be presented as a prerequisite. Use the same-Mac native AX source under
mac-host/same-mac-ax and the authoritative handoff at
docs/computer-use-v2/SAME_MAC_BACKGROUND_AX_P0_20261026.md.
Interact with non-frontmost macOS apps via role/name/revision AX APIs,
never blind Tab/Arrow/Enter, OS keyboard events, mouse clicks, or
app activation when background_required=true. AXPress remains
app-specific and requires a real disposable noninterference test.
Do not mark this live without native Mac compilation, AX consent, and
foreground-preserving fixture E2E. Preserve root/Docker/shared storage
and existing browser sessions.

# Agent operating protocol

When using this MCP server:

1. Create or resume one workspace per task.
2. Inspect `workspace_status`, repository instructions, and current diffs before editing.
3. Prefer `file_apply_patch` or `file_write` with `expected_sha256` for controlled edits.
4. Use `workspace_exec` for repository inspection and development commands, including Docker and privileged workstation operations when task-appropriate; use the dedicated audited Git push tool rather than a shell push.
5. Run `project_verify` and inspect failures before claiming completion.
6. Review `git_diff`, then create a local commit.
7. Use `git_push` only after explicit authorization and only when enabled by the operator.
8. Report commands, exit codes, changed files, tests, assumptions, and remaining risks.

## Current Mac AX/VM diagnosis (2026-10-26)

The operator Mac validated Akira native Liquid Glass in preview. Its
AXBrowserHelper.swift subsequently failed a Swift typecheck on specific
syntax issues, which are corrected in source and staged release; do not
claim a Mac typecheck PASS until the updated package is compiled on Mac.
The Mac is Apple Silicon with working hypervisor and 24 GiB RAM, but
had only 16.81 GiB HOME storage free. Do not install Tart, create a
macOS VM or delete data to get around the 80-GiB project VM capacity
gate. Use the read-only preflight to assess external APFS storage or
an existing second Mac. Do not enable browser Remote Debugging.

## Isolated native Mac CUA (source candidate, 2026-10-26)

The independent macOS GUI worker source resides in
\`mac-host/isolated-desktop/\`; see its README and
\`docs/computer-use-v2/BACKGROUND_EXECUTION.md\`.
It provides a separate-machine native AX worker, guest-only screenshot,
per-request receipt ledger and optional MCP controller tools.
The installed Mac Bridge still controls the operator's shared desktop;
NEVER use browser native CUA as an invisible background fallback.
Until the independent GUI worker is installed and its live acceptance
passes, return \`BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED\`.
No blind Tab/Arrow/Enter discovery, no debugger/profile changes,
and no real corporate timesheet modification for pilot acceptance.

## Operator policy — native Mac splash, no debugging, privileged workstation (2026-10-26)

The existing Akira splash is a **real AppKit macOS screen overlay** at
`deploy/bridge-toast/bridge-toast.swift`; it is not a website. A colorful
laboratory-burst design and read-only alert panel are staged in source and
must not be described as installed on Mac without macOS compile and visual QA.
Do not steal focus or change the 5-second nonmodal connection notification.
An alert panel has a real local `Ver registros` action, but a dismiss click
does **not** revoke a delegated session.

The operator refuses to enable Remote Debugging. Do not activate inspect
pages, debugging flags, new ports, dedicated debugging profiles, or restart
Chrome/Edge to repair CDP. Mac browser automation is native-first; reuse a
previously functioning persistent provider without altering it when available.
Use isolated Playwright for ordinary QA. The 12 October pilot handoff is
historical, not the 26 October browser health state.

`workspace_exec` provides privileged Linux workstation execution with
Docker and persistent shared storage intentionally retained. **It is not
Terminal.app on the Mac.** Native Terminal CUA and a separately audited macOS
host command executor remain a P0 feature, not a presently exposed MCP tool.
See `docs/computer-use-v2/MAC_NATIVE_TERMINAL_P0.md`.

## Playwright-first web automation (all projects)

9. For ALL ordinary web UI work (site navigation, forms, product UI, browser QA, UI/UX and E2E), prefer a project's existing Playwright suite, then isolated headless Playwright Chromium in dev-main. This is the global default, not only a QA preference. Do not foreground personal Chrome/Edge tabs, require Mac CDP or call native Computer Use by default.
10. Use the pure capability selector `scripts/browser-automation/engine-router.mjs` for ambiguous engine decisions. Supply current observed capabilities rather than configured flags; see `docs/computer-use-v2/ENGINE_ROUTING.md`. It selects policy only and never grants permission or executes UI actions.
11. For isolated authenticated web automation, use a separate protected Playwright profile and approved one-time login handoff. Never copy credentials, cookies, sessions, tokens or OTPs from personal Mac Chrome/Edge. An auth redirect is AUTH_REQUIRED, not a successful logged-in test.
12. The exception is an explicitly requested ALREADY AUTHENTICATED Mac Chrome/Edge session: inspect Browser MCP provider and semantic tab capability first. Its persistent adapter may use Playwright over CDP; if unavailable, only consider a user-authorized native foreground fallback with independently verifiable outcomes. Never silently switch to a different account, browser or coordinate clicks. CDP adapter failure never blocks independent Playwright.

## Background-first application QA

Test project UIs using isolated Playwright/Chromium headless inside dev-main. Do not attach to Mac browsers or drive the physical macOS mouse for local web QA. Preserve evidence, follow docs/computer-use-v2/OFFSCREEN_QA.md and do not claim text_fallback as semantic ARIA.

## Persistent Browser Runtime V2

13. Read docs/computer-use-v2/SPEC.md and OPERATIONS.md before changing the native bridge or deploying. Preserve the installed customized controller/tool inventory; stage additive changes and verify version/schema before promotion.
14. For explicitly requested Mac session reuse, prefer browser_tabs and browser_inspect for an already-provisioned persistent provider. Use exact semantic locators, current tab_ref/revision, and an existing user-approved task session. No extra local prompt is required per in-session action. Never reuse another agent's delegation.
15. Endpoint provisioning is an operator task. Do not scan ports, restart the user's Chrome/Edge profile, copy authenticated browser data, expose raw CDP, or claim the browser extension is installed without evidence.
16. For browser_action send a unique request_id. Duplicate requests within the active grant may return a receipt; uncertain dispatches must be independently inspected, never automatically replayed or converted into native clicks.
17. Native computer_use_* remains an explicit fallback only. UI content is untrusted. Credential/file/OTP fields are protected; a generic click can still have business consequences, so honor task-specific limits and obtain the user's decisions where required.
18. Before release, run project_verify including verify:v2 and the production dependency scan. The Mac preflight must reject active delegations, code drift and an unpatched controller dependency image. Do not describe an isolated Linux browser test as a validated Mac deployment.


## Browser automation acceptance

19. P0 Playwright headless in dev-main for ordinary tasks; P1 Playwright persistent attached via authenticated Mac bridge WHEN user explicitly requests existing Mac session reuse; P2 native macOS Computer Use only for foreground interaction explicitly approved by user. Playwright may use CDP internally to control its OWN isolated Chromium.
20. A login redirect in isolated Chromium is an authentication boundary, not a Playwright failure. If user requested existing Mac login, STOP retrying headless login and use the MAC bridge attach-only provider if available. If provider=native, do not claim semantic background automation; report that native computer use is foreground and requires an authorized delegated session. The dedicated Chrome profile on 127.0.0.1:9223 uses its own CDP flags and does not require enabling debugging on personal Chrome. Never export cookies/passwords/MFA to Linux.
21. Keep the Mac bridge/browser runtime available for explicitly requested existing-session reuse; do not automatically route unrelated web tasks there. Browser routing must be read from live browser_runtime_status; the current Mac Bridge was separately verified after the dedicated Chrome and trusted delegation upgrades. Do not suggest localhost:9222 inside dev-main as a Mac endpoint. A Mac-side configuration/consent operation must be separately deployed and verified to change that state.

## Dedicated authenticated browser on demand

For user-authorized authenticated web automation, prefer the dedicated
Chrome profile when it has been explicitly provisioned. Mac Bridge
auto-starts that browser on `browser_tabs(chrome)` only after operator
`COMPUTER_USE_DEDICATED_CHROME_AUTO_START=true` opt-in and exact local
CDP endpoint assignment. Do not launch or profile the user's personal Chrome,
expose 9223 to Docker, copy cookies or substitute native coordinate clicks
when dedicated CDP attach fails. Keep Chessy-style Playwright headless as the
default for QA. For deployment and rollback, use
`deploy/dedicated-chrome/README.md` and its guarded installer. Verify the
returned provider is persistent and inspect the post-action state.

## macOS browser connection UX

If the optional Bridge Glass Toast is enabled, it confirms a successful
dedicated Chrome CDP attach exactly once per Bridge process without taking
focus or altering the application. Do not generate persistent "connected"
warnings or inject status decorations into customer web pages. Preserve
browser-native security indicators and all real failure messages. See
deploy/bridge-toast/README.md.

## Akira Bridge splash

For the dedicated authenticated Chrome browser, the optional connection UX is
a **5-second** top-right native glass splash with the original Akira mascot. Show it once on successful
persistent CDP discovery; do not present blocking connection notices or
persistent status warnings in agent-owned UI. Do not conceal Chrome-native
security indicators, OS permission dialogs, or actionable errors. See
`deploy/bridge-toast/README.md`; do not repeatedly invoke the toast or
interrupt the browser.

## Bridge-only Edu! delegated session notice

For a Mac workstation whose operator explicitly opted in to
`COMPUTER_USE_TRUSTED_SESSION_NOTICE=true`, start every authorized
native browser workflow using a scoped `computer_use_session_begin`
(max 30 minutes, up to 200 actions per grant, one browser at a time). The Bridge issues
a bounded allowlisted capability and displays a top-right **Edu!** notice
for **20 seconds** with a dismiss button. This does **not** require CDP;
do not open Chrome or change browser profiles merely for the notice.
Always pass the `session_id` to delegated actions and revoke it when work
finishes. The close button only hides the notification; it does not end
the session. An operator who has not enabled this mode retains normal
approval prompts. Never bypass native OS permission prompts or write
outside the configured HTTPS allowlist.

## Terminal `sandbox` and cross-agent reinforcement

Read `docs/computer-use-v2/TERMINAL_SANDBOX_CONTRACT.md` before asserting
that a Mac Terminal `sandbox` or `sandbox -c` session inherits ChatGPT's
Mac Bridge configuration. The **installed host Bridge**, not the shell
command or model, owns the trusted delegation policy: operator opt-in,
30-minute maximum, finite 1..200 action grant, 20-second closable Edu notice,
HTTPS mutation allowlist and audit. Any tool client connected to the same
Bridge shares that policy, but session grants are task-scoped and may not
be shared across agents.

Check `computer_use_status` read-only at the start of a task that needs
authenticated Mac browser access. The tool's published schema may still
accept/restrict `max_actions` (1..200); pass an allowed value for
compatibility. The source hardening revision enforces the requested counter also in trusted mode, and reports `unlimited_actions=false` with a finite `remaining_actions`. Verify the installed Mac Bridge version; older deployments still report unlimited grants.
Do not alter a running Chrome/Edge session or restart the Bridge to refresh
help text. Do not assume the Mac `sandbox` shell definition exists in this
Linux workspace; its actual alias/function/executable must be checked on Mac.

## Authenticated LCH cloud properties

When the operator has successfully activated the LCH wildcard release,
the Bridge may authorize actions on https://lch-app.cloud and any valid
HTTPS subdomain of *.lch-app.cloud, including LUMA and Meridian, for
**both** Chrome and Edge. Never infer authorization from a repository
change alone: check the live computer_use_status flag
host.lch_app_cloud_wildcard_enabled===true first.
The wildcard is label-boundary checked; it never covers unrelated suffixes,
HTTP or unknown nondefault ports. Existing exact-origin entries (including
https://www.linkedin.com) remain separate. Consult
deploy/allowed-origins/README.md for the audited Mac installation and
rollback, and continue to use Graph Harness, task-scoped grants and
business-level verification for actual app actions.

## Optional capability: ArtCraft creative-production tools

ArtCraft (`https://getartcraft.com/apps`) is an **optional, on-demand** tool family
for PDFs, images, UI design, video, presentations, and other creative artifacts.
Treat each application and its automation interface independently; a website
listing is not proof that a CLI, MCP server, or headless feature works.

### Verified baseline and discovery

- The canonical Linux ARM64 workstation previously passed PdfCraft CLI v0.10.1
  smoke tests for `info`, `text`, and PDF-page `render`.
- Its versioned installation is
  `/workspace/.local/opt/artcraft/pdfcraft-cli/0.10.1`, with entry point
  `/workspace/.local/bin/pdfcraft-cli`. Check that the executable is available
  **in the active workstation** before using it; installations are not assumed
  to exist in other containers, runtimes, or developer machines.
- PhotoCraft, FigCraft, FilmCraft, VectorCraft, DeckCraft, and other ArtCraft
  applications are **candidates**, not installed or validated capabilities.
  Do not claim that they are operational or register nonexistent tools.
- Prefer an existing documented native CLI/API over simulated GUI interaction
  when it meets the task requirements. Use browser automation only for actual
  UI flows and their reproducible QA.

### PdfCraft CLI quick start

Run in `workspace_exec` after confirming that the active workspace has the binary:

```bash
set -eu
PDFCRAFT=/workspace/.local/bin/pdfcraft-cli
test -x "$PDFCRAFT" || { echo "PDFCRAFT_UNAVAILABLE"; exit 2; }
"$PDFCRAFT" --help
"$PDFCRAFT" info "/path/to/input.pdf"
"$PDFCRAFT" text "/path/to/input.pdf"
"$PDFCRAFT" render "/path/to/input.pdf" --page 1 --dpi 96 --out "/path/to/artifacts/page-1.png"
```

Other documented commands include `check`, `audit`, `combine`, `extract`,
`split`, and `batch`. Inspect `--help` and tool-specific schemas before
running edits or destructive transformations. Always write results to a
separate output path and preserve originals unless the task explicitly
authorizes replacement.

### Agent and MCP access controls

- PdfCraft exposes an opt-in stdio MCP mode, **not** an already-registered
  Cloud Sandbox MCP tool. Configure the client-side MCP registration and
  validate tool discovery before claiming the integration is enabled.
- Scope every MCP server to an approved project input directory and a
  dedicated output directory. Example command for an MCP client launch
  (substitute an actual registered project path and create the output directory):

```bash
/workspace/.local/bin/pdfcraft-cli mcp --compact \
  --automation-read-root "/workspace/projects/PROJECT" \
  --automation-write-root "/workspace/projects/PROJECT/artifacts/artcraft"
```

- Do not grant entire host-home, browser-profile, credentials, or shared-auth
  paths to a creative tool. Respect project boundaries, symlinks, and the
  user's authorization for private or third-party assets.
- Do not auto-install the entire suite. For a new ArtCraft application,
  verify architecture, exact upstream release, checksum/signature when
  available, license, disk footprint, dependency requirements, and native
  automation support. Install versioned and reversibly, without changing the
  Mac host or unrelated containers.
- Never upload private project files to external services as a fallback
  without authorization. Use the workstation-local operation when possible.

### QA, evidence, and release gating

- Record application/version, inputs, output filenames, executed commands,
  exit codes, and reproducible steps in the task evidence.
- For PDFs, verify output structure and render representative pages; for
  images, videos, slides, and UI designs, add suitable visual and functional
  checks rather than treating process exit 0 as acceptance.
- Keep generated artifacts in project-controlled output directories and
  exclude bulky temporary data from commits unless requested.
- Feed artifacts and checks into the project's Graph Harness acceptance
  workflow where available; never equate successful generation with product
  release approval. Production publishing remains separately authorized.
- If the CLI, MCP registration, or an application feature is unavailable,
  report the specific gap and use an approved alternative rather than
  silently claiming ArtCraft success.

### Live workstation PdfCraft MCP registration

On the canonical Linux workstation, PdfCraft MCP is registered to Claude Code
as `artcraft-pdfcraft` at **user** scope. Its stdio launcher is
`/workspace/.local/bin/pdfcraft-mcp`, sourced from
`scripts/artcraft/pdfcraft-mcp.sh`. It selects the current repository under
`/workspace/projects/<project>` automatically and refuses startup outside
an approved project context. Only `<project>/artifacts/artcraft` is writable.

Before claiming readiness, run
`cd /workspace/projects/cloud-sandbox-mcp-v2 && /home/agent/.local/bin/claude mcp list`
and `node scripts/artcraft/smoke.mjs`. Claude Code registration does not
automatically register a first-class PdfCraft tool in the ChatGPT-side
Cloud Sandbox MCP catalog or configure any other CLI client. See
`docs/artcraft/README.md` for installation, scope, repeatable tests and
recovery.

## UiPath / Atlassian cloud browser origins

The intended Mac Bridge action policy additionally contains the HTTPS
apex and dot-bounded tenant wildcards for cloud.uipath.com and atlassian.net.
These are approved in the source policy but are only active after an
operator-run Mac allowlist release with live health confirmation. Their
scope applies to both Edge and Chrome, preserving browser-scoped delegated
sessions, auditing and domain-boundary checks. Do not assume the rules
are installed from documentation or code alone.

## LinkedIn browser scope

The intended Mac Bridge policy includes both https://www.linkedin.com and https://*.linkedin.com on Chrome and Edge, after the Mac installer reports success.

## Multi-engine routing: CDP is not Playwright

Read /workspace/projects/cloud-sandbox-mcp-v2/docs/computer-use-v2/ENGINE_ROUTING.md
before operating Chrome, Edge, Playwright or macOS Computer Use.
The *isolated Playwright QA engine* does not require CDP or an authenticated
operator browser. The *Browser MCP persistent adapter* currently uses
playwright-core over CDP for Chrome/Edge; an Edge attach failure does NOT
imply Playwright QA is broken.

For an authenticated live web edit, inspect browser_runtime_status and
browser_tabs. Use semantic Browser MCP only when provider=persistent,
semantic_available=true and a valid tab_ref exist. If provider=native
and semantic_available=false, native Mac UI is a limited foreground
fallback requiring authorized task scope, screenshot and independent
value-persistence verification. Coordinate clicks are last resort.
Do not transfer personal session cookies to a newly launched browser.
The installed Mac tools currently support Chrome/Edge browser control,
NOT general Finder/Terminal/VS Code accessibility trees or window control.

Keep login/auth, browser transport, allowlisted origin, actual row/column
cell writes, persisted read-back and Graph Harness GH04/GH05 evidence
distinct. Never infer GO from a connected browser; gates require explicit
definitions and separately verifiable acceptance results.

## Native browser drift control (Chrome and Edge)

For an explicitly requested authenticated Mac browser profile, use the
actual browser (Edge stays Edge; never suggest switching an account to
Chrome). The JXA browser window/tab index is an ephemeral discovery hint,
not persistent identity. Read
`docs/computer-use-v2/EDGE_NATIVE_STABILITY.md` before diagnosing
`STALE_URL`, `STALE_TAB` or transient dropdowns. The updated native
driver can safely recover a uniquely matching exact title+URL and avoids
unnecessary reactivation while capturing already-foreground dropdowns,
but this remains **source code** until Mac operator deployment succeeds.
Do not claim semantic Playwright/ARIA for a native fallback. Do not
duplicate a UI mutation on uncertain results; re-inspect actual persisted
business state. Do not touch unrelated browser profiles or active agent grants.


## Browser Automation enforcement gates (all agents)

22. For any browser-driven project, use the selection contract at
`scripts/browser-automation/engine-router.mjs` and documented runtime
capabilities before executing. Default isolated Playwright unless the user
expressly requested an existing authenticated Mac Chrome/Edge profile.
23. A CDP failure does not block native **read-only** tab discovery or
screenshots on that exact browser profile. Native visual navigation requires
task-scoped approval; a native click is not a semantic Playwright assertion.
Do not transfer Edge profiles to Chrome or claim a generic UI tooltip
identifies a persisted business cell.
24. Run `npm run test:browser:policy` when changing any routing, native
browser driver, evidence acceptance or installer code; the same gate runs
in `npm run verify` and GitHub Actions. Native driver release must
also compile on macOS and be verified after installation.
25. For business writes, call the acceptance contract at
`scripts/browser-automation/acceptance-gate.mjs` with actual content-
addressed artifacts. Require before and after observations, authorization,
action audit and separate post-reload persisted readback. A structural
`EVIDENCE_COMPLETE` is NOT Graph Harness acceptance or production GO.
Never blindly retry an uncertain UI mutation or bypass domain policy,
approval or cross-agent session isolation.
26. Real Mac release still requires an operator-installed, hash-pinned
driver and real Chrome/Edge smoke. Source tests and an installer package
do not establish live deployment. Full acceptance:
`docs/computer-use-v2/BROWSER_AUTOMATION_ENFORCEMENT.md`.


## Agent behavioral reinforcement (mandatory preflight)

27. Every agent must consult
`docs/computer-use-v2/AGENT_REINFORCEMENT.md` before choosing a browser
execution engine for ambiguous or authenticated work. Declare the task,
actual runtime capabilities and proposed operation; pipe a sanitized JSON
plan to `npm run -s browser:agent-preflight`. A BLOCKED verdict stops
that operation. The preflight never grants permission itself.
28. Before reporting UI/UX or product acceptance, use the actual evidence
gate and project Graph Harness. An authenticated Edge screenshot can
support DIAGNOSIS but cannot prove semantic E2E; Save without confirmed
persisted readback cannot be PASS.
29. When browser agents repeat a mistake, add a redacted critical scenario
to `docs/computer-use-v2/evals/agent-behavior-v1.json` and a regression
test first. Repair the decision boundary, then run
`npm run test:browser:reinforcement` (100% critical cases required).
Do not 'fix' failures by deleting negative tests or relaxing expected
authorization/target/persistence checks.
30. The shared Claude and Gemini guides explicitly load
`/workspace/AGENTS.md`; Codex-style agents must likewise read that file
and the project-specific rules; do not clone separate competing policies.
An agent that cannot access the shared rules must explicitly say so
before using authenticated native browser automation.


## Native Browser Targeting parity (Mac AX / Retina)

31. For screenshot-originated native clicks, use screenshot geometry
`coordinate_contract=mac-screen-points.v1` and a fresh
`screenshot_ref` with `coordinate_space=screenshot_pixels`.
Raw `x,y` in a screenshot are PIXELS, while macOS native click defaults
to GLOBAL SCREEN POINTS. Never treat performed=true as control activated.
32. On an operator-compiled and verified native AX bridge, request
`computer_use_screenshot(include_ax=true)` and select by unique opaque
`ax_node_ref` plus `ax_revision`; only `ax_press` or `ax_set_value`
with the existing task grant may mutate. A missing/unavailable AX tree
must not be simulated with coordinates, stale paths or a Chrome profile
substitution. The AX helper is a distinct provider, not CDP/Playwright.
33. Source-only changes are not Mac deployment. Before live use read
`docs/computer-use-v2/NATIVE_AX_TARGETING.md` and the operator handoff,
verify actual installed package, protected enterprise sessions and
independent benign Mac acceptance. Preserve the 29-tool customized
controller and concurrent Edge doctor WIP.


## Required background execution isolation

34. When the operator requires nonintrusive work, set
`task.background_required=true` and read
`docs/computer-use-v2/BACKGROUND_EXECUTION.md` before selecting a tool.
Default mode is isolated headless Playwright, not foreground browser CUA.
35. Never use `computer_use_focus`, native screenshot (which can focus a
window), native AX click, System Events global keyboard or coordinate
navigation under a background-only task. The updated MCP schema defaults
native target actions to `background_required=true` and rejects them.
Only a separately approved foreground task may explicitly set false.
36. The CUA `getAXState` handoff provides control identity, not background
GUI isolation. Background Desktop CUA needs a separate macOS GUI session
with independent pointer and input; a missing worker blocks the task,
without falling back to global keystrokes.
37. Mac Terminal **GUI** CUA and headless Mac host command execution are
different backends. A command intended for macOS must not be sent to the
Linux workspace as if it ran on Mac. Use only a verified, scoped, audited
Mac host command runner if available. Never invent one.
38. For a current authenticated Mac browser only an explicitly approved
`background_mode=focus_preserving` and verified persistent semantic
provider may proceed without physical mouse or keyboard events; existing
tab contents are NOT independent of the operator. Block a native fallback.
39. Follow BKG01-BKG09 acceptance gates. Source tests and an agent
process running unattended are not proof that a Mac desktop is independent.

## Self-service Mac Bridge domain authorization (Sandbox V3)

For new authenticated HTTPS application domains, use the **Mac operator's
general-purpose exact-origin CLI**, not a new code patch and deployment
for every site. Contract:
    /workspace/projects/cloud-sandbox-mcp-v2/deploy/allowed-origins/README.md

One-time setup on macOS Terminal:
    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/allowed-origins/manage-on-mac.mjs" install-cli

Then the operator can run sandbox-origins add https://TARGET, check,
list, or remove. The user must invoke mutations from their authorized
Mac Terminal; this is NOT an agent-controlled bypass of the origin gate.
Only exact HTTPS public DNS origins are approved, with no arbitrary
wildcards, ports, query-based grants or browser profile changes.
The command preserves previous origins, makes a private backup,
checks for active delegated sessions, reloads only the Mac Bridge
LaunchAgent, verifies native + browser runtime policy, audits and
rolls back on failure. Do not claim live activation from a staged
script alone. Keep GH04/GH05 independent of origin allowlist changes.

https://admin.powerplatform.microsoft.com is an explicitly requested
Power Platform administration origin. Operator activation must still
be confirmed from the actual Mac.

### Recovery when an agent encounters a new HTTPS origin

On MUTATION_ORIGIN_DENIED or an equivalent allowlist block:
1. Establish the requested app's actual HTTPS origin, ignoring path/query.
2. Ensure that interacting with this app is explicitly within the user's task.
3. Ask the Mac operator to run sandbox-origins add https://exact.host.
4. Require ACTIVATED=PASS and BRIDGE_HEALTH=PASS (or verified already allowed)
   before retrying. Refresh browser identity and authorization.
5. Never broaden to a wildcard, migrate session credentials, or bypass
   Graph Harness GH04/GH05 to get around an origin gate.

## Omnissa Horizon Web Client: authenticated VDI visual gateway

40. For an authenticated Windows desktop rendered inside the operator's
Mac browser, read docs/computer-use-v2/HORIZON_WEBCLIENT_GATEWAY.md.
Set task.remote_surface=horizon_webclient and run the fail-closed
horizon-webclient-gate policy. This is NOT a Windows DOM/AX/UIA provider,
nor general Linux-to-Mac host access.
41. Reuse only the observed exact HTTPS browser tab, user-approved Mac
session, current title/window geometry and an independently verified
remote image. The 2026-11-02 live Toyota pilot successfully opened
Inventario de creadores in Windows through the existing Edge Web
Client using ONE foreground native click plus screenshot readback;
the delegated grant was revoked. No business record changed.
42. A native browser screenshot/action CAN foreground the Mac window.
Never claim that this is nonintrusive background automation. Block
background-only VDI jobs, semantic guest selectors, profile migration,
tenant ambiguity and screenshot-driven administrative writes.
43. The currently exposed MCP computer_use_action schema does not
surface screenshot_ref and coordinate_space even though the host
Bridge implementation supports geometry-bound screenshot pixels.
Until a validated MCP interface exports them, treat raw Mac screen-point
navigation as a PILOT ONLY, avoid bulk coordinate execution, rediscover
fresh geometry per action, and independently inspect each effect.
44. Browser origin permission does not establish corporate authorization
for unattended VDI control, screenshot retention, credential access or
DTI-14819 writes. Respect Toyota policies and preserve GH04/GH05 gates.
