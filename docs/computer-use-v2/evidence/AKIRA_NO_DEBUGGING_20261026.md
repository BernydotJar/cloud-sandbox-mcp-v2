# Evidence — Mac screen splash and no-debug pilot reconciliation

2026-10-26 · Workstation: dev-main · Repository: cloud-sandbox-mcp-v2

## Operator decisions
- Splash must be a native on-screen macOS AppKit window.
- No enabling remote debugging or changing Chrome/Edge profiles.
- Root, Docker and shared persistence on Linux remain enabled.
- Real Mac Terminal.app / host shell is a separate P0 and not currently
  exposed by the browser-specific MCP tools.
- The 2026-10-12 pilot handoff is a historical observation, not a permanent
  promise about current Edge/Chrome CDP.

## Current observed Mac capabilities
- Sandbox V3 browser_runtime_status: Chrome CDP connected, epoch 5;
  Edge CDP unavailable with BROWSER_ATTACH_FAILED.
- Browser tabs, Chrome public page: provider=persistent, semantic_available=true.
- Browser tabs, Edge public docs: provider=native, semantic_available=false,
  fallback_reason=PERSISTENT_BROWSER_UNAVAILABLE.
- computer_use_status: connected=true; active grant=false; trusted operator
  notice was reported as unlimited by the installed Mac Bridge. The bounded
  sessions patch has not been installed in the live Bridge.
- Source default browserRoutingFromEnvironment: native_first; live operator
  config may still be prefer_persistent.
- No browser UI action, profile change or debug setting change was performed.

## Source-only native splash candidate
- AppKit panel in deploy/bridge-toast/bridge-toast.swift.
- Five-second nonactivating, click-through connection splash.
- Original Akira mascot, native CoreAnimation laboratory particle burst and
  Reduce Motion behavior.
- Explicit twenty-second status-alert mode (fixed codes only) with a working
  macOS Finder logs action; closing is not session revocation.
- Does not yet receive live alerts automatically from Linux storage watch.
- Mac Swift typecheck, actual visual screenshot and installed Bridge compatibility
  remain unverified in this Linux workspace.

## Deterministic checks
- npm run test:mac: 215 tests, 214 PASS, 1 SKIP (Mac Swift compile).
- npm run test:browser:policy: 49 PASS, 0 FAIL.
- npm run typecheck: PASS.
- npm run lint: PASS.
- git diff --check: PASS.
- node deploy/bridge-toast/preview-on-mac.mjs --inspect: source digest valid.
- No production deployment, Bridge restart, CDP enabling or browser mutation.

## Release gate
Compile and visually inspect on actual Mac before any installation.
Do not claim installed splash or Mac Terminal P0 capability based on source
checks alone. Do not modify the existing Bridge until exact installed baseline
is understood and a rollback is ready.


## Quiet Glass revision (source candidate)
- Replaced thick saturated purple edge with neutral 0.65-point stroke.
- Adaptive popover blur and soft inner specular highlight.
- Akira character remains, 15 two-cycle low-saturation particles.
- Compact actionable glass log button and circular dismiss control.
- Smaller Edu! branding, stronger operational title and clearer hierarchy.
- Optional macOS launchd storage watcher reads authoritative Linux
  /workspace via nonmutating Docker exec and rate-limits local alerts.
- UI-only installer compiles, snapshots, atomically promotes and can roll
  back the single splash executable without restarting any browser/Bridge.
- Compilation and visual acceptance on physical Mac remain unverified.


## Quiet Glass verification — candidate prepared for macOS
- \`npm run test:mac\`: 227 tests, 226 PASS, 0 FAIL, 1 macOS-only SKIP.
- \`npm run test:browser:policy\`: 49 PASS, 0 FAIL.
- \`npm run typecheck\`: PASS.
- \`npm run lint\`: PASS.
- \`git diff --check\`: PASS.
- Direct native Xcode Swift typecheck and visual contrast/hover/position
  acceptance are pending the actual Mac, **not claimed as PASS**.
- UI-only installer: existing splash binary backup, atomic upgrade,
  native display smoke, single-file rollback; no Bridge restart.
- Optional local six-hour warning/critical notifier uses Docker \`df -Pk\`
  read-only, suppresses repeats and cannot clean files.
- No remote debugging, browser profile changes, credentials, or running
  Mac delegated session was touched in this candidate.
