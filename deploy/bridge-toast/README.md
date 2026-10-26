# Akira · Mac Bridge status splash

**2026-10-26 source candidate (NOT deployed):** The AppKit on-screen splash
adds an original colorful laboratory particle burst; it remains focus-safe
and honors macOS Reduce Motion. A third, explicit mode
`bridge-toast --status-alert <storage|edge|terminal|recovery>` displays a
20-second interactive native notice with a working **Ver registros** control
(which opens the local audit directory in Finder) and Close.
The original connection splash stays five-second, click-through and
nonmodal. The delegated session notice remains 20 seconds; closing a
notice never revokes authority. These are **Mac-only** UI features,
not a web app, and require an independent macOS Swift compile, visual
inspection, checksum-based release and deployment before use.

The status alert mode is a renderer accepting fixed status codes. It is
**not yet wired** to live telemetry or the six-hour disk watch; do not
claim it will pop up automatically. It does not start browsers, switch
CDP routing, enable debugging, or change operator permissions.
Refer to `docs/computer-use-v2/SCREEN_SPLASH_NO_DEBUGGING_20261026.md`.


**Design:** a compact, cute, native macOS glass splash with an original lilac Akira mascot and a small coral accent. It appears in the **upper-right screen corner** after the first successful **dedicated Chrome Playwright/CDP connection**. The only copy is “Bridge listo ✨” and “Chrome conectado · Playwright”.

**Timing:** visible for **5.0 seconds** starting when shown, with ~280 ms fade-in and 320 ms fade-out. The overlay is click-through, non-modal, non-activating, does not steal focus, and respects macOS Reduce Motion. It is shown **at most once per live Bridge service process**, rather than every tool call.

**Implementation:** `bridge-toast.swift` builds to a self-contained, native AppKit executable on macOS using `xcrun swiftc`. `upgrade-toast.mjs` makes a guarded additive Bridge patch; `upgradeToastEnvSource` opts in with `COMPUTER_USE_BRIDGE_TOAST=true`. `install-on-mac.mjs` compiles, backs up, installs and health-checks in one invocation. No external image, web request, extra process manager, browser extension, or Mac admin password is required.

### One-shot operator activation (on the Mac)

```bash
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/bridge-toast/install-on-mac.mjs" --activate
```

The same command with `--inspect` is a read-only preflight. On PASS, a new `browser_tabs({browser:"chrome"})` request shows Akira once on the next successful persistent connection. Chrome and Suno remain authenticated; the profile and browser tabs are never restarted by this update. To perform an on-screen preview without a new browser connection, run the installed `~/Library/Application Support/LCH/CloudSandboxComputerUse/ux/bridge-toast` binary manually.

### Scope and security

This replaces a **Bridge-owned status notice**, not Chromium/Chrome's own browser-level debugging or automation security infobars. macOS permissions, genuine browser security indicators, and explicit delegated approval prompts are *not* hidden. Internal errors remain available as structured MCP results and in the audit log; they are never disguised as “connected”. When the splash binary cannot run, the Browser Runtime continues functioning without displaying a modal error.

The installer:
- Requires the existing dedicated Chrome feature, current Mac Bridge, no active delegated Computer Use session.
- Requires a safe local runtime and checks the Bridge variant, JavaScript syntax, Swift build, and authenticated health after LaunchAgent restart.
- Backs up original `bridge.mjs`, environment, and any previous splash binary under `~/Library/Application Support/LCH/CloudSandboxBackups/bridge-glass-<timestamp>`.
- Restores the originals and restarts the existing LaunchAgent if deployment or health verification fails.

### Quality gates

`npm run test:mac` covers migration, idempotency, once-only successful discovery, hidden on failures, no native click fallback, five-second timing, upper-right placement, non-activating behavior, reduced motion and rollback provision. On macOS the suite also runs `swiftc -typecheck`. The installer compiles the full native executable before applying changes. Final production acceptance requires a successful Mac installation and visual observation of Akira auto-hiding after ~5 seconds.


## Suno CDP AX recovery included in the same one-shot installer

This release also contains a **CDP accessibility fallback** for pages where
Playwright's injected `locator.waitFor()` and `ariaSnapshot()` fail but the
page, screenshot and CDP protocol remain healthy. The Mac-hosted
`browser-runtime/runtime.mjs` and new `browser-runtime/cdp-semantic.mjs`
are provisioned together with the splash using the **same single command**.

- `browser_inspect` first uses native Playwright ARIA. If it fails, Chrome
  `Accessibility.getFullAXTree` supplies **verified roles/names** with
  `inspection_mode=cdp_ax_fallback`; only then may it return plain DOM text.
- `browser_action` first attempts Playwright semantic locators. On failure,
  an AX role/name or unique test ID is verified directly using CDP; only
  `DOM.focus`, keyboard events and `Input.insertText` are used. No physical
  pointer, pixel coordinates, unsafe JavaScript execution, or session copy.
- Privileged/password/file fields and ambiguous/disabled targets remain
  blocked. The delegated session, request-id replay guard, origin policy and
  before-action audit still run through the existing Browser Runtime.
- Existing `BROWSER_PRECONDITION_FAILED` can be replaced by a more specific
  `CDP_AX_NOT_FOUND` or `CDP_AX_AMBIGUOUS` when the target is absent or
  nonunique. No action is dispatched in those cases.
- On macOS the installed runtime is accepted only if its SHA-256 matches
  the known earlier `inspection-fallback` release or the exact current
  release. Unrecognized customized runtimes fail closed, preserving the
  installed version.
- The installer backs up the old runtime and optionally an existing CDP helper;
  rollback restores both as well as the Bridge, environment and toast binary.

The Linux real-Chromium E2E disables Playwright's injected locator engine and
verifies that the AX/CDP path can still inspect, click and fill an input,
with post-action state assertions. This is a reproducible regression test;
it does **not** alone certify Suno or Mac-side UI interaction.

After Mac activation, the browser service must report the new
`inspections_cdp_ax` metric. Use `browser_tabs(chrome)`,
`browser_inspect` and a scoped, authorized `browser_action` to validate the
actual Suno UI. Any full song generation is a separate business-level gate.

### Accessible field-name correction

The original CDP AX fallback emitted textboxes as `- textbox: "name"`; the
existing privacy scrubber treated everything after the colon as field *value*
and erased even the accessible control name. The corrected driver emits
`- textbox "name": [REDACTED_FIELD_VALUE]`, preserving only the verified
accessible label and never leaking the field content. The installer accepts
both the original CDP driver release and the corrected driver as guarded
known versions. Live delegated sessions must be ended before the update;
only the Mac Bridge service restarts, not Chrome or any logged-in tab.

## Edu! trusted delegation notice: 20 seconds, no repeated Approve/Deny

This **separate, explicitly enabled** Mac-host feature supports the user's
requested nonblocking 20-second UI. The familiar delegated-session
`Approve/Deny` dialog remains the **default** for installations that have
not opted in. An operator may deliberately enable the bounded no-modal
behavior from **their Mac Terminal** with:

```sh
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/bridge-toast/install-on-mac.mjs" --activate-trusted-notice
```

This updates the installed Bridge additively, preserves the existing browser
profiles, requires a preconfigured exact-HTTPS allowlist and backs up the
previous Mac Bridge and configuration. Configuration includes
`COMPUTER_USE_TRUSTED_SESSION_NOTICE=true` and
`COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY=true`; it does **not**
enable a CDP endpoint or require `chrome://inspect`.

When a scoped `computer_use_session_begin` succeeds, a native **Edu!**
glass notice appears at the **upper-right corner** for **20 seconds**.
It includes an original motivational paraphrase inspired by *Introducción
a la PNL* (Joseph O'Connor and John Seymour): **«Tu enfoque abre
posibilidades. Hoy eliges avanzar.»** This is not claimed to be an exact
quotation from the book. The notice shows browser, duration and action
limits. It does not steal focus or prevent agent execution.

The **X** hides the notice immediately. **It does not revoke the delegated
session**; the explicit `computer_use_session_end` tool or the local STOP
command remains available. The usual five-second «Bridge listo» confirmation
still appears after initial dedicated Chrome discovery if no delegation
notice has already been shown in that Bridge process.

### Limits and authorization behavior

- This is a **prior operator authorization** via the opt-in installer, not
  implicit authorization granted by a browser page or an agent.
- Only one browser per delegated session (`chrome` or `edge`), at most
  **30 minutes**, with **no per-session action limit**. Requests for both
  browsers are rejected with `TRUSTED_SESSION_LIMITS_EXCEEDED` and sessions
  over 30 minutes with `INVALID_SESSION_REQUEST`.
- Mutations are confined to the operator-configured
  `COMPUTER_USE_ALLOWED_ORIGINS` exact HTTPS origins. Other websites cannot
  be changed through this mode. Extend the allowlist only through the
  operator's own existing configuration procedure.
- Request capability, tab identity, origin and stale-revision checks remain
  enforced. Successful mutation calls are still audited; no
  action budget is consumed in explicitly configured trusted mode. An unavailable pre-grant audit blocks delegation.
- Legacy per-action commands **without a delegated session** still require
  explicit approval; agents should acquire a scoped session and supply the
  returned `session_id` for permitted work.
- Native/macOS permission dialogs, OS security controls and browser security
  indicators are unchanged. A trusted delegation can still perform
  consequential actions **within allowed domains**, so enable this mode
  only on a workstation and allowlist the operator trusts.

### Operator validation

1. Run `--activate-trusted-notice` locally; require
   `ACTIVATED=PASS` and `BRIDGE_HEALTH=PASS`.
2. Start a scoped session, e.g. Edge for **30 minutes**. The existing
   `max_actions` MCP argument is kept for backward compatibility; the Mac
   Bridge ignores it when this trusted mode is enabled. A successful grant
   reports `unlimited_actions=true` and `remaining_actions=null`.
   The response should include `approval_mode=configured_trust` and
   `notice_seconds=20`, with **no approval dialog**.
3. Confirm the top-right **Edu!** notice appears for 20 seconds,
   can close with **X**, and contains no CDP-related text.
4. Verify out-of-scope origins, `both` scope, requests longer than 30
   minutes and failed audit all reject safely; `computer_use_session_end` revokes the grant.
5. If an old macOS permissions dialog still appears, identify its source:
   OS/browser-level dialogs cannot be replaced by this Bridge-owned notice.

### Rollback

The operator's installer prints the
`~/Library/Application Support/LCH/CloudSandboxBackups/bridge-glass-...`
backup path. Restore `bridge.mjs` and `controller.env` from that backup,
preserving permissions, then restart the Bridge LaunchAgent. Existing browser
sessions and profiles are never deleted. To disable no-modal delegation while
keeping the visual splash, explicitly change
`COMPUTER_USE_TRUSTED_SESSION_NOTICE=false` in the Mac host configuration
and restart the existing service.

### Host session-store deployment

The `--activate-trusted-notice` installer also upgrades the **Mac-hosted
`autonomy-session.mjs`** to a version with a truly unlimited action counter
(`unlimited_actions=true`, `remaining_actions=null`). It verifies a
known baseline hash, saves an original copy in the same backup folder,
parses the upgraded JS, then checks `/v1/status` after LaunchAgent restart
before confirming success. If anything fails, the session store, Bridge and
environment are restored. The installer does **not** modify CDP or Playwright
runtime when installing this Bridge-only trusted notice mode.

### On-screen preview without installation (macOS)

This staged preview compiles the native Swift window to a disposable private
macOS temporary directory and removes the preview executable afterward.
It never modifies the installed Bridge or browser configuration.

In the operator's Mac Terminal, after the reviewed candidate is copied to
the shared-auth handoff directory:

```sh
BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/akira-lab-splash-20261026"
node "$BASE/preview-on-mac.mjs" --inspect
node "$BASE/preview-on-mac.mjs" --status-alert edge
```

Use the no-argument command to preview the 5-second connection splash.
The 20-second alert has a working read-only **Ver registros** control.
This is visual verification, not an installation. No browser debugging is
enabled by this preview.

### macOS Swift compiler failure diagnosis

The original preview wrapper suppressed \`swiftc\` stderr and printed only
\`STOP=Command failed: /usr/bin/xcrun ...\`. The updated preview prints
\`SWIFT_TOOLCHAIN\`, \`SWIFT_TYPECHECK\`, \`SWIFT_COMPILE\`, and up to 65
sanitized \`SWIFT_DIAGNOSTIC\` lines. A macOS compile result remains
unknown until the operator executes this candidate in the Mac session.
Do not enable browser debugging or change Xcode developer-directory
selection automatically to address a compiler error.
