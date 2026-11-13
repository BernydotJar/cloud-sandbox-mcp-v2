# Dedicated Chrome CDP: Automatic startup on Mac Bridge (opt-in)

## Design

A project's normal E2E/QA path remains **Playwright + isolated Chromium headless inside Cloud Sandbox**, as in Chessy. The opt-in authenticated path is **agent -> Cloud Sandbox MCP V2 browser_tabs -> already-running macOS Mac Bridge -> isolated Google Chrome with CDP bound to 127.0.0.1:9223**. That Chrome keeps site logins only in the dedicated `~/.ido-chrome-bridge/profile`, never in a user's personal Chrome profile.

The Mac Bridge daemon is managed by the existing user LaunchAgent with `KeepAlive` and `RunAtLoad` (see `scripts/install-computer-use-host.mjs`). When an agent needs the authenticated CDP browser, it calls the **existing** `browser_tabs(browser=chrome)` tool. With the opt-in enabled and the exact dedicated endpoint provisioned, Mac Bridge starts the dedicated browser automatically if it is missing; otherwise it reuses it. The human authenticates **once** in that dedicated Chrome, and again only when the site requires it.

The first interactive login opens a normal browser window. Subsequent CDP actions **do not move the physical mouse**, although browser tabs and application state can change. A dedicated Chrome is not a Linux headless browser and does not share cookies with it. Do not export site tokens, forward the raw CDP endpoint to Docker, bypass MFA, or kill the operator's Chrome.

## Install: one operator command

The Mac-hosted release bundle is located at:

`$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/dedicated-chrome/`

From Mac Terminal:

```sh
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/dedicated-chrome/install-on-mac.mjs" --activate
```

Optional safe preflight: substitute `--inspect`. No root access needed and no personal browser is restarted. The installer discovers the running `cloud-sandbox-mcp` Docker Compose project and validates the active Mac Bridge. It **does not compare the Bridge to a single obsolete hash**: `upgrade-bridge.mjs` applies minimal additions to verified scalar or per-browser routing syntax, preserving the existing Bridge's independent browser routing, auditing, policy, and native fallback. Incompatible shapes and mixed/partial patches fail closed. Candidate JavaScript is parsed by Node before installation.

The installer updates only the Compose .env keys needed for Chrome:
- `COMPUTER_USE_DEDICATED_CHROME_AUTO_START=true`
- `COMPUTER_USE_CHROME_ENDPOINT=http://127.0.0.1:9223`
- `COMPUTER_USE_CHROME_PROTOCOL=cdp`
- `COMPUTER_USE_CHROME_ROUTING=prefer_persistent` (per-browser routing), or global `COMPUTER_USE_BROWSER_ROUTING=prefer_persistent` for legacy scalar routing

Unrelated settings, especially Edge settings, are preserved in the per-browser variant. Before deployment, backups are saved under `~/Library/Application Support/LCH/CloudSandboxBackups/dedicated-chrome-<timestamp>/` as `bridge.mjs`, `controller.env`, `checksums.txt`. The installer rejects an active delegated session, restarts only the Bridge LaunchAgent, checks authenticated Browser Runtime health, and automatically restores the original bridge and env on failed restart/health. Never delete the dedicated Chrome profile to troubleshoot.

## Acceptance criteria (GO requires all)

1. Mac command prints `ACTIVATED=PASS` and `BRIDGE_HEALTH=PASS`.
2. Agent `browser_runtime_status`: Chrome provider configured, browser routing `prefer_persistent`.
3. Agent `browser_tabs({browser:"chrome"})`: starts the dedicated instance on demand and returns `provider=persistent`; no automatic native coordinate fallback in this mode. Chrome may initially have no site tabs.
4. Operator authenticates a required site **in the dedicated browser window**; repeat tab discovery and confirm the correct `tab_ref`.
5. `browser_inspect` succeeds and yields ARIA, or explicitly labeled non-semantic text/DOM fallback.
6. A scoped user-authorized non-destructive test action completes through Playwright/CDP with a state assertion and evidence.

A Linux test proves migration compatibility but **not** Mac deployment. Do not report production-ready browser automation until the Mac acceptance gate passes. If auto-start fails, inspect the **local** loopback port ownership, LaunchAgent state and browser runtime error, rather than switching silently to mouse coordinates.

## Rollback

Restore `bridge.mjs` and `controller.env` from the recorded backup to their original paths, preserving original permissions, then restart the existing user LaunchAgent. No browser profiles, credentials or controller tools are deleted.

## Optional glass connection confirmation

After dedicated Chrome auto-start is accepted and validated, the operator can
install the **Bridge Glass Toast** from deploy/bridge-toast/README.md. This
adds a small auto-dismissing native macOS confirmation on successful persistent
CDP discovery. It does not affect CDP permissions or suppress Chrome's own
remote debugging / automation security banners.
