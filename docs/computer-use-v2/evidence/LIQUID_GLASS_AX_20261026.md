# Evidence: Liquid Glass + guarded AX readback + noninterference contract

Date: 2026-10-26
Repository: /workspace/projects/cloud-sandbox-mcp-v2
Source branch: feat/computer-use-runtime-v2

## Live status sampled before development

- The Mac bridge was previously connected and native browser discovery available.
- Chrome had an existing connected persistent adapter; Edge CDP was unavailable
  and Edge native fallback was the available path.
- The active published MCP tools do not include the AX-specific inputs added
  to source in commit 8855abb. Do not conflate source contracts with deployment.
- No Mac OS or Xcode SDK version has been verified in this turn.
- No screen focus, keystrokes, trusted sessions, browser profiles, or
  timesheet rows were altered.

## What was implemented in source

1. The macOS native Akira splash now selects public Apple
   NSGlassEffectView when macOS 26+ and Swift 6.2 / Xcode 26 SDK are
   available. The content sits inside NSGlassEffectView.contentView.
   Older combinations fall back to AppKit NSVisualEffectView.
   The preview announces the actual material at runtime.
2. Read-only Mac preflight reports macOS, SDK and Swift versions
   without modifying developer directories.
3. Native AX helper has guarded value observation for numeric hours
   (identified time/day labels, bounded 0..168), checkbox/radio boolean
   values, and empty/redacted indicators. No arbitrary raw text or
   protected controls; AX revision fingerprint includes safe value.
4. JS Bridge AX references and TS screenshot response schema validate
   the allowed observation shapes, reject arbitrary AXValue fields and
   refuse forged roles/oversized numeric values.
5. A Mac-only AX source SHA/Swift typecheck inspector is packaged.
   It does not install or invoke any GUI AX action.

## Exclusions and limitations

- Full Codex Desktop cua.getApp/getAXState parity is not yet deployed
  in the active Cloud Sandbox MCP tool registry.
- AX helper still explicitly requires a unique AXWebArea in the
  frontmost authenticated browser. It is foreground-only.
- Background-required native macOS GUI clicks and keystrokes remain
  blocked. They require a separate verified macOS GUI worker with
  independent display/input, or a separately proven no-focus semantic
  execution path. No VM has been installed.
- Existing 40h saved in UiPath/HCL remain untouched. Saturday 24 Oct
  remains a nonpersistent, unexecuted rehearsal case.
- Mac Swift compilation, live NSGlassEffectView selection and AX
  noninterference E2E still require on-device evidence.
- Root, Docker and shared workspace storage remain available.
- No remote debugging is enabled or requested.

## Verification (Linux source level)

- npm run test:mac: 232 tests, 231 pass, 0 fail, 1 Mac-only skip.
- npm run test:browser:native-parity: 94 tests, 94 pass, 0 fail.
- npm run test:browser:policy: 49 tests, 49 pass, 0 fail.
- npm run typecheck: PASS.
- npm run lint: PASS.
- git diff --check: PASS.
- No changes to deployed macOS Bridge/controller.

## Mac-only acceptance

1. Run preview inspector and check OS SDK; compile/view Akira.
2. Require "MATERIAL=NATIVE_LIQUID_GLASS" before claiming Liquid Glass
   authentic rather than fallback; inspect both light/dark modes.
3. Run AX readback inspector; require Mac Swift typecheck PASS.
4. Promote AX helper/controller only with installed-source fingerprint,
   backup and rollback, then verify real AX label/value on a disposable
   test form, not corporate timesheets.
5. On separate macOS GUI worker, demonstrate the operator foreground
   app, cursor, keyboard and active browser tabs remain unchanged while
   the agent performs its own semantic AX action and persisted readback.


## Live operator evidence and remediation
- Native Apple Liquid Glass is confirmed for the **Mac preview**:
  \`MATERIAL=NATIVE_LIQUID_GLASS\`,
  \`SCREEN_PREVIEW=COMPLETED\`, no Bridge installation.
- Foreground AX readback helper failed macOS Swift typecheck with four
  categories of syntax/type parsing diagnostics in the operator output.
- Corrected concatenation, explicit \`path:\` label, and \`== .success\`.
  Equivalent parser traps in isolated GuestAX.swift were also corrected.
- Rebuilt the AX readback source and SHA-256; macOS re-typecheck pending.
- Operator Mac native VM capacity check: arm64/hypervisor supported,
  24 GiB RAM, 16.81 GiB free, Tart absent. A guest needs external APFS
  space / more internal headroom or another Mac.
- No MAC foreground interactions or corporate records changed by this repair.
