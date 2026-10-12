# Computer Use Enterprise Hardening — Execution Tasks (Graph Harness SHIP)

Use project.json as the source of dependency truth; do not manually mark nodes DONE. Every completion requires immutable command output or artifact checksum, independent review where specified, and a Graph Harness gate.

| Node | Executor role | P0 deliverables | Evidence kind(s) |
| --- | --- | --- | --- |
| CUE-101 | A — multiagent runtime | Discover approved model executor transport, scoped session, per-agent worktree/branch, shared ledger coordinator, cancellation, no cross-worktree writes | executor_smoke, worktree_isolation, capability_denial |
| CUE-201 | B — browser/CDP | Repair Chrome inspect on real Mac; diagnose Edge channel, distinguish native-only; fresh ref/revision, screenshots, safe fallback | isolated_browser, mac_chrome_acceptance, mac_edge_acceptance |
| CUE-301 | C — security | Threat model, enforce scoped identity/origin/action budgets, sensitive field denial, replay/uncertainty, prompt injection, SSRF, least privilege | security_review, abuse_regressions, identity_boundary |
| CUE-401 | D — independent UI QA implementation | Reusable headless Playwright suite, touch/drag/keyboard/a11y, flake diagnostics, safe screenshots, 25-run noninterference gate | headless_e2e, interaction_coverage, noninterference |
| CUE-501 | E — SRE / supply chain | Image parity, GitHub CI, provenance/signing, SBOM, dependency scan, privacy-preserving audit retention, backup/rollback test | dependency_scan, signed_bundle, rollback_drill, audit_retention |
| CUE-601 | independent verifier | Adversarial E2E, host-safe tests, privacy and failure modes; challenge agent claims; require fixes and rereview | independent_adversarial, release_candidate_retest |
| CUE-701 | human release owner | Explicit scoped Mac approval, signed release receipt, per-browser acceptance and post-release smoke | human_release_approval, mac_release_receipt, post_release_smoke |

## Runbook for evidence and gates

- Scope approval comes before any spec_ready -> approved transition and must be attached using record-approval with the explicit human-reviewed spec hash. This conversation's feasibility request is NOT production deployment approval.
- Agents A-E may execute in parallel only after worktree setup, no overlapping file ownership and explicit agent-provider availability.
- Independent verification cannot use the implementation agent's self-report as sole proof. Repo policies and product business authorization remain separate.
- Coordinator alone reads and writes events.jsonl. Worker process outputs are checksummed and referenced from graph evidence events; avoid full private screenshots in a shared Git repo.
- Stop on a non-fixable environment gate, missing consent or a policy violation. No guessing of workarounds.
- Record provenance: SHA of worker commit, exact checks, tool/runtime version and environment (Linux fixture vs actual Mac host).

## Known current completion

- Source baseline 7fa8318 locally committed. Source tests (94 Node and 13 independent Chromium checks) and a Chessy headless smoke passed in the prior turn.
- Npm production dependency audit returned zero advisories at the latest local inspection; this does not establish Mac image parity.
- Multi-provider external autonomous model execution has **not** been provisioned; parallel agent processes have **not** been launched.
- No push, PR, Mac deployment, new authenticated action or release has been performed for this plan.
