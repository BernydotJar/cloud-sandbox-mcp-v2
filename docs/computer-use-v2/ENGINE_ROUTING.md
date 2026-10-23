# Cloud Sandbox MCP V2 — engine routing contract

## CDP is not Playwright

Cloud Sandbox MCP V2 orchestrates multiple independent execution engines.

| Engine | Purpose | Installed status |
| --- | --- | --- |
| Isolated Playwright/Chromium | Off-screen product QA and CI E2E | Working independently in Linux workstation |
| Browser MCP authenticated session | Chrome/Edge existing tabs via a browser transport, semantic actions when supported | Working with Chrome CDP; Edge CDP currently failing |
| Native Computer Use | Browser tabs through macOS automation; general desktop through Accessibility API is a separate future capability | Chrome/Edge native fallback; general desktop tools not registered |
| Shell/APIs | Deterministic file, infrastructure and supported application actions | Working in Linux workstation |

A CDP endpoint is a browser communication protocol, not Playwright.
The installed Browser Runtime currently imports playwright-core and uses
chromium.connectOverCDP for authenticated Chrome/Edge browser channels.
That is **Playwright as the CDP client**, a specific implementation of
Browser MCP, and has no bearing on isolated Playwright QA in a test process.

The macOS general-purpose mac_list_apps, mac_accessibility_tree,
mac_focus_window and mac_open_app tools are NOT currently registered.
Do not claim Finder, Terminal or VS Code native window control is
available from the installed browser-specific Computer Use tools.

## Agent engine selection

1. For independent web application QA/E2E, use the project Playwright
   suite or headless isolated Chromium in the workstation, never the
   personal Edge/Chrome session. Browser CDP is NOT a prerequisite.
2. For user-authorized authenticated app edits, run read-only
   computer_use_status, browser_runtime_status and browser_tabs for
   the requested browser. Inspect actual tab capability, not settings.
3. If provider=persistent, semantic_available=true and tab_ref exists,
   use Browser MCP: browser_inspect then role/label/test-id browser_action.
   Recheck revision, audit and independently verify persistence.
4. If provider=native, semantic_available=false with a native_target,
   the persistent CDP adapter is unavailable. Use scoped
   computer_use_session_begin, screenshot and native actions ONLY when
   user-authorized, reliable, foreground interaction is acceptable
   and the final result can be independently verified. Native coordinate
   clicks are a LAST resort and NEVER semantic Playwright evidence.
5. If a task requires semantic selectors or an exact cell identity and
   the native engine cannot provide it, return BLOCKED_SEMANTIC_BROWSER,
   not a false pass. The rest of isolated Playwright QA may still proceed.
6. Do not copy credentials, browser profiles or cookies between browsers,
   launch duplicate browsers or connect random CDP ports.
7. For general native macOS windows/apps, without registered app/AX tools
   report BLOCKED_NATIVE_DESKTOP. Use a deterministic CLI/API only when
   it truly satisfies the requested action.

## UiPath website cell-entry transaction

Separate the **source skill** (data extraction/validation) from the
**UI adapter** (web-cell writes). Neither source data nor successful
sign-in proves that specific rows were updated.

Capture before state. Identify each row/column by stable labels, type
and expected value. Prefer an approved deterministic application API
when equivalent; otherwise semantic Browser MCP. Use native fallback
only under the restrictions above. Do not blindly bulk type or retry
uncertain writes. After entry, read back the target row and verify
persisted value after app save/reload where supported. Collect redacted
before/after evidence, action count, browser engine, and row-level outcome.

## Keep release gates separate

A successful login, allowlisted UiPath origin, CDP connection,
foreground click, and persistent cell value are FIVE distinct facts.
GH04/GH05 are project-specific Graph Harness gates. Read the actual
acceptance definitions before claiming their meaning. For each gate
record evidence-backed PASS, FAIL or BLOCKED; do not declare production
GO solely from CDP connectivity or a UI edit.

## Recover Edge authenticated semantic capability

Observed on 2026-10-23: Edge is open and has authenticated UiPath tabs.
Its provider is configured for CDP but returned BROWSER_ATTACH_FAILED.
The MCP correctly falls back to provider=native,
semantic_available=false. Chrome CDP is connected separately.
The Edge failure is a transport attachment issue, not a failure of
isolated Playwright or macOS automation authorization.

To restore the persistent Edge adapter, in the EXISTING Edge instance
inspect edge://inspect/#remote-debugging. If disabled, the operator
must enable the browser-managed debugging permission. This is separate
from Mac Bridge delegated authorization. The operator-run read-only
Edge CDP doctor can verify the local marker, actual attach and tab
identity, without printing URLs or tokens. The installed Mac bridge
cannot arbitrarily enable debugging on behalf of the browser.

After enablement, call browser_tabs(browser=edge). Require
provider=persistent, semantic_available=true, and a tab_ref, then
browser_inspect. Configured=true or cdp_attach_enabled=true alone
is NOT sufficient. No browser/process restart, profile migration,
permission bypass or guessed CDP port is authorized.

## Acceptance scenarios

| Test | Correct outcome |
| --- | --- |
| QA in isolated Chromium, Edge CDP down | Playwright QA proceeds |
| Authenticated Edge, semantic tab_ref valid | Browser MCP semantic actions |
| Edge provider=native, verified foreground actions authorized | Limited native fallback; no semantic claim |
| Semantic-only cell editor, Edge CDP down | BLOCKED_SEMANTIC_BROWSER |
| Finder/Terminal native tools not registered | BLOCKED_NATIVE_DESKTOP |
| Cell entered but value not persisted | Not accepted |
| GH04/GH05 definitions or evidence missing | BLOCKED, not production GO |
