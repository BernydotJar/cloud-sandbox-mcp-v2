# Sandbox V3 - Isolated Native macOS CUA Worker

Date: 2026-10-26
Status: SOURCE READY; LIVE P0 ACCEPTANCE PENDING.

## Architecture

- Primary Mac: operator's own focus, keyboard, mouse and authenticated apps remain untouched.
- Second macOS session: Apple Silicon macOS VM (if resources permit) or a separate Mac. A completely distinct machine identity is mandatory.
- Guest: per-user Aqua LaunchAgent with a Node listener bound exclusively to 127.0.0.1:9777.
- Guest native AX: GuestAX.swift locates controls by app bundle, exact window, role, name, fresh revision and node fingerprint. Only AXPress/AXSetValue execute; no blind Tab or coordinate clicks.
- Guest screenshot: captures the GUEST desktop only, with guest Screen Recording permission.
- Controller: mac_background_cua_status, mac_background_cua_snapshot, mac_background_cua_action and mac_background_cua_screenshot, behind an authenticated local forwarding channel.
- Idempotency: a persistent intent/outcome ledger prevents automatic retries after crashes or uncertain actions. A reported dispatched action is not persistence proof.
- The current operator Mac Bridge, Docker, root access, workspaces and browsers remain unchanged. No Remote Debugging is required.

Official Apple virtualization reference:
https://developer.apple.com/documentation/virtualization/virtualize-macos-on-a-mac

## Preflight on your main Mac

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/isolated-mac-cua-20261026"
    node "$BASE/preflight.mjs" --inspect

This is read-only. It detects OS, arm64 support, hypervisor, memory, actual HOME filesystem headroom and a SHA-256-derived machine identity. It does NOT create or download any VM. Our operational gate for a local macOS guest is at least 80 GiB available and 16 GiB total host RAM. This is a conservative project gate, not an Apple-mandated universal minimum. A second Mac is an alternative.

## Install on a separate Mac or already-provisioned VM

Copy the release bundle to that separate machine through an authenticated file-transfer channel. On the GUEST only:

    node ./install-guest.mjs --inspect
    node ./install-guest.mjs --install <OPERATOR_MACHINE_DIGEST_FROM_PREFLIGHT>
    open -a "$HOME/Library/Application Support/LCH/IsolatedMacCUA/AXFixture.app"

The guest installer refuses the same physical machine identity as the operator; requires the Aqua GUI session; compiles the Swift helper and fixture; creates a user-scoped LaunchAgent; generates a private token; allows only the disposable fixture initially. The guest may require one-time macOS Accessibility and Screen Recording consent for its own agent. No per-action approvals are introduced.

For emergency stop on the GUEST:

    node ./install-guest.mjs --stop

This stops the guest LaunchAgent and preserves all audit and fixture data.

## Connect without a public guest port

On the main Mac, use an existing trusted SSH host alias with pinned host key:

    ssh -N -o BatchMode=yes -o StrictHostKeyChecking=yes -L 127.0.0.1:9777:127.0.0.1:9777 <guest-ssh-alias>

Copy the generated guest token into a private 0600 token file on the main Mac, without printing it in this chat. The script acceptance.mjs reads MAC_CUA_WORKER_TOKEN_FILE and connects to the local forwarded port only. No extra per-command approval is needed.

    node "$BASE/acceptance.mjs" --inspect
    node "$BASE/acceptance.mjs" --accept

Acceptance verifies distinct machine identity, GUI and AX readiness, AX-targeted set_value of the fixture's Hours field to 8, fresh AX readback, press of the unique Apply button and independent saved fixture-state readback. It must not touch existing corporate timesheets or authenticated operator-browser tabs.

The Home Mac's HostFocusObserver.swift can be compiled with xcrun swiftc and run concurrently to observe operator foreground-app activations and cursor movement without generating OS input. Any unexpected interference makes the P0 NO-GO.

## MCP controller promotion

The currently installed 29-tool controller has NOT been updated. After the guest passes acceptance and its SSH forwarding is verified reachable from Docker, enable the separate worker settings on the customized controller, retaining the existing Mac Bridge and all 29 original tools:

- MAC_BACKGROUND_CUA_ENABLED=true
- MAC_BACKGROUND_CUA_URL=http://host.docker.internal:9777 or http://127.0.0.1:9777 when directly reachable from the controller container
- MAC_BACKGROUND_CUA_TOKEN (32+ characters, secret)
- MAC_BACKGROUND_CUA_OPERATOR_MACHINE_DIGEST (the operator's preflight digest)

Do not expose port 9777 on 0.0.0.0 or the LAN to fix a Docker networking problem. If the SSH localhost forward is unreachable from the controller, a separately reviewed private relay is required; it has not been implemented here.

Promote the new controller source only after reviewing exact installed versions and backing up its existing configuration. The optional new tools must return NOT_READY until the separate GUI worker passes real tests.

## Acceptance matrix

- P0-A: Actual operator Mac preflight and OS/hypervisor resources: PENDING.
- P0-B: Independently booted macOS GUI worker, machine ID different: PENDING.
- P0-C: Guest AX binary Swift compile and OS TCC authorization: PENDING.
- P0-D: Fixture AX inspection, deterministic action and persisted readback: PENDING.
- P0-E: Operator Mac remains unaffected while user continues working: PENDING.
- P0-F: Private tunnel and controller MCP tools connected to that worker: PENDING.
- Source tests, identity rejection, authenticated HTTP, replay protection, AX and controller tool contracts: implemented; verify with npm.

GO requires all live gates, not just source tests. The prior 40 hours already saved in UiPath/HCL remain untouched. No Saturday draft rehearsal or corporate writes are part of this P0 acceptance.
