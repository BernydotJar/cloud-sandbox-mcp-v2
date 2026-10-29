## Live update — 2026-10-29

Fixture and real Teams self-chat background tests passed. The operative
workflow is documented in `docs/computer-use-v2/BACKGROUND_BROWSER_AX_20261029.md`.
Existing source-only status below is historical. Process-targeted text is a
separate, explicitly enabled helper; pure AX remains free of global input.

## Repair: installation PASS followed by fetch failed (2026-10-26)

The first on-Mac run of v1 reported Swift compilation PASS, user LaunchAgent
bootstrap PASS, then the E2E \`fetch failed\`. The installer only checked
\`launchctl bootstrap\`, which does NOT prove the Node process has reached
\`listen()\`. An independent request through Sandbox V3 to
\`http://host.docker.internal:9779/v1/status\` now returns
\`401 SAME_MAC_AUTH_REQUIRED\`, showing the listener is alive and enforcing
Bearer authentication. The original failure is consistent with a start-up race.

The updated installer requires an authenticated status response before
printing INSTALL=PASS. The updated E2E retries only transient transport
errors; an authentication or provider mismatch is a hard failure. It
also reports missing one-time Accessibility permission separately.

**Already installed Mac:** do NOT reinstall or run repair by default.
Use only the disposable fixture acceptance:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/same-mac-background-ax-20261026"
    node "$BASE/accept-on-mac.mjs" --run

If it says \`SAME_MAC_ACCESSIBILITY_PERMISSION_REQUIRED\`, grant permission
once for the stable \`SameMacAX\` helper in macOS Settings > Privacy &
Security > Accessibility and run:

    node "$BASE/install-on-mac.mjs" --restart
    node "$BASE/accept-on-mac.mjs" --run

If the listener really stops, diagnose without mutation:

    node "$BASE/doctor-on-mac.mjs" --inspect

Only when the diagnostic confirms the listener is down, repair our own
user LaunchAgent, preserving installed runtime, credentials and audit,
adding private stdout/stderr logs, and leaving existing Chrome/Edge and
Computer Use Bridge untouched:

    node "$BASE/doctor-on-mac.mjs" --repair

The repair makes a private backup of the original plist and verifies
an authenticated live status after the scoped reload. It refuses to
overwrite an unknown/customized installed AX server. Do not run it
while the service is already responding.

# Same-Mac Native Background AX — P0

## Architecture decision

The user requires native Computer Use **on this same Mac**, without a VM, second Mac or external drive. The old isolated-Mac proposal was incorrect for this requirement. This worker operates AX elements of a *non-frontmost* application directly. It does not activate apps, synthesize global keyboard or pointer events, restart existing browsers or enable debugging.

Data path: Sandbox V3 MCP -> authenticated localhost service on the Mac (127.0.0.1:9779) -> native SameMacAX Swift helper -> AXUIElementCreateApplication -> exact AX window -> current role/name/revision -> AXSetValue or certified AXPress.

An app can reject AX changes while inactive or activate itself as a side effect. The worker checks frontmost status before and after; AXPress is allowed only for a locally certified app. Full focus preservation is app-dependent, must be tested on the actual Mac, and cannot be guaranteed from source inspection alone.

Apple documentation:
https://developer.apple.com/documentation/applicationservices/1460434-axuielementsetattributevalue
https://developer.apple.com/documentation/applicationservices/1462091-axuielementperformaction

## Mac preflight, installation, acceptance

The package is staged at:

$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/same-mac-background-ax-20261026

Set BASE to that location, then run these commands in Terminal on the SAME MAC:

1. node "$BASE/install-on-mac.mjs" --inspect
2. node "$BASE/install-on-mac.mjs" --install
3. node "$BASE/accept-on-mac.mjs" --run

The inspect command verifies SHA-256 and Swift source compilation without persistent changes. Install compiles a small helper, creates a private user LaunchAgent and a nonactivating disposable test app, without modifying the installed Browser Bridge. Acceptance checks a background Hours field by AX role/name, sets it to 8 without typing, reads it back, presses a certified disposable Apply button and checks a persisted test-only file. No corporate apps are touched.

macOS may require **one-time Accessibility permission** for the stable helper at ~/Library/Application Support/LCH/SameMacBackgroundAX/bin/SameMacAX. If permission was missing, allow it in System Settings > Privacy & Security > Accessibility, then restart only our service:

node "$BASE/install-on-mac.mjs" --restart
node "$BASE/accept-on-mac.mjs" --run

To stop only this service (leaving evidence and audit intact):
node "$BASE/install-on-mac.mjs" --stop

Acceptance also writes an evidence JSON to the shared handoff under mac-host-evidence/same-mac-background-last.json, when the shared mount allows it.

## Enabling real applications

After fixture E2E demonstrates background operation without focus changes, the operator can opt-in a running application by bundle ID, once per application (not per action):

node "$BASE/install-on-mac.mjs" --allow-app com.microsoft.edgemac

AXPress is disabled on unverified applications. The operator can enable it explicitly after testing the app's focus behavior:

node "$BASE/install-on-mac.mjs" --certify-press com.microsoft.edgemac

These only restart this dedicated AX service. They do not restart Edge, Chrome or the main Mac Bridge. No global Tab/Arrow/Enter fallback is permitted when background is required.

## MCP controller wiring

Three new source-level tools: mac_same_background_status, mac_same_background_snapshot and mac_same_background_action.

Once the host installer and the disposable E2E pass, configure the controller with:

SAME_MAC_AX_ENABLED=true
SAME_MAC_AX_URL=http://host.docker.internal:9779
SAME_MAC_AX_TOKEN=(private persistent local token)
SAME_MAC_AX_MACHINE_DIGEST=(local machine digest from installer)

The token lives in ~/Library/Application Support/LCH/SameMacBackgroundAX/token and should not be pasted into chat. Controller-to-host connectivity must be verified from the Docker runtime without exposing the AX port to the public network. The existing 29-tool MCP and authenticated browser sessions remain unchanged until an explicitly validated controller promotion.

## Release gate

Source implementation, lint, typecheck and mock tests: PASS.
Swift compiler on the actual Mac: PENDING.
Native Accessibility permission on installed helper: PENDING.
Background AX fixture, persisted readback and unchanged foreground: PENDING.
Controller MCP deployment and connection: PENDING.

P0 IS NOT CLOSED until a real same-Mac foreground-preserving background AX acceptance passes. This approach does not involve macOS virtual machines or a second Mac.


To start the existing service again after a stop, without reinstalling
or touching the browser Bridge:

node "$BASE/install-on-mac.mjs" --start
