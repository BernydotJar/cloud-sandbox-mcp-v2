# Native Browser Targeting Parity — AXUIElement + Retina Geometry

Implementation scope: Mac bridge native driver, controller MCP adapter and an
operator-compiled Swift AXUIElement helper. This is a separate provider from
Playwright/CDP and does not copy a Chrome or Edge login profile.

## Coordinate contract

The Mac Bridge screenshots use a rectangle in desktop **screen points** and
provide PNG **pixels**. The displayed image may be Retina 2x or use different
X/Y ratios; a screenshot pixel is not automatically a global screen point.

The existing computer_use_screenshot response preserves the image content and
adds a text result when the PNG's IHDR is valid:

    {"geometry":{
      "coordinate_contract":"mac-screen-points.v1",
      "screenshot_ref":"<opaque, short-lived, in-memory>",
      "bounds_points":{"x":100,"y":80,"width":600,"height":400},
      "image_pixels":{"width":1200,"height":800},
      "scale":{"x":2,"y":2},
      "expires_in_ms":30000
    }}

To target displayed image pixel (200,100), call computer_use_action with
action=click, coordinate_space=screenshot_pixels, x=200,y=100 and the exact
screenshot_ref. The host converts it to screen point (200,130) before sending
a native macOS event. Scale is computed from actual PNG pixel dimensions,
never hardcoded. No screenshot ref is issued for an invalid PNG.

Legacy clicks can supply coordinate_space=screen_points and actual *global*
Mac points. These are validated against the current frontmost browser window
to avoid the historical image-local vs global coordinate mistake. The same
URL+title/window checks remain mandatory. Expired refs, moved/resized
windows, ambiguous tabs, out-of-bounds input or browser identity mismatch are
rejected before dispatch; there is no automatic coordinate retry.

## Native AXUIElement contract (not CDP)

Existing computer_use_screenshot accepts include_ax=true. Once an operator
has compiled, reviewed and installed the Swift helper on macOS, the response
has a second text component:

    {"ax_snapshot":{
      "provider":"native_ax",
      "ax_revision":"<tree digest>",
      "expires_in_ms":30000,
      "nodes":[{"node_ref":"<opaque>","role":"AXButton",
                "name":"Cancel Editing","enabled":true,
                "parent_path":[1,3]}]
    }}

For an eligible time cell, the candidate can also report:

    {"value_observation":{"kind":"hours_numeric","value":"8","has_value":true}}

Other control text remains redacted. A second, independent post-reload
AX snapshot must confirm any persisted business change; a pre-reload
snapshot is not persistence evidence.

Only AX nodes in the single URL-bound AXWebArea of the frontmost, exact
browser tab are exposed. The revised Swift candidate returns **narrow, task-safe** AX value
observations: a small numeric hour value for an identified time/day field,
boolean checkbox/radio state, or an empty-field marker. Other raw text is
redacted. It does not return arbitrary textbox text, secure fields,
passwords, tokens, browser chrome, other apps or raw URLs. This source
candidate has NOT been installed in the active Mac Bridge; the live MCP
still cannot promise these fields.
Role, frame and short redacted name metadata are observable, not a claim of
semantic Playwright or guaranteed accessibility for every web framework.

computer_use_action also accepts:
- action=ax_press, ax_node_ref, ax_revision, reason, own session_id;
- action=ax_set_value, ax_node_ref, ax_revision, text, reason, own session_id.

The Mac Bridge retains current allowlist, delegated-session scope,
revocation, serialized writers, audit and fresh URL/title verification.
AX refs are random in-memory tokens, short lived, tied to exact browser
identity, window bounds and AX revision. The one-shot ref is consumed before
the helper executes. The helper independently rechecks frontmost application
bundle ID, focused AX window geometry, unique matching web-area URL,
complete tree revision, element fingerprint, enabled state, role, bounds and
secure-input restrictions. No automatic fallback to screen clicks or another
browser is permitted.

If Accessibility consent, the AXWebArea URL, or the helper itself is
unavailable, the result is an explicit blocked error. A successful AXPress
only means that OS dispatched the accessibility action; a separate screen
inspection or persisted readback is required to prove any business effect.

## Controls and release evidence

- Project tests: npm run test:browser:native-parity
- Mac bridge/controller: npm run test:mac, npm test, npm run typecheck
- Swift CI: xcrun swiftc -typecheck mac-host/native-ax/AXBrowserHelper.swift
- Linux cannot compile the Cocoa/AX helper; source-only proof is NOT live Mac
  acceptance or tool provisioning.
- Operator staging: deploy/browser-native-targeting-parity/README.md
- Use the pinned installed baseline hashes in the release manifest. Do NOT
  overwrite customized Mac bridge or customized 29-tool MCP controller
  wholesale; rebase reviewed hunks, retain backups and original profiles.
- Do not operate corporate websites until the operator install and isolated
  macOS AX/Retina smoke tests are verified.

The Love's Saturday 24 Oct 2026 three-site draft/cancel/readback case
is a separate acceptance gate. No Save, Submit, Modify Entry or Log Work;
HCL WOF/CH is a real business restriction and must never be circumvented.
REA's browser-observation surface is passive CDP evidence and is not used
as a replacement native GUI executor.

## Installed focused-control observation and safe paste (28 October 2026)

The operator Mac now has an additive focused-control observation on the
existing `computer_use_focus` response. It reports `window_bounds_points`
from the selected browser window and `focused_control` from the process's
real `AXFocusedUIElement`. The latter includes role, name, text-input status,
protected status, frame, and up to 2000 characters of a non-protected
focused text control's value. Unavailable AX is explicit. Already active
tabs are not reactivated, so observation preserves the selected field.

This is not the full Swift AX tree API described above. It needs no new
tool schema, DOM/CDP connection or browser profile. `semantic_available=false`
still describes the native browser provider; it must not erase the separately
observed focused AX control.

The installed `type_text` operation requires a verified non-protected AX text
control and dispatches one Command-V. It preserves the clipboard's existing
formats and restores them only if the operator has not changed the clipboard
in the meantime. Multiline text is not dispatched as Return keystrokes.
It inserts at the current caret; it does not promise replacement of existing
content. Inspect before/after and never append to an unrelated draft.
Action receipts add a focused-control observation, which can be transitional;
rediscover after title changes and inspect settled state before writing.

On this Mac, `https://teams.cloud.microsoft` was added only after an explicit
operator approval in the supervising chat. The existing 20 origins and strict
allowlist policy were preserved, and only the Mac Bridge was reloaded after
its own delegated session was revoked. Edge's main PID remained unchanged.
These are installation observations for this operator, not authorization to
add more origins or reload a service during another agent's grant.

Native helper hash for this focused-control/paste deployment:
`e1d3ce54718e9e6bf254e8dac4b3b96fd1584e755a526f7f5d163e95861b9b64`.
The original Toyota agent receives its continuation at
`/workspace/_shared/evidence/toyota-sandbox-drafts-20261028/EXECUTE-IN-ORIGINAL-CHAT.txt`.
Draft presence, recipient identity, persistence, and sending remain distinct
business outcomes and must be verified by the executing agent.
