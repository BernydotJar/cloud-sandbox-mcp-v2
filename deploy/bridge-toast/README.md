# Akira · Mac Bridge status splash

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
