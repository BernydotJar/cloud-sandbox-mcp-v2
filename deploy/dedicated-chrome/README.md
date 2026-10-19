# Opt-in dedicated Chrome auto-start (Mac Bridge)

This release adds `COMPUTER_USE_DEDICATED_CHROME_AUTO_START=true` to the Mac-hosted Browser Runtime. An agent invokes the existing `browser_tabs(browser=chrome)` tool. If routing is `prefer_persistent` and its Chrome provider explicitly targets `http://127.0.0.1:9223`, Mac Bridge starts a dedicated Chrome instance automatically when the loopback CDP endpoint is unavailable. The first login is performed by the user in that instance. Subsequent agent operations reuse that profile; the Mac's personal Chrome profile is untouched.

Headless QA remains isolated in Cloud Sandbox and does not inherit credentials. The dedicated Chrome app is visible during the initial login; subsequent Playwright CDP commands do not use the physical macOS pointer, but can change the dedicated browser's tabs.

## Deployment
Mac operator: `node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/dedicated-chrome/install-on-mac.mjs" --inspect` then `--activate`.
The installer checks the known native-first bridge hash, saves backups, sets the three allowlisted configuration values and restarts the LaunchAgent. Unknown versions fail closed. No ports are opened to Docker and no browser passwords/cookies are exported.

## Acceptance
1. Run `browser_runtime_status`; Chrome CDP must be configured and routing must be `prefer_persistent`.
2. Call `browser_tabs(chrome)`; if needed Mac Bridge opens only `~/.ido-chrome-bridge/profile` at 127.0.0.1:9223.
3. Operator completes login in that window.
4. Repeat `browser_tabs`: must return `provider=persistent` and a scoped tab_ref.
5. `browser_inspect` and a specifically permitted action must pass on a test site before GO.
6. Do not treat `provider=native` as completion; no automatic coordinate fallback for headless workflows.

Rollback: restore `bridge.mjs` and `bridge.env` from the printed backup folder and kickstart the existing LaunchAgent. Never delete profile or login data.
