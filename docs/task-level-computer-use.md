# Cloud Sandbox MCP V2: task-level Mac autonomy

This release replaces the impractical per-click approval requirement with one bounded permission per task, preserving the previous per-click mode when no delegation is active.

## Experience

The user can ask: Use my Mac. Inspect LUMA in Chrome, then review Microsoft 365 in Edge. Do not change accounts, licenses, purchases or DNS.

ChatGPT discovers live Chrome/Edge tabs via computer_use_state, then requests computer_use_session_begin with a browser scope, task purpose, duration of 1–30 minutes and up to 200 allowed actions. macOS shows ONE consent dialog. Once approved, the agent passes the returned session_id on every computer_use_action and can click/type/press keys without another local dialog until expiration, budget exhaustion or revocation.

The browser is still selected by freshly discovered title, safe URL and temporary indices. Sessions reside only in host bridge memory: restarting the bridge revokes them. computer_use_session_end revokes a session remotely, and the user can invoke a local stop script from Mac Terminal.

## Security

Approving a task session permits unattended browser events within its browser scope. A browser click may submit payments, change license assignments, modify DNS, or perform other important actions. The bridge cannot distinguish those effects from harmless navigation. Define the task's permitted and forbidden effects explicitly. The agent must honor user instructions, including pausing for material decisions. Do not approve a session whose purpose or scope is unclear.

Scopes are chrome, edge and both; generic Finder and other native Mac apps are not included. Browser tab discovery continues to require the previously enabled dynamic discovery setting.

## Additive tools

- computer_use_session_begin: obtain the one-time native approval and delegated capability.
- computer_use_session_status: inspect scope, expiry and remaining action budget.
- computer_use_session_end: revoke an active session.
- computer_use_action: accept an optional session_id. With no session_id, retain the old per-action local approval.
- computer_use_status continues to report bridge availability and delegation status.

23 total tools, preserving all 20 existing registrations.

## On macOS

Preflight, read-only:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/task-sessions/install-on-mac.mjs" --inspect

Install:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/task-sessions/install-on-mac.mjs" --install

Type INSTALL_TASK_SESSIONS at the explicit terminal prompt. This installation backs up changed files privately and restarts ONLY the current Cloud Sandbox MCP controller and the Mac bridge, not dev-main. No Docker Compose configuration or browser tab content is changed. It attempts rollback on failed validation. After installation, refresh action discovery in ChatGPT to expose the 3 new tools.

Emergency local stop:

    bash "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/task-sessions/stop-on-mac.sh"

This clears in-memory grants by restarting the Mac host bridge without touching Docker. It does not undo a click already performed.

## QA and limitations

- Node tests: 32/32 successful, including bounded delegation, expiration, approval only once, revocation, scope, audit privacy, stale tab identity and fallback behavior.
- TypeScript checks and custom-controller registry: 23/23 PASS.
- No real delegated Mac GUI session has been executed yet. An actual Mac installation and short read-only/navigation smoke test are still required.
- Current development is committed locally on feat/native-mac-computer-use; not pushed unless separately authorized.
