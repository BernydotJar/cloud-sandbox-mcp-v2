# Cloud Sandbox MCP V2 — existing Chrome/Edge persistent channels

## Verified architecture decision

The installed Playwright core 1.64.0 supports chromium.connectOverCDP("chrome") and chromium.connectOverCDP("msedge"). It reads each channel's browser-managed DevToolsActivePort from the ORIGINAL, running default browser user-data directory. This is the current Chrome/Edge live-instance debugging path introduced in modern Chromium.

This is not a remote-debugging-port launch flag, copied browser profile, new browser instance, HTTP port scan, publicly exposed debugging interface, or reauthentication workflow. Browser dialogs and settings still belong to the operator.

The native Mac Computer Use tools already find the authenticated tabs in BOTH browsers. Browser Runtime V2 has been installed but currently reports zero configured providers. This additive patch updates only the host-side connection pool, then configures two channel names:

    COMPUTER_USE_CHROME_ENDPOINT=chrome
    COMPUTER_USE_CHROME_PROTOCOL=cdp
    COMPUTER_USE_EDGE_ENDPOINT=msedge
    COMPUTER_USE_EDGE_PROTOCOL=cdp

It uses the existing authentication/authorization and auditing framework, including native task-session scope, per-tab opaque identities, semantic Playwright locators, audit evidence, and no automatic retries after uncertain dispatches.

## Initial browser setting: once per live browser instance

Enable Chrome's built-in remote debugging setting for this browser instance:

    chrome://inspect/#remote-debugging

Enable the same setting within the existing Microsoft Edge session:

    edge://inspect/#remote-debugging

In both browsers, choose Allow remote debugging for this browser instance. Playwright will read the browser's own local marker. Do not restart either browser, launch a second instance, copy profiles, set --remote-debugging-port, or open a debugging server to 0.0.0.0. Browser/channel permission prompts are distinct from Cloud Sandbox delegated task approvals.

The setting may need to be repeated after a browser restart. The provider reconnects lazily and reports a real failure when the browser debugger is unavailable; it never starts its own browser or profile.

## macOS operator commands

Release files are in:

    $HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-provider-channels

Read-only preflight first:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-provider-channels/install-on-mac.mjs" --inspect

Possible results:
- CHROME_CHANNEL=READY / EDGE_CHANNEL=READY / PREFLIGHT_READY_TO_ATTACH
- CHROME_CHANNEL=NOT_READY_REMOTE_DEBUGGING_NOT_ENABLED
- EDGE_CHANNEL=NOT_READY_REMOTE_DEBUGGING_NOT_ENABLED
- STOP with a security or drift diagnostic

Only when both channels are READY:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-provider-channels/install-on-mac.mjs" --activate

That command is the one-time deployment authorization. No new local confirmation is required for each action. Before changing configuration, the installer opens read-only Playwright connections to Chrome and Edge by channel and compares at least two safe page paths against the existing Mac JXA tab inventory. It does not display URLs, cookies, passwords or page content.

If both existing profiles match, it backs up the private .env and previous connection-pool source under the Mac's private LCH backups, updates the four provider settings atomically, updates the Mac host connector source atomically, and restarts ONLY the Mac Computer Use LaunchAgent.

The already-running MCP Docker controller, dev-main, networks, profiles, databases, cloud apps, browser processes, windows and active pages remain intact. Post-restart it must return two configured providers, and browser_tabs must find pages in both browsers. The installer attempts rollback to original files and launchd process on failure. If rollback is incomplete it provides a private backup location and stops.

## Acceptance gates

After activation, in ChatGPT call these tools in order:

1. browser_runtime_status: should show providers for chrome and edge, initially connection state may be disconnected (lazy attachment)
2. browser_tabs browser chrome: should list opaque tab refs matching the running Chrome session
3. browser_tabs browser edge: should list opaque tab refs matching Edge
4. browser_inspect for one approved non-sensitive LUMA tab: should show an ARIA snapshot, without creating or changing pages
5. browser_runtime_status again: should show two persistent connections and reuse when requesting tabs again
6. In an explicitly delegated task session, test an innocuous semantic click and confirm the effect; no per-click browser-controller dialogs

If Chrome or Edge does not expose a supported local channel, do not fabricate a provider. The official Playwright browser extension is a separate integration option that requires installation/pairing; it is not automatically equivalent to a native Playwright endpoint.

## Security and scope

This approach is local to the single operator's Mac. CDP is powerful and grants extensive browser control to any process able to access its debugging interface. Browser Runtime V2 exposes a **narrower set of MCP tools**; the OS/browser debugger itself is still sensitive. Keep device access restricted and review local browser debugging permissions. Do not expose Chrome DevTools ports or tokens to the workstation, internet, Docker tools, telemetry or Git.

No domain allowlists were created. Existing opaque browser tab refs and revision guards remain unchanged. The tool has not modified the old V2 immutable release manifest. A separate patch bundle holds this narrowly scoped enhancement. Deployment must be verified on macOS before it is considered complete.

### References

- Chrome: https://developer.chrome.com/blog/remote-debugging-port
- Playwright browser attachment: https://playwright.dev/mcp/configuration/browser-extension
- Playwright API: https://playwright.dev/docs/api/class-browsertype

## Linux source verification

    npm run test:mac
    python3 deploy/browser-channel-providers/test-install-preflight.py

Run Mac-only inspection after tests pass. Neither test launches a user browser.
