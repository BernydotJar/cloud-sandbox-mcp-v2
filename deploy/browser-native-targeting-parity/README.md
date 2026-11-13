# browser-native-targeting-parity - guarded operator release

This is an immutable review handoff, NOT an automatic install or a proof
of live Mac acceptance. Local Codex/operator owns Mac compile, customized
controller rebase, service restart approval and rollback.

Build from committed and verified Linux source:

    npm run build
    node deploy/browser-native-targeting-parity/build-release.mjs /shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-native-targeting-parity-20261023

The Mac sees the handoff at:

    $HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-native-targeting-parity-20261023

Mac read-only syntax check (does not modify installed code):

    BUNDLE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-native-targeting-parity-20261023"
    node "$BUNDLE/deploy/browser-native-targeting-parity/compile-ax-on-mac.mjs" --inspect

Compile the AX helper to a private staging location:

    node "$BUNDLE/deploy/browser-native-targeting-parity/compile-ax-on-mac.mjs" --compile

The published mac-host/bridge.mjs is a SOURCE REFERENCE; DO NOT copy it
over the customized host Bridge wholesale. The actual local binary has
customizations, original SHA pinned in manifest, and an active LaunchAgent.
Apply reviewed anchored changes from patches/host-bridge.patch to a copy
of the INSTALLED bridge; preserve its other customized blocks. Recheck
node --check and approvals before replacing under a rollback plan.

New files can be copied after review to the installed Bridge directory:
native-targeting.mjs, native-ax-provider.mjs,
native-ax/bin/ax-browser-helper (from staged Mac binary).
The changed native.jxa also needs merge/review, not blind replacement.

The deployed MCP services/computer-use-service.js and mcp/server.js
are customized and mounted read-only inside the container. DO NOT
overwrite their binary registry with dist from this source. Review the
controller patch and merge only include_ax, geometry metadata, and
ax_press/ax_set_value fields into the existing 29-tool registry.
dist files are included for comparison, not live replacement.

Before any host installation:
- hash-verify the manifest and every included file;
- inspect exact live installed SHA, reject drift/unknown variation;
- verify no active delegated Computer Use session;
- back up ORIGINAL installed files and document rollback hashes;
- compile the Swift helper on macOS, verify its AX permissions,
  and smoke only a disposable noncorporate page;
- preserve allowlists, profiles, CDP channels, tokens and enterprise records.
A live service restart requires separate operator approval/maintenance control.

After guarded operator promotion, verify:
- real Retina pixel dims vs System Events point bounds;
- screenshot-relative click on an isolated safe test control;
- native AX snapshot restricted to exact Chrome/Edge tab AXWebArea URL;
- AX press/set_value on disposable fields, stale/disabled/secure rejection;
- session expiry/revocation, cross-tab ambiguity and no duplicate dispatch;
- original Chrome and Edge session isolation and 29-tool compatibility.

Only then permit the separate specifically authorized draft-only 24-Oct
UiPath/HCL/Jira acceptance: enter 8 in verified fields, observe, Cancel and
verify unchanged persisted baseline; never Save, Submit, Modify Entry or
Log Work. Do not bypass HCL WOF/CH.
