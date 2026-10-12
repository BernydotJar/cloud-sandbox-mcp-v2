# Computer Use Enterprise Hardening — Requirements

Mode: SHIP. Source baseline: cloud-sandbox-mcp-v2 @ 7fa8318, local as of 2026-10-12.
Orchestration baseline: Graph-harness-sdlc @ f8bb28ec0933f54df5ff2e0d2c06a731471ec47e, loaded externally from the pinned shared checkout. Do not vendor a second Graph Harness implementation.

## Scope and truth boundaries

The current operating topology is ONE shared dev-main workstation, ONE Mac host bridge, a customized MCP registry, Chrome/Edge persistent or native adapters, and scoped task delegations. No multi-tenant RBAC or independent native Mac cursor has been verified. An enterprise-grade deliverable requires operationally demonstrable controls; successful Linux tests alone do not authorize an enterprise readiness claim.

## Functional requirements

- FR-01: route local web UI testing to isolated Chromium headless, with independent browser contexts, deterministic assertion/evidence, and no daily-driver Chrome/Edge use.
- FR-02: route authenticated browser inspection to persistent CDP when attachable. Advertise semantic support only when semantically available; explicit native fallback retains macOS approval controls.
- FR-03: enforce scoped actions by actor, tab/origin, task, expiry, revocation and unique request_id. Recheck target identity and authorization at dispatch.
- FR-04: isolate concurrently executing coding agents by distinct Git worktrees/branches, per-task capabilities and path ownership; one coordinator writes the authoritative graph event ledger.
- FR-05: distinguish source tests from actual Mac-host acceptance, rollback, CI and release status. Never auto-promote a failing gate.
- FR-06: support audits, observability, bounded retention, incident diagnosis and controlled rollback without recording raw page contents, credentials, session IDs or personal URLs.

## Quality and risk requirements (acceptance criteria, not measured claims)

- QR-01: 25 repeat executions of a fixture offscreen flow, including desktop mouse drag, mobile touch, keyboard, a11y checks, and captured evidence, must pass without observable Mac foreground changes.
- QR-02: real-host Mac Chrome and Edge each complete repeated discovery, screen capture, safe inspection and stale-reference checks. Edge native-only is an explicitly blocked semantic acceptance gate, not a success.
- QR-03: all tested unauthorized mutations are denied before dispatch. Session cancellation blocks subsequent dispatch. In-flight actions and crash boundaries are reported as uncertain, never auto-retried.
- QR-04: independent adversarial verification covers privacy, prompt injection, spoofed targets, replay, revocation races, auditing, least privilege, and supply-chain integrity.
- QR-05: reproducible image dependency checks, zero unresolved high/critical alerts at release, signed artifact provenance and a timed successful rollback drill. Thresholds are reviewed by SRE; no signed release claimed yet.
- QR-06: requirements for a true multi-operator enterprise deployment (identity federation, RBAC, separated credentials, tenancy policy and operational support) must be implemented and tested, or expressly excluded from a *single-owner hardened pilot* scope. Never present the pilot as certified multi-tenant.
- QR-07: the customer/user authorizes any Mac-host mutation or production release at the release gate. Graph approval is not an implicit business authorization.

## Mandatory non-goals for engineering lanes

- No new workstation/container required; no disruption of other projects.
- No changes to default Mac browser profiles, existing tabs, user credentials or debug port exposure.
- No copying the Graph Harness runtime, no autonomous push/merge/deploy, no destructive admin actions.
- No simulated proof of real Mac acceptance or fake independent reviewer identities.

## Baseline known blockers

1. Chrome persistent discovery and screenshot worked; live ARIA inspection returned NATIVE_UNAVAILABLE. The source mitigation at 7fa8318 is not deployed.
2. Edge persistent CDP was unavailable; native discovery worked.
3. Delegated task session was inactive and no real Mac action acceptance test was run.
4. Source tests passed in isolation, but Mac-host rollout, image dependencies, signing, RBAC and audit lifecycle are not accepted.
5. No Claude, Codex or Gemini executable was present in the shared workstation at inspection; Graph Harness provider projections are not agent launchers.
