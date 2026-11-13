# Cloud Sandbox MCP V2: Automatic Computer Use

The user gives the task. The runtime chooses the interface.

## Routing policy

The browser_tabs tool attempts the running Chrome or Edge Playwright channel without setting up providers or ports. If this fails due to an unavailable CDP transport, it returns provider=native with the already open tabs and their exact native_target, not a made-up semantic tab reference. The agent can then use computer_use_screenshot and computer_use_action, with the existing task-session rules.

If browser_tabs shows running=false, the agent may call browser_open when the user asked for browser work. This opens only the installed Chrome or Edge application by its fixed macOS bundle identifier and uses the existing profile. It never launches an arbitrary command, creates a new browser profile, navigates to an unrequested URL or exposes a DevTools endpoint.

Do not launch a browser simply to query browser_runtime_status. Discovery is read only. Existing browser windows, cookies, logins and user tabs are preserved.

## One-time software upgrade on macOS

The current Cloud Sandbox computer-use controller must already be installed and Browser Runtime V2 enabled.

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-auto/install-on-mac.mjs" --install

One explicit installation command is sufficient. It validates the existing controller and Mac bridge, refuses to interrupt an active task, backs up four existing files privately, installs only the four hash-pinned code updates, restarts only the existing Mac bridge and cloud-sandbox-mcp container, then verifies all 29 tools and both browser routes.

If any verification fails, it attempts to restore the previous bridge and controller tool registry. It does not touch dev-main, images, browser profiles, DNS, networks, domains or .env.

An optional read-only check is available:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-auto/install-on-mac.mjs" --inspect

Refresh Cloud Sandbox tool discovery after successful installation so browser_open becomes available.

## Agent contract

1. browser_tabs on the requested browser (title filter optional).
2. If provider=persistent, use browser_inspect, browser_screenshot and task-authorized browser_action with fresh tab_ref and revision.
3. If provider=native, use the returned native_target for computer_use_screenshot or computer_use_action. Refresh tab identity before any click or typing.
4. If running=false and the user asked to open a browser, invoke browser_open, then retry browser_tabs.
5. If a browser requires a first-time macOS Automation permission or the debugger is unavailable, do not bypass the OS restriction.
6. Never repeat uncertain action outcomes without independent verification. End the delegated session after completion.

One task-level consent still applies to browser mutations under the current Mac bridge policy; individual clicks need no separate confirmation after approval.

## Verification and scope

Project tests cover automatic provider selection, explicit endpoint override, no arbitrary launch parameters, native fallback without fabricating semantic controls, existing browser reuse, stale target validation, task scopes and audit evidence. Actual browser-control deployment must be confirmed on macOS. This is a single-owner Mac architecture, not a claim of multi-tenant compliance certification.

Compared with Codex's in-app browser and its desktop/Chrome integrations, this is a custom adapter for the user's existing Mac Chrome and Edge windows. It does not claim to reproduce Codex's internal runtime implementation.
