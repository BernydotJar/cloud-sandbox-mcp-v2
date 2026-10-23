# Browser automation stability — Edge and Chrome native Mac driver

**Release candidate:** Source-only until operator Mac installation and real GUI acceptance.
**Scenario used:** Existing Edge corporate SSO tabs for HCL iTime and UiPath FinancialForce.
**Scope:** General Browser Automation across all agents/projects, not a custom timesheet script.

## Root causes observed

1. macOS/JXA AppleScript `Application('Microsoft Edge').windows()` returns
   ordered windows. Existing native code performs `target.index=1` whenever
   focusing/capturing; therefore the next operation can use a different
   window_index and/or tab_index and report `STALE_URL` / `STALE_TAB`,
   even though the correct authenticated tab is still open.
2. Browser-native screenshot requested `target.activeTabIndex`,
   `target.index=1`, `app.activate()` again on every capture. This can
   close an open native dropdown (e.g., UiPath Project/Assignments) and
   make its selection unobservable.
3. The installed Edge CDP adapter can return `BROWSER_ATTACH_FAILED`,
   independently of browser-native availability and independent Playwright
   QA. Do not force an Edge SSO task into a separate Chrome profile.

## Driver correction

- A target contains browser, window index, tab index, **exact title and
  sanitized exact URL** (no query/fragment). Indices are hints.
- If indexed lookup is stale, search for a UNIQUE exact URL+title across all
  current windows and tabs. Refuse an ambiguous match and any changed URL/title.
  Legacy index-only calls do not rebind.
- Before ANY native UI mutation, verify that only ONE matching tab exists.
  Fail closed on duplicates or if a different window becomes foreground.
- If a target tab is already foreground, screenshot bounds capture does NOT
  re-activate the app/window or change its active tab, preserving transient
  dropdown/focus state. If not foreground, a focus is necessary and is
  rechecked.
- Plain `focus` retains its browser-only Automation permissions and does
  not newly demand Accessibility.
- The same driver supports **Chrome and Edge** without copying profiles or
  using CDP, and preserves existing native approval and origin policies.

## Existing and changed APIs

The externally exposed **29 MCP tools are unchanged**. The patch is
`mac-host/native.jxa`, invoked by the existing macOS host through a new
`osascript` process for each operation. The hot-patch installer only replaces
this one file. `mac-host/bridge.mjs` has a source-only diagnostic whitelist
update for `AMBIGUOUS_NATIVE_TARGET`; until a separate approved bridge
restart, this rare error might be surfaced as `NATIVE_UNAVAILABLE`, but it
still fails closed. No Mac deployment has been made in this source commit.

**Screenshot limitation:** The existing screenshot is a crop of the native
window; agent click coordinates are desktop/screen coordinates. A cropped
image is not proof of the desktop origin (x,y). Don't translate an image
pixel into a global click without verified bounds; a future
screenshot-relative/AX semantic input layer should provide this in the
MCP API. Browser native fallback is NOT semantic Playwright.

## Operator deployment (one-file update, no browser restart)

Package source:
`deploy/edge-native-rebind/build-release.mjs` and
`deploy/edge-native-rebind/install-on-mac.mjs`.

After the source commit, create a hash-pinned handoff under the existing
operator Mac shared-auth deployment path. On the Mac, inspect first:

```bash
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/edge-native-target-rebind-20261023/install-on-mac.mjs" --inspect
```

Only if the preflight passes and no active delegated session exists, install:

```bash
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/edge-native-target-rebind-20261023/install-on-mac.mjs" --install
```

The installer refuses unknown/customized driver hashes, verifies an exact
known baseline, audits the existing Mac Bridge health without leaking tokens,
preserves a private backup, uses atomic same-filesystem rename, checks JXA
syntax before/after and rolls back automatically on failure. No Mac browser,
MCP controller, Docker container or launchctl service restart is involved.
A release package is **not** proof of actual installation.

## Acceptance: real Chrome + Edge with isolated browser QA

1. Read `computer_use_status` and `computer_use_session_status`;
   don't interrupt any other agent's active session.
2. `browser_tabs(edge)`: find an existing unique tab by exact title+URL.
   `computer_use_state(edge)` and screenshot. It must remain on Edge's
   original authenticated profile.
3. Force a **read-only stale hint** for the same URL+title after a real window
   order change; screenshot should return the correct tab, not STALE_TAB/URL.
   Never silently rebind when there are duplicate exact targets.
4. Open a benign native dropdown and screenshot it again without repeated
   focus. Validate it stays observable. If the browser itself destroys a
   popup on screenshot, log a separate browser/native menu limitation.
5. In a task-scoped authorized delegated session, perform a **benign UI
   action** and independently inspect the result; no timesheet writes in
   this infrastructure acceptance.
6. Repeat a minimal identification/capture check for Chrome's own profile.
   Chrome persistent CDP may remain active; neither browser depends on the
   other's debugging endpoint.
7. Run Playwright in isolated Chromium (desktop/mobile/keyboard/ARIA)
   without accessing Mac tabs. Preserve Graph Harness evidence.
8. For Love's first real write, separately verify approved HCL assignment,
   UiPath project/milestone, all-category daily totals, actual hours,
   corporate permission and Graph Harness GH04/GH05 **pre-write policy
   approval**. Save one correct record, reload, verify persistence before
   repeating. Never touch Toyota Jira.

**GO only after installed Mac smoke + safe benign action succeed**.
No source-only pass is permission to write corporate timesheets.
