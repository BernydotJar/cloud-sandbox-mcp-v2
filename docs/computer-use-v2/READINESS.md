# Computer Use Runtime V2 — readiness decision

## Decision

Implementation and isolated verification: PASS. Production promotion on Eduardo's authenticated Mac Chrome/Edge sessions: HOLD pending explicit host/provider, image-dependency and operational gates below. Do not equate this with a completed enterprise certification.

The implementation is an additive extension of the existing control plane, not a new browser controller container or workstation. The release is built from a versioned baseline of the deployed customized registry and preserves all 23 existing tool definitions exactly, adding five semantic browser tools (28 total). A separate source-tree registry without the older project_register customization is not substituted onto the Mac.

## Verification executed in dev-main

| Gate | Evidence | Result |
|---|---|---|
| Existing native and delegated session tests | Node test runner | 32 passed |
| Persistent runtime, policy, revocation, replay, audit and privacy tests | Node test runner | 42 passed |
| TypeScript/controller/MCP tests | Vitest, 6 files | 26 passed |
| Source quality | lockfile validation, ESLint, TypeScript, build via project_verify verify:v2 | PASS |
| Real isolated Chromium | CDP + native Playwright protocol + full MCP-to-HTTP bridge chain | 13 explicit checks PASS |
| Connection reuse | 30 consecutive discoveries on one existing connection | PASS |
| Customized release registry | Original 23 definitions compared structurally; 5 additions | 28 tools, no existing definition changed |
| Release integrity | 129 staged files, manifest hashes, syntax, Linux Mac-only installer guard | PASS on review bundle |
| Production dependencies | npm audit --omit=dev after targeted upgrades | 0 advisories reported at verification time |

The unit/integration total is 100 tests (74 Node + 26 Vitest). The 13 real-browser checks and release-registry verification are additional acceptance checks, not additional Vitest cases. No network CI run or independent external reviewer is claimed: the GitHub Actions workflow is prepared in source and has not been pushed or executed remotely.

## Findings closed during implementation

1. Playwright ARIA snapshots exposed a dummy password input value in the isolated browser fixture. Fixed by redacting input values and nested value subtrees; a real-browser regression checks the fixture secret is absent. This is not comprehensive DLP.
2. CDP attachment could apply default browser overrides. Enabled noDefaults:true to preserve download/media/focus settings of an existing browser.
3. An attach implementation throwing synchronously could leave a rejected single-flight promise cached. The asynchronous boundary was corrected; failures retain a bounded cooldown.
4. Audit partial-write failure could corrupt the chain on subsequent appends. The ledger now checks byte count and becomes fail-closed after write errors.
5. A request ledger could exhaust after many completed tasks. The bounded cache now changes only when a different valid task capability is authorized; stale capabilities cannot replay events.
6. The repository's baseline production dependency set reported 7 vulnerable packages (including high/critical severities). Updated the source lockfile and scanned it again: 0 reported. This does not automatically update the live controller image; the installer now enforces tested dependency versions before activation.

## Open promotion gates — not hidden as successes

- Confirm the existing Chrome and Edge authenticated profiles can be exposed through an approved endpoint/provider. The official extension is a candidate for session reuse, not an already-installed integration.
- Upgrade/test the current controller image dependencies while preserving its customized /app/dist mount and all Compose settings. The release's dependency-only image recipe is not yet executed on the Mac.
- Run real Mac tests for both browser products, selecting the intended authenticated account, screenshots, innocuous semantic navigation, revocation and reconnect. Linux Chromium testing does not certify Mac Chrome/Edge versions or profile behavior.
- Execute installer/rollback in a maintenance window with no delegated task active. The installer refuses a currently active session; it is not a distributed deployment lock.
- Complete independent security review, artifact signing, centralized retention/rotation and identity/RBAC changes if this expands beyond a single trusted Mac owner. None is claimed complete here.

## Residual limitations

Opaque tab identity and revision guard navigation, not every DOM mutation. Exact locators can still invoke a business-significant action: a browser driver cannot prove a click is not a purchase, deletion or admin change. Agent instructions and explicit business authorization remain essential. Revocation blocks future dispatch; it does not undo an event already in flight. Duplicate suppression is limited to the valid session and current process, not cross-crash exactly-once semantics. Password/file/OTP/credit-card fields are denied by semantic filling policy; arbitrary webpage text/screenshots can still contain personal data.

## Performance interpretation

Evidence JSON records a cold attachment/discovery and 30 warm discoveries in an isolated, local Linux Chromium fixture. Timings exclude ChatGPT reasoning, network round trips, real Mac load, remote page response and actual business workflow execution. These are evidence of connection reuse, not a claim of being faster than GPT's internal Computer Use implementation.
