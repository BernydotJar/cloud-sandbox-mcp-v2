# Browser Automation — Agent Reinforcement Loop

**Scope:** all Cloud Sandbox MCP V2 agents and projects, including Claude Code, Gemini,
Codex and ChatGPT agents that load the shared workstation contract.
**Version:** 1.0, 2026-10-23.
**Purpose:** make known agent failures repeatably detectable rather than hoping
the next model obeys a longer prompt.

This is **behavioral reinforcement by policy, deterministic evaluations and
feedback**. It does not fine-tune or change the weights of an LLM.

## Runtime loop

```text
Task request / existing application session
    |
    v
1. Inspect actual provider / browser / authorization scope
    |
    v
2. Declare task + observed capabilities + proposed action plan
    |
    v
3. Run agent-preflight -> PLAN_VALIDATED | BLOCKED
    |                         |
    |                         +-- STOP the unsupported action;
    |                             report the exact missing evidence and
    |                             continue independent safe steps.
    v
4. Execute using actual Playwright / Browser MCP / native Mac / scoped API
   (Mac host retains final session/origin/target enforcement)
    |
    v
5. Observe effect -> Save/reload/readback where business data changes
    |
    v
6. Run acceptance-gate -> evidence structure only;
   independent Graph Harness remains the release authority
    |
    v
7. On failure, add anonymized adversarial case + regression before repair
    |
    v
8. CI: ALL critical behavior evals must pass before integration
```

## Agent-preflight contract

**Authoritative code:** `scripts/browser-automation/agent-preflight.mjs`.

Inputs are structured as:

```json
{
  "task": {
    "kind": "web",
    "intent": "qa",
    "context": "isolated",
    "browser": "chromium"
  },
  "capabilities": {
    "isolated_playwright": true
  },
  "plan": {
    "engine": "playwright_isolated",
    "operation": "run_qa"
  }
}
```

Use stdin instead of CLI arguments, to avoid exposing task data in process
lists or shell history. No passwords, session tokens, cookies, OTPs or personal
information belong in the input.

```bash
cat /path/to/redacted-agent-plan.json | npm run -s browser:agent-preflight
```

Exit 0 = `PLAN_VALIDATED`. Exit 3 = `BLOCKED`.
Exit 2 = invalid request. All output includes
`dispatch_authorized=false` and `production_go=false`.
A plan passing validation **cannot** establish real Mac session consent,
actual origin-allowlist membership, genuine identity or production readiness;
the host and project-specific gates still enforce those facts.

For authenticated Mac Chrome or Edge, a plan includes an observed exact
browser, sanitized HTTPS URL, exact title, fresh numeric indices and unique
match count. An action also needs its own scoped delegated-session claim,
content-addressed authorization reference and live origin policy status.
The Mac Bridge must still independently validate all claims immediately
before acting. Existing corporate browser profiles must NEVER be swapped.

For a corporate Save, the plan must also include proof that it identified
the exact record (project/date/row), checked duplicates and all categories
when applicable, documented corporate approval where required, and planned
a real post-reload readback. "Click performed" is not proof of saving.
Explicit Submit for Approval is a separate operation requiring additional
authorization.

## Adversarial evaluation harness

**Cases:** `docs/computer-use-v2/evals/agent-behavior-v1.json`.

They are synthetic fixtures (no corporate credentials) representing
recurring failure modes: Edge CDP down while native screenshots work,
window/title drift, duplicate tabs, wrong browser/profile substitution,
no task-scoped grant, origin denied, missing project/date/row identity,
unverified Save and unauthorized approval submission.

Run:

```bash
npm run test:browser:reinforcement
```

The suite requires **100% pass rate for all critical scenarios**, including
negative controls; altering expected answers to make an unsafe action pass
is detected by its unit tests. `npm run verify` and the GitHub workflow
run this gate. The JSON evaluation report contains only case IDs,
expected/verdict codes and status, not screenshots or user data.

**The harness tests our deterministic plan policies, not whether a future
LLM will spontaneously choose to call it.** The shared `AGENTS.md` makes
the preflight mandatory for compliant agents. The isolated Playwright
runner also calls it before browser launch. Mac host policies and MCP
tool schemas remain the hard boundary for actual UI mutations. A full
live agent-trace evaluation remains a separate acceptance activity.

## How a bad execution becomes reinforcement

1. Record a **sanitized** failure with the engine used, attempted operation,
   failure code, environment/version and expected behavior. Never log
   company data, personal tabs, private URLs, credentials or actual session IDs.
2. Identify the root cause: bad routing, missing capability, stale target,
   unauthorized origin, fabricated semantic evidence, race with another
   agent, or incomplete persistence readback.
3. Add a new distinct critical case to `agent-behavior-v1.json` with an
   expected `BLOCKED` or `PLAN_VALIDATED` outcome. The original
   failing policy should make that test fail.
4. Correct the **code boundary or policy**. Do not merely add a sentence to
   a prompt. Confirm the new test and all previous tests pass.
5. Run isolated Playwright; then the appropriate Mac/browser acceptance.
   Compare with previous baselines. Store content-free evaluation results
   and exact code SHA as Graph Harness evidence.
6. Promote only after required CI, independent review, live Mac/Chrome/Edge
   smoke (for native changes), and the normal rollout/rollback gate.

## Case map from the Love's incident

| Incident | Permanent regression |
| --- | --- |
| "Edge CDP down means Edge unusable" | EDGE-001, WEB-003 |
| "Switch to Chrome, even though profile belongs to Edge" | EDGE-002, EDGE-003 |
| Native GUI popup disappears / stale tab | EDGE-007..010 plus `mac-host/native.node-test.mjs` |
| Native screenshot falsely equals semantic test | EDGE-011 |
| Another agent owns current session | EDGE-013 |
| Click performed, no reliable Save readback | WRITE-001, WRITE-002 + acceptance-gate |
| No exact date/project/row or category coverage | WRITE-005..007 |
| Save or approval submission with missing permission | WRITE-003, WRITE-007 |
| Isolated web login reuses personal browser credentials | AUTH-001 |
| Browser MCP used to claim macOS desktop control | DESKTOP-001 |

The real Love's entry may still be pending. Passing these synthetic cases
does NOT mean corporate hours were recorded or that GH04/GH05 passed.

## Operational targets

- **100%** critical deterministic eval pass rate.
- **0** profile substitutions, native actions without session approval,
  or false persisted-save claims.
- **0** claims that Edge CDP failure implies Playwright isolation is broken.
- **0** ambiguous tab selection after a stale index.
- For every live corporate write: an independently verified persisted
  record, not merely an action receipt.
- For native-driver changes: real Mac acceptance on both browsers and a
  tested rollback before production GO.

Use one shared standard, one evaluator, a regression case per incident,
and Graph Harness as the independent acceptance layer. More agents should
reuse this same contract, not duplicate different snippets of advice.
