## Live update — 2026-10-29

The existing Mac now passed the disposable fixture and a real Toyota Teams
background interaction smoke through Sandbox V3. Read
[Background browser AX](./BACKGROUND_BROWSER_AX_20261029.md) for the current
explicit-ref workflow, certified per-process text backend and limits. This
update supersedes historical source-only/background-provider availability
statements below; it does not claim an isolated desktop or universal app support.

## CORRECTED P0: Same Mac background AX (2026-10-26)

Operator requires background native CUA on the CURRENT Mac.
No macOS VM, second Mac or external disk is a prerequisite.
The primary implementation is mac-host/same-mac-ax; read
docs/computer-use-v2/SAME_MAC_BACKGROUND_AX_P0_20261026.md.
Native AX operations on background windows must be tested per
app; they may be unsupported or unexpectedly activate the app.
Never silently fall back to foreground keyboard automation.
The separate-Mac worker below is an archived alternative, NOT
a requirement for this P0.

# Background execution contract — Browser Automation vs. Desktop CUA

Status: SOURCE POLICY ENFORCEMENT (not a Mac deployment). Revision 2026-10-23.

The operator must be able to continue using their own macOS desktop while an
agent performs work. Background work is **not** merely an agent running in a
separate process: it must avoid changing the operator's foreground app, cursor,
keyboard focus, windows, active tabs or work context without explicit opt-in.

This contract keeps two independent subsystems separate.

## 2026-10-26 isolated macOS worker implementation update

A new candidate has been implemented under
\`mac-host/isolated-desktop/\`, including native Swift AX inspection/actions,
a disposable AppKit fixture, a loopback-authenticated guest service,
machine-identity separation, durable anti-replay audit, guest-only screen
capture, four optional MCP tools and an on-device preflight/acceptance kit.

**Do not label this deployed**: macOS guest provisioning, guest Swift
compilation/TCC, trusted SSH forwarding, Mac controller promotion and a live
no-interference acceptance remain OPEN. The currently active 29-tool
controller remains unchanged.

Run the read-only operator preflight first, then use the exact acceptance
workflow in \`mac-host/isolated-desktop/README.md\`. No browser debugging
and no corporate website mutations are needed.

## 1. Browser Automation (Playwright / Browser MCP)

**Fully isolated:** prefer the project's headless Playwright suite or an
isolated headless Chromium context in the Linux workstation. Require observed
`isolated_playwright_headless=true`; a headed suite must never be labeled
background. Test accounts, profile and cookie storage remain isolated. Do not
copy, export or reuse personal Chrome/Edge credentials and SSO tokens.

**Existing authenticated Mac Edge or Chrome:** the user must explicitly
request reusing a current tab. A verified persistent semantic Browser MCP
adapter can inspect/click/fill without global OS keystrokes, but **it is not
an isolated browser**: page contents and business records still change.
Permit only an explicit `background_mode=focus_preserving` with
`browser_focus_preserving_verified=true`, an exact tab reference, revision,
own scoped grant and business-specific authorization. Never promise it is
fully isolated. Avoid touching a tab currently used by the operator.

**No native fallback:** when the request requires background execution,
`computer_use_focus/screenshot/action` on the shared macOS desktop,
including native AX, cannot replace CDP/Playwright. `screencapture` may
activate a browser, and `System Events` global `keystroke` and `keyCode`
can reach the operator's active window. Existing AX targeting improves
accuracy but does NOT provide an independent desktop or cursor.

## 2. macOS Desktop CUA (Terminal / Finder / GUI apps)

An agent moving a Mac window, opening Terminal or sending keyboard events on
the currently logged-in desktop is **foreground interaction**. Background
operation requires a **separate macOS GUI session with independent display
and input**, for example a user-authorized macOS virtual machine or dedicated
remote Mac. The runtime must prove:
- independent session identity, user-approved access and isolated window tree;
- no activation or input events on the operator's actual desktop;
- ownership of its own AX tree, keyboard, pointer and screenshot surface;
- cancellation/revocation of that agent's own task grants;
- SSO and credential setup only through approved login in the isolated
  session (never copy existing profile secrets);
- no unexpected OS permission or login prompts on the operator's desktop.

Current Cloud Sandbox MCP V2 does **not** expose such an isolated macOS CUA
worker. Do not simulate its availability with `native_mac_available=true`
or assume the Codex Desktop `getAXState()` method supplies virtualized UI
input. Until the isolated Mac worker is provisioned and tested, the router
returns `BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED`.

**Mac terminal commands without GUI:** when the goal is command execution
rather than demonstrating the Terminal GUI, a specifically authorized,
narrowly scoped Mac host command runner can run without opening Terminal.
It is a **third backend / deterministic command lane**, not Playwright or
desktop CUA. The Linux `workspace_exec` is not that runner. If the exact
Mac host runner is not installed, return
`BACKGROUND_MAC_COMMAND_RUNNER_UNAVAILABLE`; no invented shell bridge.

## Execution request contract

Supply `background_required:true`. Default mode is `isolated`.

```json
{
  "task": {
    "kind": "web",
    "intent": "qa",
    "context": "isolated",
    "browser": "chromium",
    "background_required": true,
    "background_mode": "isolated"
  },
  "capabilities": {
    "isolated_playwright": true,
    "isolated_playwright_headless": true
  },
  "plan": {
    "engine": "playwright_isolated",
    "operation": "run_qa"
  }
}
```

`background_mode=focus_preserving` is available only for a verified
persistent semantic browser provider on an explicitly requested existing
Mac tab. It is **not** a fallback to native AX or global keyboard input.

`scripts/browser-automation/engine-router.mjs` and
`agent-preflight.mjs` enforce task/engine compatibility. The actual isolated
Playwright runner calls that policy with headless=true. The host bridge
rejects `background_required=true` on its native focus/screenshot/action
endpoints before touching OS UI. The updated MCP registration defaults
`background_required=true` for those native tools; a task explicitly
approved for foreground Mac UI must pass false. This is SOURCE-ONLY until
deployed; current running tools may still have older schemas and should
not be assumed to enforce it.

## Background acceptance gates

| Gate | Acceptance requirement |
| --- | --- |
| BKG01 | 25 isolated headless browser contexts, real input and screenshots, with no attachment to personal Mac browsers |
| BKG02 | Verified headless engine identity; headed Playwright reports BLOCKED, not background PASS |
| BKG03 | Existing Edge CDP failure cannot fall back to native screenshot, Tab/Arrow or coordinate input in background tasks |
| BKG04 | Background native Mac focus/screenshot/action explicitly blocked before host dispatch |
| BKG05 | A background Terminal command requires a real, scoped Mac host command runner; Linux execution cannot masquerade as Mac |
| BKG06 | Desktop CUA GUI actions require independent macOS GUI session and fresh AX target; current shared desktop blocks |
| BKG07 | Prove no operator focus/cursor/active-app disruption while the approved isolated worker performs repeated noncorporate fixture actions |
| BKG08 | Preserve all company data, session, allowlist, privilege and profile controls; independent audit and rollback verified |
| BKG09 | Live Saturday 24 Oct draft/cancel/readback only after BKG01-BKG08, and only when app rules permit nonpersistent entry |

**No-go:** an agent 'running in the background' while clicking the
foreground Mac desktop, or a synthetic AX unit test counted as a real
isolated desktop acceptance.

## User-provided Mac handoff directory

The operator referenced:

`/Users/eduardosacahui/Documents/Codex/2026-10-23/mira/outputs`

That path is NOT mounted into `cloud-sandbox-dev-main` at the time of this
review. Shared evidence already available:
`/workspace/_shared/skills/mac-computer-use/references/verified-form-entry.md`
and `/workspace/_shared/evidence/edge-ax-transfer-20261023/`.
Do not claim the local ZIP or local text report was directly inspected.

The existing `browser-native-targeting-parity` helper is a foreground
AX implementation and omits form field VALUE readback. It cannot fulfill
the background CUA or full value-verification acceptance requirements until
an isolated Mac GUI runtime and appropriate secure readback are implemented.
