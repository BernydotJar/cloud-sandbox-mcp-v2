# Browser Automation — behavioral reinforcement baseline

Date: 2026-10-23, time zone America/Guatemala
Repository: cloud-sandbox-mcp-v2
Branch: feat/computer-use-runtime-v2
Scope: policy preflight and deterministic agent decision evaluations

## Source changes

- `scripts/browser-automation/agent-preflight.mjs` validates an agent's
  proposed engine, operation, browser/profile, fresh exact title+URL target,
  unique match, scoped authorization metadata, observed origin allowlist,
  record identity and post-reload readback plan. It is deliberately pure:
  it never calls the live Mac or grants permission.
- `scripts/browser-automation/reinforcement-eval.mjs` executes versioned
  adversarial fixtures and requires 100% critical pass rate.
- `docs/computer-use-v2/evals/agent-behavior-v1.json` contains 28 synthetic
  critical cases. Dataset SHA-256:
  `5b167de439bd99dde9f7fb57ad349ebb8e879e627db786d16e412ab67271ffe0`.
- `scripts/browser-automation/reinforcement-eval.node-test.mjs` includes
  negative-control assertions; a fabricated expected PASS on a denied
  operation fails the suite.
- `scripts/browser-automation/run.mjs` now executes the same preflight
  for actual isolated Playwright navigation and emits its verdict.
- `npm run test:browser:reinforcement` is wired into `npm run verify`
  and GitHub Actions; `npm run -s browser:agent-preflight` is the
  operator/agent-facing entrypoint.
- Shared `/workspace/AGENTS.md` and the repository `AGENTS.md` require
  that future agents use the preflight and add anonymized regression cases.

## Observed results

| Gate | Observed outcome |
| --- | --- |
| 28 deterministic adversarial cases | PASS 28/28, critical pass rate 100% |
| Harness self-tests | PASS 8/8 |
| Browser routing/structural acceptance tests | PASS 36/36 |
| Controller TypeScript tests | PASS 29/29 |
| Mac host simulated driver tests | PASS 178, 1 skipped |
| Typecheck/build/ESLint (excluding other agent's untracked Edge doctor WIP) | PASS |
| Real isolated Playwright navigation | PASS |
| Browser semantic E2E | PASS |
| Offscreen isolated browser gesture QA | PASS 25/25 |
| Release and rollback simulations | PASS |
| Live agent autonomous behavior evals | NOT RUN — deterministic policy fixtures only |
| Live Mac patched driver acceptance | NOT RUN; operator installation still required |
| GitHub CI on committed changes | NOT RUN until pushed / workflow started |
| Independent Graph Harness release acceptance | NOT ATTESTED |

## Actual isolated Playwright run

Command: `node scripts/browser-automation/run.mjs reinforcement-smoke-20261023 https://example.com/`.

- Engine: `playwright_isolated`
- Preflight: `PLAN_VALIDATED`
- Status: `page_loaded_not_auth_verified` (never a login claim)
- Evidence verdict: `EVIDENCE_COMPLETE / NAVIGATION_OBSERVATION_PRESENT`
- Scope: `navigation_only`
- `production_go=false`
- 2 artifacts (PNG screenshot and trace ZIP) under
  `/workspace/.browser-automation/evidence/reinforcement-smoke-20261023/`.
- Screenshot SHA-256:
  `e16278c6367d01c61d163a612b08f6b2a0b4347e5ea515b5b0b14ded4332df50`.
- Trace SHA-256:
  `a64c5ca830cea43a943d3f8b007011075f7de5fd59bccea81df45499a506ce8b`.
- JSON report SHA-256 before adding preflight_code:
  `0ffc5706038ce7ad95128081598d1ed336e23bb2a68eb1d53ed4b10aedf1ac12`.

## Safeguards and limitations

A prior regression test uncovered a concrete policy error: the native
Edge read-only inspection route could incorrectly be proposed as a
semantic `run_qa`. The rule was fixed to allow only `inspect`
when the native provider is `NATIVE_INSPECTION_ONLY`; the adversarial
case `EDGE-011` now prevents recurrence.

The preflight checks agent-submitted metadata **structurally only**.
Live host origin, delegated-session ownership and exact target still
need authoritative runtime verification. The evidence gate separately
requires independent business readback and Graph Harness attestation.
Passing these fixtures does not retrain an LLM, prove every agent
complies, authorize corporate writes or constitute production GO.

The complete workspace `npm run verify:v2` remains blocked by a
third-party/concurrent untracked work-in-progress file:
`deploy/browser-channel-providers/edge-cdp-diagnosis.node-test.mjs`
(`URL is not defined`). It was preserved untouched; the feature code
passed full ESLint with only that unrelated untracked diagnostic omitted.
No browser, service, session or Mac profile was restarted or modified.
