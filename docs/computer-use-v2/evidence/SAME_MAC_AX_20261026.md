# Same-Mac native background AX — code evidence

Date: 2026-10-26
Branch: feat/computer-use-runtime-v2

## Operator intent

- Native Computer Use must run in the background on this SAME Mac.
- VM, another Mac, external APFS disk: NOT A REQUIREMENT.
- No focus theft, no global key/mouse events, no remote browser debugging.
- Preserve ongoing Edge delegation and previously saved corporate timesheets.

## Implementation

- SameMacAX.swift: locates non-frontmost NSRunningApplication by bundle ID,
  exact AX window title, path, role, name, revision and fingerprint;
  reads safe AX values and dispatches AXSetValue/certified AXPress directly.
  Explicitly checks foreground application before/after and refuses
  unexpected changes. App-specific focus changes remain possible; code
  cannot guarantee universal side-effect-free behavior.
- server.mjs: localhost token, durable intent ledger, opaque one-time refs,
  per-app allowlist and certified AXPress configuration.
- install-on-mac.mjs: source hash verified, native compiler gate, user
  LaunchAgent, stable AX helper TCC location, no old Bridge modifications.
- SameMacAXFixture.swift and accept-on-mac.mjs: synthetic nonfrontmost
  background value/readback/press and persisted state acceptance.
- SameMacAXService and three MCP tools: separate from installed native
  Browser Bridge, disabled until explicitly configured.

## Current source verification

- npm run verify: PASS (8 Vitest files); Mac/Bridge 235 PASS, 1 Mac-only SKIP;
  browser policy 49 PASS; isolated legacy worker 19 PASS;
  same-Mac AX 12 PASS; TypeScript, ESLint and build PASS.
- No local Mac native Swift typecheck or Accessibility TCC granted by this
  Linux workstation. It is NOT live until installed and Mac E2E passes.
- No VM, Tart, external drive, browser restart, profile change, remote
  debugging, timesheet mutation or Mac foreground action was performed.

## Acceptance required

1. Verify release manifest and Swift compiler on the real Mac.
2. Install same-Mac AX user service and grant the helper AX access once.
3. Run synthetic background fixture while operator maintains another
   foreground app; verify exactly 8 persisted by real AX actions.
4. Read written result from shared handoff evidence and compare state.
5. Verify controller host network reachability without exposing AX port.
6. Deploy/promote three new MCP tools preserving existing 29-tool runtime.

P0 STATUS: SOURCE PASS, LIVE MAC AX AND FOCUS TEST PENDING.
