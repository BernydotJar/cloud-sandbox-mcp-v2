# Graph Harness SHIP Control — Computer Use Enterprise

Status: ARCHITECTURE PREPARED / AWAITING EXPLICIT SCOPE APPROVAL.
Date: 2026-10-12. Repository: BernydotJar/cloud-sandbox-mcp-v2, branch feat/computer-use-runtime-v2.
Current source baseline: 7fa8318. Graph Harness pinned runtime: f8bb28ec0933f54df5ff2e0d2c06a731471ec47e.

## Why multiple agents

Five non-overlapping implementation lanes (A-E) shorten the critical path; one independent verifier runs after their integration. One Solution Architect owns graph state and conflict resolution. A scheduler identifies READY nodes, but Graph Harness does not start AI-model processes itself.

Read specs/computer-use-enterprise/{requirements,design,tasks}.md for acceptance criteria and graph/computer-use-enterprise/project.json for executable DAG edges.

## Current autonomous engineering execution

A single ChatGPT-driven Solution Architect agent is actively implementing
source changes through Cloud Sandbox V2. This is a valid *one-agent fallback*,
not evidence that Claude/Codex/Gemini subagents launched.

Current source-only increments (must be committed and rechecked before release):
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
