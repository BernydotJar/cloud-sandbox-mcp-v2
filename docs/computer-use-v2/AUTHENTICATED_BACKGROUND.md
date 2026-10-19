# Authenticated Mac session + background browser automation

Decision: two distinct paths are supported. For a new uncredentialed site or internal QA, use isolated Playwright headless in dev-main. When the user explicitly requests their *existing macOS Chrome/Edge authenticated session*, use Mac-host Browser Runtime via Cloud Sandbox MCP V2 `browser_tabs` and semantic `browser_inspect`/`browser_action` on a persistent CDP/Playwright provider. This remote semantic path need not move the physical mouse, but it **can change the user's actual browser tabs and site data**. It is not a detached headless clone of the login session.

The host Mac's localhost is not dev-main localhost. `sandbox -c` is an operator entrypoint whose semantics have not been verified here: do not infer that it transfers authenticated state. No raw cookie export, profile copying, MFA bypass, or CDP port exposure to Docker should be implemented.

Observed live state 2026-10-18: Edge persistent provider connected, Chrome provider configured but Chrome has browser_routing=native_first and cdp_attach_enabled=false. Chrome returns provider=native with an authenticated Suno tab; native coordinates require the user's scoped grant and are not equivalent to background semantic Playwright. Isolated Chromium reaches Suno /sign-in. The Chrome native-first overlay source reads `COMPUTER_USE_BROWSER_ROUTING` (default `native_first`); `prefer_persistent` attempts CDP before native fallback. Changing that configuration alone cannot enable browser remote debugging: a running browser must explicitly grant the debugging channel. Never restart or reprofile the user's live Chrome automatically.

Acceptance gates for real Mac session reuse: (1) `browser_tabs(chrome)` returns provider=persistent and the specific Suno tab_ref; (2) `browser_inspect` exposes semantic role/label evidence; (3) a delegated task-scoped session is approved; (4) an explicitly authorized non-destructive semantic interaction executes without macOS mouse movement; (5) screenshots and reports show post-action state; (6) no credentials transferred to the Linux workstation. If any gate fails, report it precisely; do not claim full repair based only on Linux tests or documentation changes.

The isolated headless probe runner `scripts/browser-automation/run.mjs` is NOT a replacement for this authenticated Mac session mode. Never insist on a second sign-in if the task explicitly mandates reusing the Mac session.

## Dedicated Chrome autostart and drift-safe migration (2026-10-18 follow-up)

The previous dedicated-Chrome installer only recognized bridge SHA-256
`3c501d5f81cebdcdd9c6cf56487ba3fe837ee8e686c3ecb980dae537a530c69e`
(native-first, scalar routing). A newer Mac Bridge supports independent
Chrome/Edge routing and legitimately has another fingerprint. The original
installer returned `UNKNOWN_BRIDGE_VERSION_NO_CHANGES` and made **no**
modifications. This was a release compatibility defect, not authorization or
profile corruption.

The replacement `deploy/dedicated-chrome/upgrade-bridge.mjs` uses guarded
source-shape matching (scalar or per-browser routing), an additive patch, a
Node syntax gate, backup, LaunchAgent restart, authenticated health check,
and rollback. It does not overwrite the installed Bridge with an older
snapshot or switch Edge policy in the per-browser variant. Agent-triggered
auto-start is allowed only when the operator opted in, the endpoint is exactly
`127.0.0.1:9223`, and the local CDP listener belongs to the matching
dedicated Chrome profile. An unavailable dedicated channel is an error,
**not** permission for automatic native UI clicks.

Operator: run the one-command `--activate` procedure in
`deploy/dedicated-chrome/README.md`. Agent: after successful activation,
call `browser_tabs(chrome)`, inspect the resulting persistent tab, and
perform approved E2E verification with screenshots and assertions. The
macOS service LaunchAgent remains configured to restart on demand/login
through its existing `KeepAlive` / `RunAtLoad` settings.

## Short native status splash with Akira mascot

The dedicated Chrome Bridge can optionally display a one-time native macOS
connection confirmation. `deploy/bridge-toast/` contains an AppKit overlay
(upper-right corner, mascot, click-through and nonactivating) and a guarded
one-shot installer. It remains visible for approximately 5 seconds and then auto-hides.
It never prompts the operator or blocks agent work; structured connection
errors remain available to MCP clients. It does **not** change Chrome-native
automation/debugging security banners or operating-system permission prompts.

Operator installation: run `node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/bridge-glass-toast/install-on-mac.mjs" --activate`
once on macOS. `browser_tabs(chrome)` displays it after successful persistent
discovery when `COMPUTER_USE_BRIDGE_TOAST=true` is enabled. For development
tests, see `deploy/bridge-toast/README.md`.


## Suno locator recovery shipped with Akira splash

The Akira one-shot Mac installer also provisions a guarded Browser Runtime
AX/CDP fallback (`cdp-semantic.mjs`). Chrome's accessibility tree provides
actual control roles/names even when Playwright's injected locator engine
cannot run on the attached tab. Actions focus the verified backend DOM node
and use keyboard events / Input.insertText, not screen coordinates or
arbitrary JavaScript. All existing delegated grants, request-ID replay
guards, protected-field exclusions and audits remain enforced. Deployment
is atomic with the splash and rolls back on failed Bridge health. A real
isolated Chromium E2E simulates the failed injected Playwright engine and
asserts CDP AX inspection, click and fill.

### ARIA field label fix

In the CDP AX semantic fallback, textbox accessible names now precede the colon
in the normalized snapshot so privacy masking does not erase locator names.
The fallback still never returns editable field values.

## Edu! Bridge-only trusted session notice

For the one-time operator opt-in, run the native Mac
`deploy/bridge-toast/install-on-mac.mjs --activate-trusted-notice`.
This explicitly configures a bounded, allowlisted delegated-session
authorization in the Mac Bridge itself, **without requiring CDP**.
The Bridge no longer displays its Approve/Deny modal for eligible sessions,
but it does show a 20-second, dismissible, nonactivating native macOS glass
notice in the upper-right corner. It greets **Edu!**, confirms Bridge readiness,
provides a short original NLP-inspired reframing phrase, and identifies the
browser/session action budget. The X dismisses the notice, not the grant.

The operator must have explicitly enabled the feature. Otherwise all
existing approval semantics remain unchanged. The trusted session is
single-browser, maximum 30 minutes / unlimited actions; all mutations must target
existing operator allowlisted HTTPS origins. An audit failure before grant
issuance or any over-budget/multi-browser request prevents auto-grant.
A scoped `computer_use_session_begin` grant is required: direct per-action
mutations without a `session_id` continue to ask for approval. OS/macOS
security prompts and browsers' own security indicators are not suppressed.


### Trusted delegation action counter

The locally enabled trusted grant expires after at most **30 minutes** and
does not use a per-session action cap. Its status reports
`unlimited_actions=true` and `remaining_actions=null`. The existing
`max_actions` MCP parameter remains valid for classic sessions and is
ignored by the Mac Bridge for operator-enabled trusted sessions. The
`autonomy-session.mjs` helper is upgraded together with the Bridge in a
guarded, reversible host installation. Every action still requires
the actual session ID, correct browser and configured HTTPS allowlist and
creates audit evidence.
