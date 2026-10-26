# Sandbox V3 — Adversarial Engineering Review (2026-10-26)

## Scope and evidence
Read-only tool calls to Sandbox V3: workspace_list, workspace_exec, browser_runtime_status, computer_use_status. Inspected source in src/index.ts, src/config.ts, compose.yaml, SECURITY.md, and current workstation. Ran `npm run test:browser:policy` (45/45 PASS) and `npm run typecheck` (PASS). No Mac host configuration, production tunnel, or controller process was changed during this review.

## Findings (prioritized)

| ID | Severity | Finding | Evidence | Disposition |
|---|---|---|---|---|
| SEC-01 | P1 — operator accepted, single-user | Public MCP accepts initialize without application-layer OAuth / bearer verification; URL path is a bearer-like secret. Request handler has no authentication middleware. Anyone with the path can attempt high-privilege tools. | src/index.ts POST handler; earlier external 200 initialize with No Auth plugin. | OPEN — BLOCK wider distribution and rotate exposed secret after authenticated ingress is deployed. |
| ARCH-01 | Accepted architecture | Root inside workstation, shared `/workspace/projects`, Docker access and persistent shared storage are intentional for this single-operator engineering environment. These are not remediation defects by themselves. | `id` uid=0, shared workspace, compose.yaml socket mount; operator decision 2026-10-26. | ACCEPTED — retain. Improve worktree coordination, backups and documentation without reducing access. |
| OPS-01 | P1 | Shared storage 96% utilized (20.32 GiB free out of ~461 GB at latest reading). | `df -h /workspace /shared-auth`. | OPEN — capacity alert, retention and safe cleanup plan; do not run prune automatically. |
| BROWSER-01 | P1 | Chrome CDP recovered during live test; Edge remains unavailable by CDP (56 failed attaches), native fallback read-only verified. Native fallback is not semantic CDP / Playwright. | browser_runtime_status 2026-10-26. | OPEN — diagnostic and parity acceptance. |
| CUA-01 | P1 | Delegation semantics mismatch between public tool contract (bounded max_actions) and bridge status reporting unlimited actions. | computer_use_status; tool schema. | OPEN — enforce caps server-side, verify revocation and session receipts. |
| BROWSER-02 | P1 | 5 uncertain browser actions and replay guarantee limited to live process session. | browser_runtime_status metrics. | OPEN — explicit post-action confirmation and restart-safe replay ledger. |
| DOC-01 | P1 | SECURITY.md claims no access to other workspace directories; observed single dev-main with many project checkouts under shared workspace. | SECURITY.md and workspace filesystem. | FIXED — documentation clarification in same review. |
| RELEASE-01 | P2 | Typecheck and 45 browser policy tests pass, but no live CDP/Edge E2E or adversarial authenticated/public authorization test executed. | test outputs. | OPEN — acceptance gate incomplete. |

## Remediation priorities

### Operator-accepted internal security risk, revisit before third-party access
1. Require real MCP authorization for POST/GET/DELETE tools requests (OAuth/OIDC or signed token validation with scope/expiry and per-tool authorization), fail closed. Do not treat DNS, CORS, Host allowlist, or URL secrecy as auth.
2. Apply authentication at the ingress and server; validate no unauthenticated tools/list or tools/call even with a leaked URL. Restrict who can install/use the plugin and disable site visitor access unless explicitly justified.
3. Rotate current public MCP path identifier after auth is established and update the plugin; verify old path is denied. Avoid putting it in logs and screenshots.
4. Keep privileged workstation, Docker socket, and shared persistent storage. If executing genuinely untrusted workloads in the future, use an explicitly separate optional worker rather than changing the default workstation.

### P1 hardening
1. Space watchdog at 80/90/95%, inventory largest safe candidates, backup before manual cleanup.
2. Distinct, explicit provider statuses: CDP connected, native fallback, semantic snapshot available, QA verified. No implicit PASS when fallback occurs.
3. Impose non-negotiable delegated-session action ceilings and explicit stop/revocation path; reconcile host bridge and MCP limits.
4. Persist idempotency receipts for browser mutations across process restarts. On uncertain results, inspect before retries.
5. Add external protocol negative tests: bad Host, absent auth, wrong auth, expired auth, missing tool scope; plus authorized initialize/tools/list, and logging redaction.

### Verification gates
- Security: unauthorized calls rejected; approved calls only with explicit scope; leaked path alone insufficient.
- Execution: shell, file, Git operations in designated workspace; cross-project boundary tests; Docker socket trust documented.
- Browser: Chrome and Edge live independent tests, native fallback visibly labeled, Playwright isolated E2E.
- Recovery: restart, disconnection, session revocation, idempotency, durable receipts.
- Operations: disk headroom and alerting; tunnel/service health; rollback.
- Release: source SHA + executed tests + evidence artifacts + operator approval.

## Recorded test results
- `npm run test:browser:policy`: 45 pass / 0 fail.
- `npm run typecheck`: PASS.
- Live MCP tool discovery and `workspace_exec`: PASS.
- Live Chrome CDP: PASS after read-only discovery and semantic inspect; Edge CDP: FAIL/attach failed, native fallback screenshot: PASS.
- External authorization tests: NOT EXECUTED during this run. Security finding is based on code inspection and earlier unauthenticated initialize evidence.

## Change safety
No deletion, prune, token rotation, tunnel restart, bridge mutation, or auth-breaking hotfix is performed automatically. High-impact P0 corrections require staged rollout, temporary allowlist and verified recovery channel.

## Operator architecture decisions — 2026-10-26
- **Root privileges: RETAIN.** Full administrative command capabilities in the workstation are required.
- **Shared project tree: RETAIN.** Worktrees, task ownership and path targeting are organizational improvements, not a mandatory isolation boundary.
- **Docker and shared persistent storage: RETAIN.** Essential platform capabilities; do not remove or disable during hardening.
- Controls must be low-friction, noninteractive by default where appropriate, and must not add per-command approvals.
- For a single trusted operator, treat cross-project access as a documented design tradeoff. Separately evaluate risk if third-party access or untrusted code is introduced.

## Implementation and live acceptance update — 2026-10-26
- Maintained root within dev-main, Docker socket integration, shared /workspace/projects and persistent volumes by explicit operator decision. No per-command approval added.
- Chrome existing-session CDP: provider connected epoch 5; inspected an existing public page using semantic CDP AX fallback. PASS.
- Edge existing-session CDP: not connected, attach error BROWSER_ATTACH_FAILED; native discovery and screenshot PASS for read-only fallback; strict semantic Edge E2E remains BLOCKED until a real Mac CDP attach. No browser/profile restart or cookie movement.
- Source patch for trusted Mac delegation: finite action budget (requested up to 200), max 30 minutes, no per-action confirmation while an existing trusted grant is active. Unit and Bridge tests PASS, **NOT YET DEPLOYED** on the operator Mac: live bridge still reports unlimited_actions=true.
- Uncertain-action gate demands independent application-reloaded readback before promoting outcomes; append-only audit recovery scanner detects orphaned intents and uncertain results without auto-retry. Historical 5 uncertain action metrics remain unverified.
- Read-only storage monitor added to scripts/ops/storage-alert.mjs. Real virtiofs headroom measured with POSIX df -Pk, not Node statfs f_bsize (which misreports free space on this mount). Result: 20.32 GiB available; 96% used. Automatic conditional check configured every six hours, with duplicate suppression and no deletion.
- One-iteration isolated Chromium smoke: PASS, including keyboard/desktop gesture, accessibility names and isolated context; mobile touch not tested in one iteration.
- Independent Chromium/CDP Browser Runtime E2E: PASS, 16 checks; p50 warm discovery 0.54 ms / p95 0.77 ms in that fixture; NOT a Mac Edge test.
- Source tests: npm run lint PASS, npm run typecheck PASS, npm run test:mac 209 pass / 1 skip / 0 fail, npm run test:browser:policy 49 pass, npm run test:ops:storage 4 pass, npm test (Vitest) 33 pass, audit recovery 2 pass.
- Full heavy build/release and Mac Bridge deployment not attempted: existing storage-guard requires 80 GiB free, current 20.32 GiB; do not bypass or run prune. Source changes committed locally in e337f85e4fd9ff0c4715849586aea7a7215516f0; no push or Mac Bridge deployment is claimed.

### Remaining acceptance gates
1. Run the Mac Edge CDP doctor on the operator host. If DevToolsActivePort is absent, operator must enable remote debugging for the existing Edge instance via the supported browser mechanism; do not restart Edge or migrate its profile automatically.
2. Install the bounded-session bridge patch on Mac only after a verified source baseline, backup, no active delegation and rollback plan. Then confirm the live status reports finite remaining_actions.
3. Review Mac audit-v2 ledger for the five historical uncertain events and collect independent application readback where appropriate.
4. Restore safe storage headroom, then run the full SHA-pinned build, adversarial suites and recovery gates. A passing isolated fixture is not a production release GO.

## Evidence-to-code provenance
- Verified code commit: `e337f85e4fd9ff0c4715849586aea7a7215516f0` (local branch feat/computer-use-runtime-v2).
- Release candidate status: source-only; no production/tag SHA or Mac Bridge deployment attested.
- Operator Mac diagnostic handoff prepared under `/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-edge-cdp-doctor-20261026` with SHA-256 manifest.
- The 29 MCP tools remain connected to the existing Mac Bridge process; source changes do not imply live installation.

## Mac Bridge limited-action deployment readiness
- Added guarded installer: `deploy/session-budget/install-on-mac.mjs`, surgical patcher and tests.
- Maximum 30 minutes, requested 1..200 actions, noninteractive trusted mode preserved.
- Installation is a separate Mac-only operator action. Current live Bridge still reports unlimited actions; do not infer otherwise from source tests.
- Built-in rollback, source-hash preflight, inactive delegation requirement and no browser restart.
