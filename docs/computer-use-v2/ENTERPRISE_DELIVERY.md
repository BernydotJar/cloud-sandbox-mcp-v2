# Graph Harness SHIP Control — Computer Use Enterprise

Status: SOURCE HARDENING COMMITTED / MAC ENTERPRISE PROMOTION ON HOLD.
Date: 2026-10-12. Repository: BernydotJar/cloud-sandbox-mcp-v2, branch feat/computer-use-runtime-v2.
Current source baseline: 7fa8318. Graph Harness pinned runtime: f8bb28ec0933f54df5ff2e0d2c06a731471ec47e.

## Why multiple agents

Five non-overlapping implementation lanes (A-E) shorten the critical path; one independent verifier runs after their integration. One Solution Architect owns graph state and conflict resolution. A scheduler identifies READY nodes, but Graph Harness does not start AI-model processes itself.

Read specs/computer-use-enterprise/{requirements,design,tasks}.md for acceptance criteria and graph/computer-use-enterprise/project.json for executable DAG edges.

## Current autonomous engineering execution

A single ChatGPT-driven Solution Architect agent is actively implementing
source changes through Cloud Sandbox V2. This is a valid *one-agent fallback*,
not evidence that Claude/Codex/Gemini subagents launched.

Source-only increments committed in `7764c31` and locally rechecked (Mac release not executed):
- safe per-provider attach failure codes, cooldown and retry diagnostics;
- sanitized inspection and screenshot result counters;
- strict write origin allowlist for persistent CDP AND native Mac actions,
  behind \`COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY=true\` so the currently
  deployed host is not silently reconfigured;
- 25 isolated Chromium gesture iterations (13 desktop mouse drag, 12 mobile
  touch drag), keyboard and ARIA checks with no Mac application focus;
- a reproducible \`npm run test:qa:offscreen\` gate in \`verify:v2\` and CI.

The current real Mac Chrome/Edge blockers have NOT been certified or solved by
source unit tests; no host files, profiles, bridges, tokens or browsers were
mutated to run these checks.

## SHIP checkpoint 2026-10-12

Graph state has 43 valid SHA-256 chained events and four tracked evidence artifacts.
- CUE-401 (`offscreen_qa`): DONE after the 25-iteration real Chromium mechanics test and a PASS evidence gate. This does NOT mark Chessy/LUMA product-specific E2E complete.
- CUE-201: BLOCKED. Edge read-only persistent CDP attachment and ARIA read worked on the Mac, but Chrome's live `browser_inspect` still returned `NATIVE_UNAVAILABLE`. New source handling was not deployed.
- CUE-301: BLOCKED. Strict domain-write policy exists and has source tests, but has not been enabled on Mac; multi-operator RBAC and independent red-team review remain.
- CUE-501: BLOCKED. Source-only unsigned candidate from `7764c31` verifies 126 files, 23 preserved tools + 6 new browser tools = 29. Image parity, signature, active 29-tool Mac rebase and rollback drill remain.
- CUE-101: BLOCKED because no dedicated Claude/Codex/Gemini CLI exists in the workstation; the user authorized one ChatGPT autonomous agent as a fallback.
- CUE-601 and CUE-701: independent verification and human release approval have not started.

The 29-tool source candidate was built from clean committed code in the remote
workstation at `/tmp/cu-enterprise-7764c31-candidate`. Its manifest SHA-256 is
`c77ef161dc7b5a20022292fe565ad5d3ee364103669600ab5b21b4e66ccbea79`.
It is NOT a signed or deployed Mac release. The legacy original V2 installer
must not be run on the now-upgraded 29-tool live Mac baseline.
A separate `deploy/browser-hardening/` 29-to-29 promotion candidate is now
implemented with pinned predecessor hashes, clean-source provenance, an
explicit new output directory, 29-to-29 rollback semantics and a deterministic
mocked Mac install/rollback test. This path is not yet deployed, signed, or
tested against the actual Mac host.

## Current capability

- Git worktree isolation and five independent deterministic tooling tracks can be created in one shared workstation. No extra containers are required.
- Graph Harness includes typed state, scoped capabilities, approval events, evidence, SHA-256 chained ledger, flock-protected *local* append, and localized repair.
- No claude/codex/gemini/opencode executable was available when inspected. Provider-render support is instruction projection, not proof that any external AI executor is connected.
- No model-agent process has been dispatched, and no user Mac browser or controller was restarted or modified during creation of this plan.

## Validation commands

From /workspace/projects/cloud-sandbox-mcp-v2, with the externally pinned /workspace/projects/Graph-harness-sdlc-control-plane checkout:

    export PYTHONPATH=/workspace/projects/Graph-harness-sdlc-control-plane
    python3 -m graph_harness --project graph/computer-use-enterprise/project.json --events graph/computer-use-enterprise/events.jsonl validate
    python3 -m graph_harness --project graph/computer-use-enterprise/project.json --events graph/computer-use-enterprise/events.jsonl status --pretty
    python3 -m graph_harness --project graph/computer-use-enterprise/project.json --events graph/computer-use-enterprise/events.jsonl ready --pretty

Nodes begin in spec_ready pending explicit human-approved scope; they cannot be executed merely by editing the graph. Scope approval, model-runtime provisioning, host access and production release are distinct gates.

## Operational rules

- One central ledger writer: the coordinator alone owns events.jsonl. Local exclusive locks are not distributed locks for five checkout copies.
- No workers share a writable branch. File ownership restrictions must be enforced at the adapter/tool boundary; graph allowed_paths alone is metadata, not OS sandboxing.
- Execution adapters must deny privileged operations by default, prevent path escapes and enforce task capabilities. No agent can spend, deploy, change secrets, touch authenticated tabs or auto-merge without separate human release authority.
- On regressions, Graph Harness invalidates only affected descendant nodes and preserves past evidence. A successful deterministic test does not imply host acceptance.
- The enterprise claim remains blocked until Mac Chrome/Edge, security, supply chain, independent red-team and operational/release gates genuinely pass.
