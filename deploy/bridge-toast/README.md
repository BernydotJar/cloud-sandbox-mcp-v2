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
