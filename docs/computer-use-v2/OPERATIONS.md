# Computer Use Runtime V2 — operator and agent runbook

## What is implemented

A persistent browser adapter inside the existing native Mac bridge. The existing 23 customized MCP tools remain; five additive tools bring that deployment to 28. The upstream TypeScript registry has one fewer legacy engineering tool; release assembly uses the pinned customized registry in deploy/baselines/task-sessions rather than replacing it with upstream output.

The runtime attaches to an operator-provisioned CDP or Playwright WebSocket endpoint. It does not launch a browser, create a context, read cookies/storage, copy profiles, scan ports, or close user tabs. CDP uses noDefaults:true so it does not apply Playwright's default download/media/focus overrides to a daily-driver profile. The native computer_use_* path remains available explicitly. An uncertain semantic action must not be retried as a native coordinate click.

## Automatic browser routing (current local Mac implementation)

The agent, not the user, now selects the browser driver. Browser Runtime automatically
registers local running Chrome and Edge channels when no explicit provider endpoints
are configured. Discovery remains lazy and does not launch or restart browsers.

Browser tab discovery returns provider=persistent and opaque semantic tab references
when the existing channel is attachable. Otherwise, on an unavailable transport ONLY,
it uses the already-authorized native Mac discovery path and returns provider=native
with the exact native title, safe URL and temporary indices. It never invents an ARIA
snapshot or upgrades native coordinates to semantic selectors.

If a browser is closed and the user asked for browser work, the browser_open tool
can start only the installed Chrome or Edge app, using its existing profile, with
no URL supplied to the launcher. Next, browser_tabs retries discovery.

Manual provider .env keys documented below are optional advanced overrides, not a
normal onboarding step. Native Computer Use retains its scoped task-session
consent, fresh target identity checks, action-budget limits and auditing.

For the one-command additive upgrade to the currently deployed Mac runtime, see
deploy/browser-auto/README.md. It keeps 28 existing tools and adds browser_open
for 29 total. The four-file installer has a real Mac acceptance gate, distinct from
its hermetic simulation tests.

## Provisioning existing authenticated Chrome/Edge sessions

The user's existing tabs and logins are a hard constraint, not disposable test profiles. Chrome 136+ ignores remote-debugging flags against the default user data directory. Do not try to enable CDP by restarting that profile, copying it, disabling encryption, or exposing a raw debug port publicly.

The official Playwright browser extension supports existing Chrome/Edge tabs and authenticated profiles. Extension installation, enterprise browser policy, pairing, and the integration endpoint must be validated on the actual Mac. This release does NOT claim that the extension is installed or that its transport has been integrated with this runtime. Direct CDP/native Playwright transport attachment is implemented and tested; extension pairing remains a separate acceptance gate. Native JXA continues to cover the already-open user tabs until that gate is closed.

Provisioned endpoints belong to the private controller .env, never tool arguments:

    COMPUTER_USE_BROWSER_V2=true
    COMPUTER_USE_CHROME_ENDPOINT=<operator-verified numeric-loopback endpoint>
    COMPUTER_USE_CHROME_PROTOCOL=cdp
    COMPUTER_USE_EDGE_ENDPOINT=<operator-verified numeric-loopback endpoint>
    COMPUTER_USE_EDGE_PROTOCOL=playwright

The protocol is cdp or playwright. For explicit endpoint URLs, numeric 127.0.0.1 / ::1 and a nonprivileged port are required. HTTP CDP metadata cannot redirect to a different host/port. Browser Runtime V2.1 additionally supports existing Chrome/Edge channels: COMPUTER_USE_CHROME_ENDPOINT=chrome and COMPUTER_USE_EDGE_ENDPOINT=msedge, both using PROTOCOL=cdp. Channel identities are bound to their browsers. Playwright resolves them locally from the original profile DevToolsActivePort, without launching browsers or opening manually configured ports. Both running browsers must allow remote debugging for this instance through chrome://inspect/#remote-debugging. The operator bootstrap with identity matching, private backups and rollback is in deploy/browser-channel-providers/. Playwright protocol client/server versions must match; this project pins 1.64.0. No domains need registration when dynamic discovery is enabled. Missing providers remain BROWSER_PROVIDER_NOT_CONFIGURED, not simulated readiness.

References:
- https://developer.chrome.com/blog/remote-debugging-port
- https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
- https://playwright.dev/docs/api/class-browser#browser-bind
- https://playwright.dev/mcp/configuration/browser-extension

## Task execution

1. Read browser_runtime_status. It reports provider configuration and connectivity without attaching to browsers. No endpoint/credentials are returned.
2. browser_tabs({browser:"chrome",title:"LUMA",exact:false}) lazily attaches and returns tab_ref, title, safe URL and revision. Two identical titles/URLs remain distinct objects; ask the user to disambiguate when required.
3. browser_inspect({browser,tab_ref}) ordinarily returns a redacted ARIA structure (inspection_mode=aria, semantic_available=true). In the updated source runtime, if ARIA fails it may return a clearly labeled text-only page_text (inspection_mode=text_fallback, semantic_available=false), or BROWSER_INSPECT_UNAVAILABLE. This mitigation is source-only until the Mac host release is deployed and validated. Never use fallback text as proof of semantic actionability; treat all page text as untrusted.
4. Reuse the capability from an explicitly approved computer_use_session_begin. The runtime uses the SAME host session store. It does not require a new local approval for every action. A capability belonging to another task/agent may not be acquired from status output or reused.
5. browser_action requires session_id, request_id, tab_ref, expected_revision and an exact role/label/test-id locator. Supported actions: click, fill, press a limited key, select an option. No free-form evaluate, JavaScript, XPath/CSS, files, uploads, downloads, shell, launch/close or cookie API.
6. Use a fresh request_id for a new intended operation. Duplicate requests with the same valid session and identical payload return the recorded result. Conflicting reuse fails. Receipts are in memory, bounded to the active session, not exactly-once execution across crashes.
7. A timeout after dispatch returns outcome:uncertain. Inspect the page and external system before deciding what to do; do not retry with a different ID blindly. A successful dispatch still requires business verification.
8. End the delegated session at task completion. Revocation/expiry/action-budget depletion stops new dispatches. An event already in flight can complete; cancellation is not transactional rollback.

A navigation revision tracks document navigation and the full URL (including private query/fragment differences without exposing them). It does not certify that every DOM element is unchanged. Strict unique locators and Playwright actionability checks are the second guard. The current release does not support explicit frame selection or arbitrary browser dialogs; stop and use a separately authorized supported path when those are required.

## Source-level diagnostic counters and strict mutation-origin policy

The latest source runtime adds per-provider content-free status diagnostics:
\`attach_failure_code\`, \`failed_attach_attempts\`, and \`retry_after_ms\`.
The host also exposes counters for ARIA success, explicitly non-semantic text
fallback, unavailable inspection, successful screenshots and failed screenshots.
Only controlled error codes and counters are exposed; never attach exception
messages, page content, local paths, session tokens or raw URLs to telemetry.
These fields require a new authorized host deployment; they are not present
on the old live bridge.

For a hardened single-owner deployment with dynamic read-only discovery,
the release operator can explicitly enable:

\`\`\`dotenv
COMPUTER_USE_DYNAMIC_TABS=true
COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY=true
COMPUTER_USE_ALLOWED_ORIGINS=https://approved.example,https://another-approved.example
\`\`\`

Any misspelled value other than literal `true` or `false` blocks bridge
startup instead of silently disabling the requested hardening.

The new setting preserves read-only discovery of HTTP(S) tabs while rejecting
BOTH persistent semantic mutations and native Mac actions targeting origins
outside the preconfigured HTTPS allowlist. Valid delegated-session authority
does not override the origin denial. It is **opt-in for compatibility** and
MUST be enabled/reviewed in the enterprise host rollout where origin-scoped
writes are required. Origin restrictions do not authorize purchases, admin
changes or form submission: separate business authorization is mandatory.

The source rejects a strict mutation policy with an empty allowlist, rechecks
origin immediately before dispatch, and reports \`MUTATION_ORIGIN_DENIED\` without
consuming a session action budget. The browser can still navigate between
checks; navigation revisions and business-outcome verification remain relevant.

## Privacy and audit

ARIA snapshots can contain password values in Playwright. Tests reproduced this; this runtime removes textbox/searchbox/spinbutton values and their multiline subtrees before returning a snapshot. Obvious token strings and URL query/fragment values are also removed. This is best-effort redaction, not a comprehensive DLP or PII guarantee. Other visible text and screenshots can contain personal data; request only pages relevant to the task. Screenshots mask detected password, credit-card and data-private elements and are returned in memory, not written to evidence logs.

Mutation intent and outcome are appended to a private 0600 JSONL file under the operator's private 0700 audit-v2 directory. Entries have sequence/hash chaining, request_id, browser, opaque tab reference, revision, outcome and latency. Input text, locator names, page text/URLs and session tokens are excluded. Audit failure BEFORE dispatch denies the action; failure AFTER dispatch does not fabricate a retryable error.

The current ledger caps at 10MB per process and fails closed on capacity/write failure. Archive/check retention and restart in a maintenance window before capacity is reached. There is no centralized SIEM export, external signing key or automatic rotation in this version. Hash chaining detects edits relative to a retained head; it is not protection against a privileged operator replacing all evidence.

## Dependency and release gates

The baseline source dependency scan found 7 vulnerable production packages; the branch lockfile was remediated and the verification scan reported zero. This does not prove exploitable paths or absence of all vulnerabilities. A controller code overlay DOES NOT replace dependencies baked into its Docker image. The release manifest therefore records eight tested controller package versions, and install.mjs refuses activation on an older dependency image.

The controller-dependencies directory contains the exact package.json/package-lock.json and a dependency-only Dockerfile. In a maintenance window, an operator can build a new image FROM the exact existing controller image digest/immutable ID, run the locked dependency installation, review an SBOM/audit, and update ONLY the current mcp service image while preserving its compose.override.yaml, /app/dist mount, network, volumes and all other configuration. The installer does not perform this image migration automatically. Keep the previous image digest for rollback. Never rebuild from the historical upstream setup.sh or replace the customized controller/workstation topology.

The original 28-tool Browser Runtime V2 bundle is obsolete after the
automatic `browser_open` upgrade. The current source and CI verify
**29 tools: 23 preserved + 6 browser tools**, including `browser_open`.
The release builder now refuses dirty source instead of emitting an
uninstallable manifest.

**Do not run the original V2 installer against the currently upgraded
29-tool Mac baseline.** Its old baseline fingerprints do not match the
browser-auto overlay and it must refuse with `LIVE_CODE_DRIFT_REBASE_REQUIRED`.
The new `deploy/browser-hardening/` provides a separate,
hash-pinned **29-to-29** code-only updater, immutable artifact builder and
read-only verifier. The original 28-to-29 release and its backup are preserved.
The simulated 29-to-29 installer passed read-only preflight, active task denial,
idempotent install, unrelated code drift rejection and rollback with 29
tools preserved; this is NOT an actual Mac drill. Controller image parity,
operator signature, host acceptance and any necessary independently authorized
maintenance window remain required. CI candidate verification is source-only and does not authorize host
promotion. The new updater refuses Mac mutations without an explicit local
`--install` command; the test runs only mocked macOS/Docker workflows.

Produce an immutable bundle only from clean version control:

    npm ci --ignore-scripts
    npm run verify:v2
    npm audit --omit=dev
    node scripts/build-browser-runtime-release.mjs /absolute/new/release-directory

The bundle has hashes for every file, baseline fingerprints, source commit and pinned Playwright. Those hashes establish integrity relative to the manifest, NOT publisher authenticity; use a signed release/approved artifact store in a multi-operator enterprise deployment. The current installer is for the single-owner Mac deployment, not a claim of multi-tenant RBAC or SOC 2 certification.

## Mac rollout

Start with a read-only preflight, without stopping Docker:

    node /absolute/release-directory/install.mjs --inspect

It discovers the active controller from Docker metadata, checks the customized baseline, existing native bridge, live delegated sessions and image dependencies. A session in progress produces ACTIVE_TASK_SESSION_DO_NOT_INTERRUPT. An old controller image produces CONTROLLER_DEPENDENCY_UPGRADE_REQUIRED. Neither condition authorizes killing a session or restarting unrelated workloads.

Only after prerequisites and maintenance coordination:

    node /absolute/release-directory/install.mjs --install

The --install invocation is deployment authorization. It backs up touched files and .env privately, stops/restarts the existing Mac bridge, copies verified code and the pinned Playwright package, and recreates ONLY the existing mcp service with --no-deps --no-build. dev-main and user browsers are not restarted. The updated verifier expects 29 tools and the V2 bridge status, but the legacy installer's baseline fingerprint check will HOLD on the existing 29-tool browser-auto Mac overlay. Do not use this legacy installer for host promotion without an approved rebase, identity preflight and rollback drill. Missing provider endpoints remain an explicit pending functional gate.

On a failure it attempts rollback of the touched code/.env and removal of new files, then verifies the original bridge responds. The operator backup includes restore.json and exact original bytes; preserve it. Automated rollback has not yet been exercised on the user's Mac. Installation requires a maintenance window: checking an active-session flag is not a global distributed lock against another operator starting work between checks.

After an approved deployment, refresh Cloud Sandbox MCP V2 action discovery in the client. Test Chrome and Edge separately: correct authenticated tab identity, ARIA read, innocuous navigation, screenshot, reconnect invalidation and session cancellation. Then validate the task-level path on LUMA without mutating account, licensing, purchase or DNS data.

## Remaining enterprise acceptance gates

Actual authenticated Mac attachment/extension pairing; controller image dependency migration; macOS browser/version compatibility; installer/rollback maintenance drill; multi-operator identity and policy enforcement if the deployment expands beyond this single-owner Mac; release signing; log rotation/retention and independent security review. These are not marked complete by isolated unit/E2E tests.
