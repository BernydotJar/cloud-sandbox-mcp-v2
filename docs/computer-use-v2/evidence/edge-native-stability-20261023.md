# Native Chrome/Edge Browser Automation stability — source verification
Date: 2026-10-23, timezone America/Guatemala

## Pre-change live observation

- Cloud Sandbox MCP V2: macOS bridge enabled and connected.
- Chrome's authenticated persistent CDP provider: connected.
- Edge's authenticated CDP provider: BROWSER_ATTACH_FAILED (16 failures
  at inspection), but native browser discovery yielded Edge corporate tabs.
- Real user task: HCL iTime and UiPath FinancialForce Timecards, both in
  existing Edge tabs with different enterprise profiles from Chrome.
- Native screenshot/interaction had intermittent STALE_TAB, STALE_URL and
  TARGET_CHANGED because window/tab indices could change after focus.
- No actual corporate timesheet write has been verified; Graph Harness
  GH04/GH05 remain business gates independent of browser infrastructure.

## Engineering fix

- Native AppleScript/JXA resolves a transient stale index to a unique exact
  safe URL and title, refusing ambiguous/changed/no-title actions.
- Before global keyboard or mouse dispatch, validate exact browser front tab.
- Already-frontmost screenshot does not foreground the app again, preserving
  transient native selection menus when macOS permits.
- Original Chrome/Edge profiles and CDP configuration remain separate.
- An explicit rollback-capable Mac operator handoff is prepared.
- Exact timecard selection and business save/readback remain out of scope of
  this infrastructure source test; they require real corporate approvals.

## Verified checks (Linux workstation / simulated native driver)

| Test | Observed result |
| --- | --- |
| Native JXA driver + bridge HTTP cases | 62/62 PASS |
| Full Mac bridge host tests | 178 PASS, 1 platform-specific SKIP |
| Installer fail-closed/unit tests | 3/3 PASS |
| MCP/Node unit tests | 27/27 PASS |
| TypeScript static gate | PASS |
| Lint, excluding unrelated untracked Edge doctor WIP file | PASS |
| Isolated browser E2E | PASS |
| Isolated Playwright offscreen gesture QA | 25/25 PASS |
| Release simulations (older installers) | PASS |
| Actual source integrity package Mac install | **PENDING** |
| Native GUI smoke on physical Mac | **PENDING** |
| First HCL/UiPath authorized save + persisted readback | **PENDING** |

Note: full unfiltered ESLint currently encounters another agent's
untracked `deploy/browser-channel-providers/edge-cdp-diagnosis.node-test.mjs`
with `URL is not defined`. This file was not modified or committed here.

## Release policy

No Mac host, Chrome/Edge browser, controller, or container was restarted
during source testing. The staged installer is driver-only and refuses an
unexpected installed hash or an active Computer Use session. Successful
source tests are **not** production acceptance. After Mac installation,
read-only tab discovery and screenshots plus an explicitly approved benign
UI action must be tested in both browsers. Maintain isolated Playwright as
the default for independent web QA.

## Business-level acceptance (Love's)

Resolve live project/assignment identity, select exact week/day cells,
confirm 8 actual hours, check other categories and corporate holidays,
and verify UiPath/HCL project-to-workstream attribution. GH04 requires
live identity and coverage; GH05 requires current-revision corporate
policy approval before supervised save, then post-save real readback
evidence. Never touch Toyota Jira or mark unverified saves as submitted.
