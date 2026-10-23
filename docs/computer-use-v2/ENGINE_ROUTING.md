# Cloud Sandbox MCP V2 - capability-based engine routing

## Normative default: Playwright-first for web UI

For ALL ordinary web UI tasks (navigation, forms, visual inspection, UI/UX,
regression, E2E, accessibility and stress journeys), use Playwright FIRST:
1. Reuse the project's existing Playwright suite when it can run in isolation.
2. Otherwise use Playwright + isolated headless Chromium in dev-main.
3. If the user explicitly requires a different browser engine, use the exact
   Playwright browser channel only when installed; do not silently substitute.
4. A request to reuse an ALREADY AUTHENTICATED Mac Chrome/Edge tab is a distinct
   case: use Browser MCP for that exact authorized session and select its best
   available semantic provider. Do not attempt an anonymous Playwright profile
   and present it as the authenticated session.
5. If Browser MCP CDP is unavailable, native read-only screenshots and state
   inspection may still continue on the expressly requested existing Mac
   profile; native observations are DIAGNOSTIC ONLY for semantic E2E.
   Native foreground navigation requires explicit task-scoped permission and
   fresh exact tab identity. Native writes additionally require the task to
   allow non-semantic UI and the final business outcome to be independently
   verifiable. Coordinates are a LAST resort.
6. For Finder, Terminal, VS Code and other macOS desktop apps use the native
   Mac Computer Use surface, not a browser driver. For deterministic shell/API
   tasks prefer scoped shell/API execution rather than simulating keystrokes.

This is the browser-default standard for ALL agents using this workstation,
not only UiPath, LUMA, Meridian or a single user workflow. Browser MCP is a
tool interface; CDP is a transport; Playwright is an automation framework.
The *isolated Playwright QA* runtime is independent of an authenticated
operator browser. The installed Browser MCP persistent adapter uses
`playwright-core` and `chromium.connectOverCDP` for attached Chrome/Edge
sessions. That adapter does NOT make CDP mandatory for isolated Playwright.

The tested pure selector is
`scripts/browser-automation/engine-router.mjs`.
It makes routing decisions only: it cannot launch apps, authorize sessions or
act on pages. Before passing capabilities to it, agents must probe the actual
runtime; flags such as `configured=true` are not proof of a working provider.

Example - isolated browser with actual isolated Playwright capability verified:

```bash
node scripts/browser-automation/engine-router.mjs \
  '{"task":{"kind":"web","intent":"qa"},"capabilities":{"isolated_playwright":true}}'
```

Expected: `engine=playwright_isolated`, `code=PLAYWRIGHT_DEFAULT`.
If a project suite is present, set `project_playwright_suite=true` and prefer
`playwright_project`. For existing authenticated Mac sessions, pass
`context=existing_mac`, `browser=chrome|edge`,
`explicitly_requested_mac_session=true`, and ONLY actual tab capabilities.
The router never exports or imports cookies and never authorizes itself.

## Capability and execution decision matrix

| Task | Preferred engine | Alternate | What cannot be inferred |
| --- | --- | --- | --- |
| Web QA/E2E | Project Playwright | Isolated Playwright Chromium | Mac browser/CDP health is irrelevant |
| Ordinary web navigation/forms | Isolated Playwright | Project-specific Playwright workflow | Existing Mac login is NOT shared |
| Web UI requiring existing authenticated Chrome/Edge | Browser MCP with semantic provider (including Playwright/CDP when healthy) | Explicit, verifiable native foreground browser action | Native does not equal semantic Playwright |
| Exact Edge or Chrome browser-specific regression | Isolated Playwright with exact available browser channel | BLOCKED_EXACT_BROWSER | Never silently swap browser engines |
| Native Finder/Terminal/VS Code | Native macOS Accessibility (if exposed/authorized) | Approved deterministic CLI/API for equivalent tasks | Browser MCP does not control arbitrary Mac windows |
| Deterministic CLI/API operation | Scoped shell/API | Explicit user-requested UI workflow | A command result is not a browser E2E assertion |

Playwright isolation means independent browser processes/contexts, controlled
permissions, traces, screenshots and selectors by role/label/test-id. Avoid
persistent profiles for test identities unless required. Use the Chessy browser
QA pattern. Do not touch Mac Chrome/Edge tabs or foreground a window by default.
For a task that needs authentication in isolated Chromium, return AUTH_REQUIRED
and use an approved isolated login handoff; do not transfer personal cookies,
passwords, OTPs, local storage or browser profiles.

The browser selection must be made by *required capabilities, authorization,
and evidence expectations*, not by a fixed CDP preference. Do not guess ports,
automatically restart browsers, disable browser security warnings, or bypass MFA.
No fallback may silently change the user's requested browser or account.

## Existing authenticated Mac tab: execution contract

1. Confirm the user expressly requested the existing Mac session. Consult
   `computer_use_status`, `browser_runtime_status`, `browser_tabs(browser)`.
2. If `provider=persistent`, `semantic_available=true` and a real `tab_ref`
   exists, choose Browser MCP semantic tools. Get the current revision, then
   use exact role/label/test-id selectors and a task-specific delegated grant
   for any mutation; do not reuse another agent's session.
3. If `provider=native` and `semantic_available=false`, this is not
   a semantic browser. Only consider native fallback after explicit authorization,
   fresh native target identity/screenshot, and proof that the task can be
   independently verified. Coordinate clicks are the LAST resort.
4. If a cell editor or other task requires strict semantic row/column identity,
   and only native coordinate fallback is available, return
   `BLOCKED_SEMANTIC_BROWSER` for that step. Other isolated Playwright QA
   proceeds independently.
5. Never retry an uncertain UI mutation blindly. Read back persisted values;
   use distinct Graph Harness gates for click, application acceptance, and
   independent persistence verification.

A failure of `chromium.connectOverCDP` for an authenticated Edge profile
is a failure of that *particular attached transport*, not of independent
Playwright. Repair of Edge CDP is an optional diagnostic/workstream, NOT a
prerequisite for routine web UI automation.

## Native macOS desktop status and permissions

Native macOS general-purpose app control is not exposed through the
browser-specific MCP tool registry currently observed. The operator has
reported that a separate agent opened Terminal and executed curl on the Mac;
this is a functional smoke test of a Mac execution path, not proof that
`mac_list_apps`, `mac_accessibility_tree`, `mac_focus_window` and
`mac_open_app` are all installed in the current MCP registry. Where general
desktop tools are absent, return `BLOCKED_NATIVE_DESKTOP` rather than
claiming Browser MCP tabs can control Finder or Terminal. The desktop MCP
extension remains subject to its separate rollout/permission gates.

## UiPath website cell-entry transaction

Separate the **source skill** (data extraction/validation) from the
**UI adapter** (web-cell writes). Neither source data nor successful sign-in
proves that specific rows were updated. Capture before state, identify each
row/column by stable labels, type and expected value, and prefer exact semantic
browser controls in the authenticated session. For isolated test identities,
Playwright is preferred. A live Edge session must not be replaced with an
anonymous Chromium login. On authenticated Browser MCP failure, block only
the unsupported step instead of declaring all browser automation broken.

After entry, read back the target row and verify its **persisted value** after
save or reload where supported. Collect redacted before/after evidence,
action count, engine, and row-level outcome. Native coordinate input cannot
satisfy semantic evidence requirements by assertion alone.

## Graph Harness release gates

A successful login, allowlisted URL, CDP connection, browser click, and
persisted cell value are independent facts. GH04/GH05 are project-specific
Graph Harness gates: read the actual acceptance definitions. Mark evidence
PASS, FAIL or BLOCKED; missing verification is not production GO.

## Acceptance scenarios

| Scenario | Required result |
| --- | --- |
| Ordinary QA with Chrome/Edge CDP down | Playwright project suite or isolated Chromium |
| Existing authenticated Edge explicitly requested, semantic tab ready | Browser MCP semantic provider with session grant |
| Existing authenticated Edge, native-only, strict semantic form | BLOCKED_SEMANTIC_BROWSER, not unverified coordinates |
| Web task requests browser-specific Edge but only Chromium available | BLOCKED_EXACT_BROWSER |
| Isolated browser login required, only Mac account authenticated | AUTH_REQUIRED; never copy cookies |
| Finder/Terminal desktop tool missing | BLOCKED_NATIVE_DESKTOP |
| Native fallback cannot prove persistent save | BLOCKED for that action |
| Browser UI edit with missing GH04/GH05 evidence | BLOCKED, not production GO |

See `mac-host/engine-routing.node-test.mjs`,
`scripts/browser-automation/engine-router.node-test.mjs`,
`scripts/browser-automation/README.md`,
`docs/computer-use-v2/OFFSCREEN_QA.md` and the shared
`/workspace/AGENTS.md` for the agent-facing entrypoint.


## Enforced acceptance and CI contract

This repository now has an executable evidence gate:
`scripts/browser-automation/acceptance-gate.mjs`.
The generic isolated browser executor applies it to actual screenshot
artifacts. Native screenshots with `semantic_available=false` can support
visual troubleshooting but never become passing semantic E2E assertions.
A business mutation cannot receive evidence-complete status based on
`performed=true` or a filled field alone: it needs task approval, before
and after observations, audit receipt, separate post-reload readback and
matching recorded value digests. A matching digest declaration is still
only a structural check; Graph Harness must verify provenance and actual
corporate authorization. The acceptance gate always sets
`production_go=false`.

`npm run test:browser:policy` executes the routing/acceptance/installer
policy tests; `npm run verify` runs that suite, and GitHub Actions runs
the same independent gate plus a syntax-only macOS driver compile.
See `docs/computer-use-v2/BROWSER_AUTOMATION_ENFORCEMENT.md`.
