# Browser Automation Enforcement — Cloud Sandbox MCP V2

Version: 1.0.0
Applies to: every repository/agent that operates through the shared workstation
Status: source, test and CI policy implemented; **Mac driver installation is separately gated**

## Objective

Make browser choice, authenticated profile preservation, native fallback,
evidence quality and corporate-write proof a **tested contract**, not an
agent's opinion. Love's HCL iTime / UiPath FinancialForce in authenticated
Edge is the regression scenario, NOT a special-case selector or hardcoded
application adapter.

## Engine hierarchy and nonnegotiable boundaries

| Work | Preferred | Secondary | Hard stop |
| --- | --- | --- | --- |
| Ordinary web QA/E2E | Existing project Playwright | Isolated Playwright Chromium | Don't attach Mac personal profiles |
| Ordinary web navigation | Isolated Playwright | Project-specific isolated Playwright | Login redirect is AUTH_REQUIRED |
| Existing authenticated Chrome/Edge | Browser MCP semantic (if live provider= persistent and tab_ref exists) | Same browser's native Computer Use | Never switch Chrome/Edge or import cookies |
| Native read-only inspection when CDP fails | Native browser state/screenshot | None | Never call it semantic E2E |
| Native foreground navigation | Native browser action (task-specific grant) | None | Deny if wrong/ambiguous target or no consent |
| Native write | Native only with explicit permission, correct target and independent persisted readback | None | No Save/Submit based only on performed=true |
| Finder, Terminal, VS Code | Native desktop Computer Use (when exposed/authorized) | Scoped deterministic shell/API | Browser tools don't imply desktop AX |

- CDP is a transport. Playwright is an automation/testing framework; it does
  not require CDP on the *existing Mac Edge session* when it launches its
  own isolated Chromium.
- Existing authenticated Edge sessions stay in Edge, including specific
  enterprise profiles and SSO state. Never substitute Chrome for convenience.
- Browser MCP's `provider=native` returns transient indices, safe URL/title
  and `semantic_available=false`. Native screenshots/interaction can be
  useful even when CDP has `BROWSER_ATTACH_FAILED`; they cannot establish
  ARIA role/label evidence or semantic GH acceptance on their own.
- For existing Mac browser navigation, `native_fallback_approved=true`
  is necessary before any native action. Read-only discovery and screenshots
  may proceed without an action grant when the existing Mac browser session
  was explicitly requested. OS permissions still apply.
- The live Mac Bridge enforces its origin allowlist, delegated-session scope
  and expiration. A CLI policy selection does NOT create permissions.
- An active delegated session belongs to one workflow. Never reuse another
  agent's grant or race the same desktop mouse.
- Never retry a UI mutation whose outcome is uncertain. Read the actual
  application state first. A native event receipt is not proof of persistence.

## Executable policy and enforcement locations

1. **Decision engine**:
   `scripts/browser-automation/engine-router.mjs`. Required capabilities
   must be actually observed through `browser_runtime_status`,
   `browser_tabs` and/or isolated Playwright preflight, not invented.
   This returns a structured selection/blocked decision with allowed operations,
   authorization prerequisites and evidence expectations. A pure router
   never dispatches actions.
2. **Executor boundary**:
   `scripts/browser-automation/run.mjs` calls that router before launching
   isolated Chromium and calls `acceptance-gate.mjs` after collecting an
   actual screenshot. An authentication redirect is blocked, never
   claimed as a business-ready login.
3. **Evidence acceptance structure**:
   `scripts/browser-automation/acceptance-gate.mjs`. Rejects wrong browser,
   personal-profile substitution, missing trace/assertions, native
   non-semantic claims, unauthorized or unverified writes and incomplete
   persisted-readback evidence. Even when structural evidence is complete,
   `production_go` is **always false** until independent attestation.
   SHA-256 artifact references must point to evidence actually verified
   separately by Graph Harness. The policy gate validates structure,
   not the provenance or truth of arbitrary agent-supplied references.
4. **MCP tool/schema boundary**:
   `src/mcp/server.ts` and `src/services/computer-use-service.ts`
   require a fresh nonblank `expected_title` for native screenshot,
   focus and action before forwarding a request. This prevents a controller
   client from treating a stale numeric tab index as an identity.
   These source-level changes are NOT active in the customized installed
   MCP controller until its guarded release is deployed.
5. **Actual Mac mutation boundary**:
   `mac-host/bridge.mjs` (origin allowlist, task-scoped grant,
   action validation, audit) and `mac-host/native.jxa`
   (fresh title+URL, unique target, frontmost verification, no gratuitous
   screenshot focus). Driver hot-patch is in
   `deploy/edge-native-rebind`. **Source tests are not Mac deployment.**
6. **Continuous integration**:
   `npm run test:browser:policy` is mandatory within `npm run verify`
   and in `.github/workflows/browser-runtime-v2.yml`.
   The workflow additionally compiles and probes the native JXA driver
   on a macOS runner without touching personal browser profiles. The
   CI job must be a required check in repository branch rules to
   prevent merging a red build.

## Operator protocol for any agent

For ordinary web QA, run the existing Playwright suite, else isolated
Chromium; evidence must contain actual tests/assertions, screenshot/trace,
responsive configurations and test identities. Do not automatically
attach Chrome/Edge on macOS.

For a user-selected authenticated Mac Edge/Chrome session:

1. Check `computer_use_status`, `computer_use_session_status` and
   `browser_runtime_status`. Rediscover exact requested browser/tab
   with `browser_tabs(browser)`. Do not infer a persistent provider
   from the fact that CDP is configured.
2. If semantic persistent and `tab_ref` exists, use
   `browser_inspect`, the current revision and semantic actions with
   unique request IDs and a scoped grant. Inspect after each action.
3. If `provider=native`, read the actual screen using a fresh
   title/URL target. The hardened native driver may safely rebind a
   stale index to a **single exact title+URL match**, but do not assume
   it has been installed merely because this source exists.
4. Native clicks/typing require user authorization, the correct
   allowlisted origin, fresh target identity, and an independently
   verifiable business result. Native screenshots should not
   repeatedly foreground already-focused windows.
5. For actual corporate writes, observe before state and all existing
   categories, verify correct project/date/row, record authorization,
   save once, reload the application, read back persisted state, and
   preserve content-addressed evidence references. Graph Harness must
   separately evaluate any GH04/GH05 or equivalent project gates.
6. Report PASS/FAIL/BLOCKED at the level justified by evidence.
   `performed=true` is only an interaction acknowledgment;
   `EVIDENCE_COMPLETE` from structural validation is not
   independently proven data persistence or production GO.

## CLI examples

Router decisions are computed without network/GUI side effects:

```bash
node scripts/browser-automation/engine-router.mjs '{"task":{"kind":"web","intent":"qa"},"capabilities":{"isolated_playwright":true,"project_playwright_suite":true}}'
node scripts/browser-automation/engine-router.mjs '{"task":{"kind":"web","intent":"qa","browser":"edge","context":"existing_mac","explicitly_requested_mac_session":true},"capabilities":{"browser_provider":"native","native_browser_available":true}}'
npm run test:browser:policy
npm run verify:v2
```

Acceptance gate can be imported by project QA tooling:

```js
import {assessBrowserEvidence} from './scripts/browser-automation/acceptance-gate.mjs';
const result=assessBrowserEvidence({task,decision,evidence});
if(result.state!=='EVIDENCE_COMPLETE') {
  // Record BLOCKED with exact missing evidence; don't report GO.
}
```

The gate requires content-addressed artifact references, a matching browser/
profile, an action receipt, applicable approvals, the exact record identity
(project/date/row), category coverage when required, and a separate
post-reload readback with matching record and value digests for writes. A claimed hash or approval supplied
by an agent does not itself attest real authenticity.

## Versioning and rollout safety

The source driver hardening was committed in `d4c0323`, and the
single-file Mac handoff is at:
`/shared-auth/deployment/handoff/cloud-sandbox-computer-use/edge-native-target-rebind-20261023`.

The Mac installer checks the installed source hash, rejects unknown code
drift and active sessions, verifies an immutable manifest, backs up before
an atomic file change, and does not restart Chrome/Edge, Docker or MCP.
A legitimate user/operator must run its Mac-side `--inspect` and
`--install` steps. Verify the installed native driver SHA and run a
real Edge/Chrome smoke afterwards before declaring native target recovery
operational in production. Existing personalized corporate profiles remain
independent.

## Acceptance/GO conditions

For **platform Browser Automation**:
- isolated Playwright assertions and visual/mobile QA PASS;
- authenticated Edge + Chrome independently identified, with no profile swap;
- native driver properly deployed on Mac and exact-tab rebind smoke PASS;
- native action + screenshot target consistency and live dropdown inspection PASS;
- ambiguous target, stale identity and revoked-session cases fail closed;
- no unauthorized origin mutation, no duplicated uncertain event;
- signed/attested Graph Harness evidence for the release.

For a **Love's timesheet transaction**, add: verified corporate assignment
and milestone, 19–23 October dates, real 8-hour daily work, all-category
zero/holiday reconciliation, correct delegated authorization, GH04/GH05
approval rules and first supervised save followed by a persisted readback.
No Toyota Jira modifications. These are separate gates; CI does not
pre-authorize a time entry.
