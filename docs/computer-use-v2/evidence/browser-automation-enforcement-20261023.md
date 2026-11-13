# Browser Automation platform enforcement — validation record

Date: 2026-10-23 (America/Guatemala)
Target: cloud-sandbox-mcp-v2, branch feat/computer-use-runtime-v2
Scope: executable source policy, MCP schema, evidence gate, CI and shared agent instructions.

## Enforced source changes

- Browser routing `scripts/browser-automation/engine-router.mjs`:
  project Playwright/isolated Chromium by default; explicit authenticated
  Chrome/Edge branch; native read-only inspection when CDP unavailable;
  native navigation and writes remain gated by consent, identity,
  independent verification and no profile substitution.
- Structural acceptance `scripts/browser-automation/acceptance-gate.mjs`:
  wrong browser/profile, missing assertion/trace, missing authorization,
  missing project/date/row identity, absent category coverage and
  unverified post-reload persistence cannot pass.
- Isolated browser runner `run.mjs` emits `acceptance_gate`,
  `production_go=false` and a SHA-256 reference for an actually
  captured screenshot.
- MCP `src/mcp/server.ts` requires exact `expected_title` together
  with expected_url and temporary indices for native focus, screenshot
  and action. `ComputerUseService` rejects missing title before making
  a host request. Source-only until controller rollout.
- `npm run test:browser:policy` added to `npm run verify`, plus
  an explicit workflow check in `.github/workflows/browser-runtime-v2.yml`
  and macOS native JXA syntax/probe stage (CI run still pending).
- Shared `/workspace/AGENTS.md` updated for future agents, and
  `AGENTS.md`, `ENGINE_ROUTING.md`, `BROWSER_AUTOMATION_ENFORCEMENT.md`
  describe the normative contract.

## Observed validation

| Check | Result |
| --- | --- |
| Browser policy + acceptance + installer guard | PASS 36/36 |
| TypeScript/controller unit tests | PASS 29/29 |
| Mac bridge simulation tests | PASS 178 / SKIP 1 |
| Browser semantic E2E fixtures | PASS |
| Playwright isolated offscreen | PASS 25/25 |
| Release/rollback simulations | PASS |
| ESLint excluding unrelated untracked Edge doctor WIP | PASS |
| Lockfile validation and TypeScript build | PASS |
| Whole-worktree `npm run verify:v2` | **FAIL** on unrelated untracked `deploy/browser-channel-providers/edge-cdp-diagnosis.node-test.mjs:34`: `URL is not defined`; this other agent's WIP was NOT edited or suppressed |
| macOS CI syntax gate | Configured in workflow; not yet executed on GitHub runner |
| Live Mac patched native driver | NOT VERIFIED INSTALLED |
| Live Mac patched MCP schema | NOT DEPLOYED |
| Corporate timesheet saves | NOT ATTEMPTED; still require GH04/GH05 |

## Actual isolated Chromium navigation proof

Command: `node scripts/browser-automation/run.mjs browser-policy-smoke-20261023 https://example.com/`
Observed: exit 0, `engine=playwright_isolated`,
`status=page_loaded_not_auth_verified`, initial and final origin
`https://example.com`, headless=true, no personal Mac tabs touched.

Local evidence under
`/workspace/.browser-automation/evidence/browser-policy-smoke-20261023/`:

| Artifact | SHA-256 |
| --- | --- |
| `a619a8b5-a80b-4828-b422-9c122f8c551e.png` | `e16278c6367d01c61d163a612b08f6b2a0b4347e5ea515b5b0b14ded4332df50` |
| `a619a8b5-a80b-4828-b422-9c122f8c551e.zip` | `8592e409a1400c268dd1a5975c7ea43e2dcafdef9e10a1f7d0168d0ee1e2f6e3` |
| `a619a8b5-a80b-4828-b422-9c122f8c551e.json` | `86d9a47040ed493617befb5bd24a2e0beaba4f686e4f9c6ea4228ba4439091f8` |

Runner acceptance result:
`EVIDENCE_COMPLETE` / `NAVIGATION_OBSERVATION_PRESENT` /
`scope=navigation_only` / `production_go=false`.
This is a navigation and tracing smoke test, NOT an authenticated
business interaction, persisted timesheet record or independent
Graph Harness GO.

## Live read-only bridge status at inspection

- Mac Computer Use connected and enabled; allowlist-only mutations.
- Existing authenticated Chrome persistent provider connected.
- Existing Edge persistent CDP provider continues to report
  `BROWSER_ATTACH_FAILED`; native Edge fallback remains independently
  discoverable.
- Delegated browser session inactive at the last status read.
- No Mac browser, session, MCP controller or service was restarted.
- Existing 29-tool customized deployment was not replaced.

## Release gate

NO-GO for **live native driver acceptance** until the Mac operator
installs the existing SHA-pinned single-file hot patch, executes
physical Chrome/Edge smoke tests including stale-index rebind,
dropdown persistence and non-disruptive capture, and a separately
reviewed MCP controller promotion adds the schema/runtime enforcement.
NO-GO for corporate time recording until independent per-record business
approval, all-category/date checks and persisted readback satisfy
the project-specific Graph Harness requirements.
