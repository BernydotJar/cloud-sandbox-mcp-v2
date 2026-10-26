# Sandbox V3 — native Liquid Glass, AX form targeting and background requirement

Date: 2026-10-26
Operator constraints: no enabling Remote Debugging; no browser profile
restarts/migrations; preserve root/Docker/shared data; no blind Tab/Arrow
form discovery; do not interrupt current macOS desktop work.

## 1. Native Liquid Glass

The current Mac screenshot verified an AppKit frosted visual effect, not
Apple's actual Liquid Glass API. The source candidate now selects
\`NSGlassEffectView\`, with \`style=.clear\` and a real \`contentView\`
when compiled with Xcode 26 / Swift 6.2 and run on macOS 26+.
Otherwise an \`NSVisualEffectView\` adaptive fallback continues to work.
No private \`CAFilter\` APIs, custom window hooks, or remote debugging.

Apple reference: https://developer.apple.com/documentation/appkit/nsglasseffectview

The preview announces its actual runtime material as one of
\`MATERIAL=NATIVE_LIQUID_GLASS\`,
\`MATERIAL=LEGACY_VIBRANCY\` or \`MATERIAL=LEGACY_SDK\`.
\`preview-on-mac.mjs --inspect\` reports OS and SDK versions on Mac.
A source gate is not a substitute for an actual macOS compilation and
visual check in both light and dark appearance, including Reduce
Transparency and Reduce Motion.

## 2. Verified Codex Desktop CUA handoff

Source evidence:
\`/workspace/_shared/evidence/edge-ax-transfer-20261023/STOP_UNGROUNDED_KEYSTROKES.md\`
and \`/workspace/_shared/skills/mac-computer-use/references/verified-form-entry.md\`.

Correct flow (on actual available provider):
- \`cua.getApp('com.microsoft.edgemac')\`.
- Fresh \`getAXState()\` / \`getAXStateAndScreenshot()\`.
- Resolve unique field by AX role/label/current value and date/project.
- \`click(currentIndex)\` only on the freshly resolved AX node.
- \`typeText()\` after verified focus; fresh AX observation.
- Reload, then independently verify persisted state.
- STOP if a required semantic provider is unavailable: do not
  compensate with Tab/Arrow loops, coordinates, an assumed form index,
  or a different browser/profile.

The 40 previously saved hours for Oct 19–23 must remain unchanged.
Oct 24 Saturday is DRAFT-ONLY and is not a valid candidate for a new
automated mutation. No \`Modify Entry\`, \`Save\`, \`Submit\`, or
\`Log Work\` as a rehearsal.

## 3. New guarded AXValue source candidate

The native Swift AX helper and Bridge adapter now accept
\`value_observation\` for:
- \`hours_numeric\`, only on short numeric values of an identified
  time/day field (0–168, no arbitrary free text);
- \`boolean\` on checkbox/radio controls;
- \`empty\` and \`redacted\` for other fields.

Raw AXValue and arbitrary candidate/personnel fields are never copied
into the MCP snapshot. The AX revision fingerprint includes the
observed safe value; stale refs are invalidated.

THIS DOES NOT ESTABLISH LIVE CAPABILITY. The current registered 29 MCP
tools do not expose the AX-enhanced action/screenshot schema; Mac Bridge
and controller promotion must preserve installed local customizations
and be validated with the actual host. The AX helper currently restricts
itself to the frontmost browser and one unique URL-bound AXWebArea,
so it remains foreground-only and cannot claim background execution.

Mac-only read-only compile preflight for the candidate:
\`deploy/ax-readback/inspect-on-mac.mjs --inspect\`.
No corporate UI actions should be performed just to test this revision.

## 4. Background operation — two distinct acceptance lanes

**Offscreen browser QA**: isolated Playwright Chromium already meets the
noninterference requirement when truly headless. It does not carry the
Mac operator's authenticated cookies; login is independently authorized.

**Authenticated browser with existing session**: a demonstrated
focus-preserving semantic provider can operate without global OS
keystrokes when explicitly authorized, but it is not independent
from that tab. The operator does not want new CDP debugging enabled.
Native AX on the foreground Mac does not meet the background requirement.

**Full desktop CUA on macOS**: requires an isolated macOS GUI worker
with independent display/input/window tree/session and own permissions,
or a separately demonstrated equivalent. A virtualized macOS worker is a
candidate but not deployed. The existing workstation has critical disk
headroom; do not attempt provisioning a VM without a capacity plan.

Background gate:
1. A disposable target app in an isolated Mac session.
2. Agent reads AX node identity, value, and focus state.
3. Agent interacts solely with isolated window.
4. Operator foreground app, cursor, keyboard, focus and current tab remain
   unchanged throughout.
5. Readback after reload, audit receipt and cancellation confirmed.
6. Any unexpected foreground focus or ungrounded keystroke is a fail.

Until these pass: \`BLOCKED_PROVIDER_NATIVE_AX_NOT_AVAILABLE\` for AX
requests on live MCP or \`BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED\`
for true background desktop actions. Do not represent a source commit
as a deployment.

## 5. Release evidence and scope
- Native Liquid Glass: Swift source candidate + SDK/runtime conditional.
- Guarded AX observations: Swift source, JS AX references, TS response schema.
- Regression: npm run test:mac; npm run test:browser:policy;
  npm run test:browser:native-parity; npm run typecheck; npm run lint.
- Live macOS Swift compile, installed Bridge & registered tool schema
  comparison, and AX noninterference demonstration: NOT YET VERIFIED.
- No Mac browser reboot, profile change, session takeover, timesheet edit,
  Docker cleanup, or CDP activation occurred.
