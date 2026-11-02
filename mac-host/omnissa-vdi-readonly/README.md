# Omnissa Horizon / Toyota VDI - read-only host diagnostic

This experiment answers one narrowly scoped question: can the operator's
current macOS session see the Omnissa Horizon HOST window via native
Accessibility, and are Screen Recording permissions already granted?

It does not claim to see Edge's Windows DOM inside the remote VDI.
AX controls exposed by a Mac Horizon Client are NOT necessarily the
remote Windows' AX/UI Automation controls.

## Run the pilot on the operator's actual Mac

With Omnissa Horizon Client already open, run:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/omnissa-vdi-readonly-20261102/inspect-on-mac.mjs" --inspect

No sudo, installs, debugger ports, app activation, frontmost switching,
TCC consent prompts, screenshots, keyboard/mouse events, remote VDI code
or Power Platform changes. Reads only process identity, AX role metadata,
counts, Screen Recording permission preflight and the existing localhost
SameMacAX service's authenticated status (if installed). Never displays
a Windows/VDI screen title, field value, table content or token.

The embedded Swift source SHA-256 must match the wrapper before it runs.
Requires Apple's Swift toolchain on the Mac; if unavailable the tool
returns SWIFT_TOOLCHAIN_OR_NATIVE_INSPECTION_FAILED without changing
the system. Swift does not run within the Linux workstation.

## Interpret outcomes

- OMNISSA_CLIENT_NOT_RUNNING: no matching running Horizon Client app.
- OMNISSA_APP_IDENTITY_AMBIGUOUS: multiple matching processes or no
  unique bundle identifier; inspect installation manually.
- HOST_ACCESSIBILITY_PERMISSION_NOT_GRANTED: the Terminal/Swift
  process cannot query AX; DO NOT bypass macOS TCC.
- NO_ACCESSIBLE_HORIZON_WINDOW: host AX cannot enumerate a window.
- HOST_AX_VISIBLE_WINDOWS_GUEST_SEMANTICS_UNVERIFIED: a native
  Horizon window is visible, NOT proof of Windows DOM accessibility.
- SCREEN_RECORDING_PERMISSION=YES: a permission preflight only,
  NOT a working captured VDI image.
- EXISTING_SAME_MAC_AX_SERVICE=READY: independently installed Mac
  helper responds, but a target app must still be explicitly allowlisted.
- OMNISSA_ALREADY_ALLOWLISTED_IN_AX=NO: no app-specific helper
  authorization; NEVER auto-allow corporate VDI.

## Decision criteria and next gate

Gate A - Mac host discovery: unique Omnissa process and at least one
AX window without focus changes. If this fails, do not request any
remote-desktop interactions.

Gate B - VDI pixel/semantic visibility: must be separately tested
with the operator's permission and Toyota policy. AX role counts on
the host do not prove controls inside the remote Windows session.
If VDI is a rendered framebuffer, visual Computer Use with window
identity, masked captures, accessibility permissions and explicitly
scoped UI actions may be required. Screen protection/black frames
and corporate controls are hard stops, not errors to bypass.

Gate C - Toyota DTI-14819: once the authorized VDI read path is
verified, inspect the two flows and inventories (Environment ID,
Flow ID, ownership and last run) in a dedicated READ-ONLY session,
then reconcile Default vs DEV. Do not change ownership, connections,
environment settings or publish anything. Verify the correct corporate
identity and tenant inside the VDI; the Mac browser session may differ.

This source/pilot intentionally does NOT register mac_list_apps,
mac_list_windows, mac_accessibility_tree or generic Omnissa
control as available MCP tools. A separately reviewed, opt-in Mac
Bridge release would be needed for agent-operated native VDI control.
