# Playwright-first engine-routing acceptance - 2026-10-23

Status: **source policy accepted with a local-workspace lint caveat**.
No live Mac bridge or browser configuration was deployed or restarted.

## Source change

- Global workstation `/workspace/AGENTS.md` updated to prefer Playwright
  for ordinary web UI work; the shared file is outside Git.
- Repository `AGENTS.md`, `ENGINE_ROUTING.md`, and browser-runner documentation
  now distinguish Playwright, Browser MCP/CDP, native Mac apps and shell/API work.
- `scripts/browser-automation/engine-router.mjs` implements deterministic
  capability selection with explicit existing-session authorization gates.
- The isolated `run.mjs` diagnostic now calls that selector before launch and
  reports the selected engine and policy version in the JSON result.
- `npm run test:engine-routing` is integrated into `npm run verify`.

## Observed checks

| Gate | Result | Evidence |
| --- | --- | --- |
| Router + existing policy tests | PASS | `npm run test:engine-routing`, 14/14 |
| Isolated Playwright real-browser smoke | PASS | Chromium headless, 390x844, es-GT; role-based click and observed status assertion |
| TypeScript | PASS | `npm run typecheck` |
| Unit tests | PASS | `npm test`, 27/27 |
| Existing Mac bridge compatibility tests | PASS | `npm run test:mac`, Linux simulation only |
| Lockfile consistency | PASS | `npm run validate:lock` |
| Owned router + runner ESLint | PASS | ESLint on changed JS files |
| All-source ESLint with unrelated untracked WIP excluded | PASS | `eslint . --ignore-pattern deploy/browser-channel-providers/edge-cdp-diagnosis.node-test.mjs` |
| Unfiltered full-worktree ESLint | FAIL (unrelated WIP) | untracked `edge-cdp-diagnosis.node-test.mjs:34` uses undefined `URL` |
| Actual Mac-host deployment | NOT ATTEMPTED | unchanged host settings and existing sessions |
| Browser CDP Edge repair | NOT IN SCOPE | Playwright isolated remains available without Edge CDP |
| Full `verify:v2` and production rollout | NOT RUN | storage-guard reported 34.15 GiB free, under checkout/job threshold |

## Risk and authorization limits

The routing module is pure policy, not a replacement for the live MCP
controller; agents must follow the decision and prove actual provider
capabilities before dispatch. Browser MCP actions and native Mac mutations
retain their separate task-scoped permissions. This change does not copy
cookies or tokens, elevate macOS privileges or change personal browser profiles.

Untracked Edge diagnostic files were deliberately preserved and not committed.
No independent production GO/NO-GO attestation is claimed.
