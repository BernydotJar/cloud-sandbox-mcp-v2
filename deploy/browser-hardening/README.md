# Computer Use V2: additive hardening of the existing 29-tool Mac bridge

This operator artifact is deliberately separate from the historical 28->29
`browser-auto` upgrade. The current Mac already has 29 MCP tools after
installation of the browser-auto upgrade from source
`2b23a01167630245b1d2bcdcdfe3faa3d7177f06`.

## Build and verify (Linux workstation, no Mac effects)

From an updated, **clean committed source** checkout, after `npm run verify:v2`:

```sh
node deploy/browser-hardening/build-release.mjs /tmp/my-new-computer-use-hardening-release
node deploy/browser-hardening/verify-release.mjs /tmp/my-new-computer-use-hardening-release
```

The builder requires an explicit **new** output directory. It will not overwrite
the installed original browser-auto release. A release manifest pins the hashes
of the known four pre-upgrade Mac/controller files plus four candidate hashes,
both registry counts (29->29), the originating commit, installer/readme
checksums and a registry probe. These hashes require a separately trusted
signature/verification channel; hashes alone do not authenticate a publisher.

**No delivery, release signature, Mac deployment or restart is implied by build.**
This is an owner-operated, single-Mac overlay, not multi-tenant RBAC. It does
not update the controller image or install new dependencies.

## Safe Mac acceptance (requires separate explicit maintenance authorization)

A trained local operator must verify source provenance and signature with a
trusted release system, transfer an approved immutable release directory, and
run its `install-on-mac.mjs --inspect` first in a maintenance window.

The operator installer checks actual local file hashes, 29-tool contract,
session inactivity, bridge and controller health, active dev-main identity,
and private backup/rollback capability before any `--install` action.

Do not run `--install` unless the user specifically authorizes an upgrade to
the active Mac Computer Use bridge and a scheduled maintenance window is
available. It may briefly interrupt the controller/bridge (NOT Mac browsers).

When explicitly approved, `--install` replaces only four pinned runtime
files, verifies both browser providers, then verifies all 29 tools. On failure
the modified installer restores prior bytes and checks the original 29-tool
registry (not 28). No debug port, profile changes, domain purchases, Mac
browser launches, container recreation or secrets modification are intended.

The strict origin-write policy is opt-in via
`COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY=true`, a separately approved
configuration change. This installer deliberately does not edit `.env`.
Before policy enablement, browsers operate under current 29-tool grants and
existing business-authorization policy.

If the live code hashes diverge from the pinned pre-upgrade state, STOP and
rebase the release on a separately inspected known-good revision. Never force
overwrite custom Mac code. Simulated rollback success is not a substitute
for an independently observed Mac rollback drill.

## Status

Source candidate only. No push, Mac installation, image promotion or
production certification performed.
