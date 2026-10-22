# Native macOS Computer Use — source candidate

**Status: DRAFT / NO-GO.** The Mac bridge was not updated in this change. No macOS privacy or accessibility permissions were modified.

## Architecture

- Playwright Chromium inside dev-main: isolated browser QA.
- Browser MCP / persistent CDP: already authenticated Mac Chrome/Edge tabs (when provisioned).
- Native Computer Use: macOS application windows and accessibility controls through the existing bearer-authenticated Mac host bridge. Native actions may foreground windows.
- The desktop surface is an additive, operator-opt-in set of five MCP tools: `mac_windows`, `mac_inspect`, `mac_focus`, `mac_open`, `mac_action`.

## Operator configuration

Use the already-deployed bridge environment file. Require explicit approval, a clean deployment preflight and private backup before changing production configuration:

```dotenv
COMPUTER_USE_DESKTOP_ENABLED=true
COMPUTER_USE_DESKTOP_ALLOWED_BUNDLES=com.apple.finder,com.apple.Terminal,com.microsoft.VSCode
```

Default state is disabled. The bundle allowlist restricts app discovery and operations. Do not add privileged utilities, password managers or arbitrary bundles automatically.

macOS must grant the bridge the appropriate Automation/Accessibility permissions through native TCC prompts. Never bypass TCC or launch the user's browser profile simply to provision native control.

## Execution protocol

1. `mac_windows(bundle_id)` discovers windows of a named allowlisted app only.
2. `mac_inspect(bundle_id,pid,window_index,expected_title)` returns a bounded accessibility view without control values.
3. Request `computer_use_session_begin(scope="desktop", ...)`, which requires local approval and limits duration and action budget. Browser-only sessions cannot mutate Mac windows.
4. Use `mac_focus`, `mac_open` or `mac_action` with the scoped capability; actions use a unique request ID and exact observed PID/window/title plus AX identity where applicable.
5. Inspect after each consequential action. Never blindly retry an uncertain dispatched operation. End the session when done.

The current source does NOT promise general desktop screenshot or wheel-scroll support. GUI screenshots must be separately implemented and tested with macOS Screen Recording permission; scrolling must not be represented as supported until actual desktop tests pass.

## Acceptance criteria

- `npm ci --ignore-scripts --no-fund --no-audit`, `npm run typecheck`, `npm run lint`, `npm run test:mac`, `npm run verify:v2` all pass, plus dedicated native desktop CI.
- Native JXA syntax compiles on macOS.
- Actual Mac GUI acceptance with Finder, Terminal and VS Code: discovery, fresh target identity, accessibility click and text control, app focus/open, denied permissions, protected-field rejection, session expiry/revoke, replays.
- Verify browser/Playwright regression; ensure the existing 29-tool customized deployment is not overwritten by older registry code.
- Bridge upgrade and rollback must be gated; no running delegated session interrupted.
- Graph Harness issues an explicit GO/NO-GO with observed evidence.

## Security notes

No unbounded OS shell/AppleScript/JXA execution API is exposed through the desktop MCP interface. Terminal GUI keypresses still have potentially serious consequences and therefore require application-specific authorization, session scope, and user task constraints. Inspect actual target before acting. Window titles and AX content may include private user data; exclude it from audit telemetry.
