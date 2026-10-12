# Computer Use Enterprise - Adversarial source review

Review date: 2026-10-12. Review actor: **single implementing ChatGPT agent**.
This is a self-review using adversarial test cases, NOT an independent reviewer,
outside security assessment, enterprise certification or production acceptance.

## Verified source behavior

| Risk | Implemented / evidence | Current gate |
| --- | --- | --- |
| Unknown Mac code overwritten by a 29->29 upgrade | Four exact predecessor asset SHA-256 values are pinned. Simulated changed/customized file is rejected. The original 28->29 artifact stays untouched. | SOURCE PASS; real Mac inspect PENDING |
| Active delegated session interrupted during upgrade | Installer refuses a live session in preflight and re-checks before mutation. | SIM PASS; global maintenance lock not implemented |
| Old 28-tool rollback invalidates the already 29-tool registry | Operator installer derives expected rollback tool count from the release manifest; new 29->29 simulation restores all prior bytes and verifies the 29-tool registry. Historical 28->29 still passes. | SIM PASS; actual Mac rollback PENDING |
| Installer code tampered after packaging | New builder records SHA-256 of four assets, registry probe, installer and README. Verifier rejects modified installer code. | SOURCE PASS; independent publisher signature PENDING |
| Mutation in unrelated discovered tab | Opt-in write origin allowlist rejects persistent and native actions before dispatch, with regression tests. It does not enable itself on the host. | SOURCE PASS; actual Mac config PENDING |
| Attach errors expose Mac profiles or sensitive pages | Status carries only controlled error codes, bounded cooldown and counts; screenshot/inspection handlers convert failures to typed errors. | SOURCE PASS; actual Mac version PENDING |
| Browser QA steals user cursor or tabs | 25 Linux-only Playwright contexts with private headless browser; real mouse and CDP touch interactions, keyboard, ARIA, in-memory PNG. | SOURCE PASS; actual Chessy/LUMA product QA is separate |

## Blocking independent / live-enterprise findings

### E-01 High - authenticated Chrome semantic inspection

Current live Mac Chrome tab discovery and screenshot previously worked, but
`browser_inspect` still returned `NATIVE_UNAVAILABLE` during 2026-10-12
read-only acceptance. New source adds an explicitly labeled text fallback and
safe diagnostics; the active host bridge predates these changes. Obtain an
approved maintenance window, install the new hash-pinned 29->29 overlay using
separate operator authorization, then redo Chrome inspection and verify its
true `inspection_mode` and revision. Do not claim this resolved beforehand.

### E-02 High - multi-operator identity and authorization

The runtime is intentionally single-owner with a scoped session and local
approval. There is no separately implemented and independently validated
tenant partition, enterprise SSO, per-actor RBAC, key escrow or role-separated
approver. Restrict claims to **single-owner hardened environment** until those
business requirements have their own threat model, tests and rollout plan.

### E-03 High - publisher provenance and Mac rollback

Manifest and asset SHA-256 values are integrity checks, not a trusted
signature. Mac deployment, controller image parity, dependency parity,
backup/restoration drills, release signing and post-release acceptance remain
unverified on the live Mac. Do not use the historical 23/28 tool installer
against the existing custom 29-tool deployment.

### E-04 Medium/High - browser side effects and replay

Unique request IDs suppress duplicate dispatches within the live process and
task grant. They do NOT provide durable exactly-once execution across process
crashes or rollback of an action already dispatched. Any uncertain result
requires independent business-state verification, NEVER silent retry or
automatic fallback to native coordinate clicking.

### E-05 High - sensitive content and audit lifecycle

ARIA and screenshot masking is best effort, not comprehensive DLP. Browser
content is untrusted and may contain sensitive data and instructions. The
current per-process audit ledger has a bounded capacity; centralized
retention/rotation, SIEM and encryption/key-custody policy for a multi-operator
service still require design and independent controls validation. Do not log
raw page texts, screenshot bytes, credentials or task capabilities.

### E-06 Medium - release CI and actual browser gates

Local `verify:v2`, dependency audit, Graph Harness verification, reproducible
browser tests, mocked Mac upgrades and 29-tool source artifact verifiers pass.
The GitHub workflow has not been pushed/executed remotely, and an independent
external verifier has not accepted either deployment or product quality. Edge
persistent ARIA *read* succeeded on the live host, but it is not a full
authorized click/typing/rollback/cancellation acceptance.

## Release recommendation

**HOLD enterprise production promotion.** Advance the isolated/single-owner
code-only candidate with a signed operator-controlled maintenance process.
Run read-only inspection on the existing custom Mac bridge, verify the pinned
predecessor hashes, inspect the controller image dependencies, and confirm
there is no delegated session. Request a distinct human authorization for
Mac bridge deployment; then verify Chrome+Edge independently, test a harmless
explicitly approved action, revocation and reconnect, rollback, audit retention,
and CI provenance before marking CUE-201, CUE-301 or CUE-501 DONE.

The user approved source engineering, not live Mac deployment.
