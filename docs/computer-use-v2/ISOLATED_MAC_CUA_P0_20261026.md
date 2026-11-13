# Sandbox V3 — P0 isolated native macOS Computer Use

## Current actual state (2026-10-26)

**P0 operational acceptance: OPEN.** The current 29-tool MCP Bridge
is connected and can access Chrome/Edge through the configured browser
providers. It does not expose macOS Terminal.app or an independent
macOS GUI worker. Another agent has an active Edge delegated session:
do not take over or revoke it.

The separate-worker source has been implemented under
\`mac-host/isolated-desktop\` and is tested in the Linux workstation,
but the guest Swift code, macOS permissions, independent desktop
and foreground noninterference are not yet E2E-verified.
Do not substitute Linux \`workspace_exec\` or native foreground
keystrokes for an isolated Mac GUI.

## Mac hardware and capacity

Operator Mac reported: macOS 26.7.1, Apple Silicon, hypervisor
available, 24 GiB RAM, 16.81 GiB free (96% used) and Tart not installed.
The operational VM storage gate is 80 GiB available; the internal
shortfall is approximately 63 GiB. No automatic cleanup, Tart
installation or VM provisioning is allowed at that capacity.

Possible VM host: a confirmed external, writable APFS volume with
at least 80 GiB free, or another physical Mac. External support
is **not yet verified**, and the second-Mac route has no connected
worker at present. Tart VM/image storage defaults to \`~/.tart\` and
Tart's own pull/clone may automatically prune cache; before any
future VM operation, select external \`TART_HOME\` and set
\`TART_NO_AUTO_PRUNE=\` to preserve caches.

## One diagnostic command on the operator Mac

\`\`\`bash
BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use"
node "$BASE/isolated-mac-cua-20261026/collect-on-mac.mjs" --collect
\`\`\`

The script validates both release manifests and file hashes, then
runs foreground AX Swift typecheck, the three isolated-worker Swift
typechecks, and the host/external-volume read-only capacity probe.
It writes private evidence to:

\`$BASE/mac-host-evidence/last-host-native-gate.json\`

The evidence can subsequently be read by Sandbox V3 directly without
asking the operator to re-run or paste the entire diagnostic.

## Release gates

| Gate | State |
| --- | --- |
| Real Apple Liquid Glass in splash preview | PASS |
| AX Swift syntax errors corrected in source | PASS |
| AX native Mac typecheck of corrected source | PENDING |
| Swift guest helper/fixture/observer typechecks on Mac | PENDING |
| Actual external APFS VM candidate or separate Mac | PENDING |
| Independent macOS GUI worker provisioned | PENDING |
| Guest AX and Screen Recording permissions | PENDING |
| Guest fixture AX targeting/persisted readback | PENDING |
| Operator app focus/keyboard/cursor unaffected E2E | PENDING |
| Controller tools attached to guest over private channel | PENDING |

Do not mark P0 GO before the actual worker E2E demonstrates focus
noninterference. No remote debugging, profile modifications,
corporate timesheet changes, or browser session interference are required.

## Source references

- \`mac-host/isolated-desktop/README.md\` (worker rollout and recovery)
- \`docs/computer-use-v2/BACKGROUND_EXECUTION.md\`
- \`docs/computer-use-v2/LIQUID_GLASS_AX_BACKGROUND_20261026.md\`
- https://developer.apple.com/documentation/virtualization/running-macos-in-a-virtual-machine-on-apple-silicon
- https://github.com/openai/tart/blob/main/docs/faq.md
