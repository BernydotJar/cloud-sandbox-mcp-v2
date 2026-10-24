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

Only AX nodes in the single URL-bound AXWebArea of the frontmost, exact
browser tab are exposed. The Swift executable does not return textbox values,
secure fields, passwords, tokens, browser chrome, other apps or raw URLs.
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
