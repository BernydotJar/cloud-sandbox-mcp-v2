# Computer Use Enterprise Hardening — Solution Design

## Architecture decision

Use Graph Harness SDLC as a typed, evidence-first control plane over the existing cloud-sandbox-mcp-v2 repository. Do not use one giant shared prompt, one shared editing checkout, or five independent ledgers. Orchestrate parallel engineering work in the current dev-main workstation with isolated Git worktrees, branch-specific file ownership, model-agent adapters when properly installed, and a single authoritative event writer.

    Human scope approval -> SA / Graph coordinator -> ready-node scheduler
                                   |
                      ┌────────────┼────────────┬───────────┬──────────┐
                      A            B            C           D          E
                  Agents       Browser CDP    Security   Offscreen QA    SRE
                      └────────────┼────────────┴───────────┴──────────┘
                                   v
                        Independent verification
                                   v
                     Human Mac release authorization

The executor is replaceable. The graph scheduler is not itself a model-agent launch facility. No provider token is to be placed in a repo, process args, event text, artifact, or chat response.

## Control planes

- Execution graph: graph/computer-use-enterprise/project.json and events.jsonl, referencing the external pinned Graph Harness revision.
- Agent integration: per-agent worktree at /workspace/projects/<distinct-safe-name> or Git worktree path under the shared workstation; only a configured executor with explicit credentials can run autonomous model tasks. Node ownership forbids accidental overlapping edits.
- Evidence: test results and checksums from each worker are passed to SA; only SA records evidence/gates in the centralized append-only event log. Graph Harness uses flock for atomic local file append and SHA-256 chain, but worktree copies are separate ledgers. NEVER merge five divergent events.jsonl files.
- Product app testing: isolated Playwright browser contexts / headless Chromium, no Mac cursor, no authenticated user profiles.
- Authenticated web control: attach-only CDP with unique tab refs, navigation revision, bounded semantic selectors and a per-task delegated session. Native macOS Computer Use remains separately consented fallback, possibly foregrounding.
- Security: fail closed on denied scope and audit-intent failure; independent evaluator adversarially probes prompt injection and unintended tool authority. CLI policy checks are not an enforcement boundary until wired into the tool dispatcher.
- Release: signed immutable bundle, no dependency drift, security scan, runbook, host acceptance, documented rollback, human approval, post-release smoke.

## Non-overlapping source ownership

- A: src/agent-orchestration, scripts/agent-orchestration, tests/agent-orchestration.
- B: mac-host/browser-runtime, browser-adapter tests. B coordinates shared security-contract changes with C.
- C: mac-host/autonomy-session, mac-host/bridge, service authorization, security tests.
- D: scripts/offscreen-qa, tests/offscreen-qa, QA evidence; does not replace another project's dirty evidence.
- E: deploy, GitHub CI, release scripts and operations docs.
- Independent verifier: read-only inspection; only evidence/review artifacts, no edits to implementation.
- SA: graph ledger, specs, integration, cross-lane conflict resolution.

## Terminal conditions

- COMPLETED: all nodes DONE with supported evidence, MAC host gates passed, signed release and human authorization recorded.
- PARTIAL_WITH_DOCUMENTED_BLOCKERS: only access, consent, external runtime or human acceptance blockers remain; no claim of enterprise rollout.
- SAFETY_STOP: privacy, unsafe external effect, broken audit chain, profile disruption or unauthorized capability expansion.

## Critical path

Parallel engineering of A-E after scope approval -> independent review and localized repairs -> signed release rehearsal -> explicitly approved Mac verification/deployment -> production acceptance. The Mac rollout must never be hidden inside headless or deterministic test scripts.
