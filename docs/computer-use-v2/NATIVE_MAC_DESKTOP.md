# Native macOS Computer Use extension (source candidate)

**State:** feature branch; NOT installed on the user's Mac, not production accepted.

The existing browser tools continue to use Playwright / CDP (or explicit native browser fallback). This extension adds native desktop control to the same authenticated Mac bridge, without sharing browser-only authorizations.

## Enable on Mac (operator action, after source verification)

In the existing private Mac bridge environment file, add:

```dotenv
COMPUTER_USE_MAC_DESKTOP=true
COMPUTER_USE_MAC_ALLOWED_BUNDLES=com.apple.finder,com.apple.Terminal,com.microsoft.VSCode
```

Do not change the live bridge while a Computer Use session is active. Inspect the deployed customized bridge before overlaying source; keep exact backups, verify deployment hashes, and use the existing guarded release/install procedure. This feature branch is not a signed installer. No deployment is authorized merely by the example above.

Grant macOS Accessibility, Automation and Screen Recording permissions specifically to the signed bridge host process through System Settings; do not weaken TCC or bypass consent.

## Routing

- Browser E2E: isolated Playwright Chromium in dev-main.
- Existing Mac login: browser_tabs / browser_inspect / browser_action via CDP.
- Native Mac apps: mac_apps -> mac_windows -> mac_accessibility_tree or mac_screenshot -> computer_use_session_begin(scope=mac) -> mac_action/mac_focus/mac_launch -> computer_use_session_end.
- Mixed explicit tasks may request scope=all; mac-only and browser-only sessions remain mutually isolated.

## Contract

1. mac_apps returns *only* allowlisted currently running applications.
2. mac_windows returns PID, fresh window index and exact title. No URL/profile/cookie material.
3. mac_accessibility_tree returns up to 150 AX nodes, max four levels below the selected window, role + name only, no field values.
4. mac_screenshot captures selected window bounds through macOS Screen Recording.
5. mac_action performs click, text-field setValue, bounded press_key, or bounded page scroll; it requires session_id, request_id, exact bundle/PID/window-title, and for semantic actions a fresh AX path/role/name. Secure/password fields are blocked.
6. mac_focus/mac_launch foreground or launch only operator-allowlisted application windows/bundles and require Mac-specific delegation.
7. The host serializes native UI mutations with browser actions; a duplicate request_id never dispatches again in a single bridge process. A timeout may still have sent the event: inspect, never retry blindly.
8. macOS actions can take foreground focus and interfere with local work. Do not run native UI scripts in the background while the human is using the Mac. Prefer deterministic shell/API tasks in their separately controlled environment.

## Acceptance (not yet completed)

- Run npm ci --ignore-scripts, npm run verify, npm run test:mac on CI.
- Test mac_apps/windows/AX in a real macOS GUI session with Finder, Terminal, and VS Code.
- Confirm explicit operator allowlist, TCC denied/allowed behavior, stale-title/pid rejection, secure-field rejection, duplicate request suppression, session expiration and revocation.
- Verify Chrome and Edge regressions, existing 29-tool customized deployment preserved, only seven additive desktop MCP methods.
- Check rollout and rollback on the *actual* current Mac deployment, then record GO/NO-GO with Graph Harness.

**Security limitation:** AX nodes are transient; an app can mutate its own controls asynchronously. This is not a transactional guarantee. Accessibility labels may contain private information; they are never written to the audit ledger. The host controller still authenticates requests with its existing private bearer credential.
