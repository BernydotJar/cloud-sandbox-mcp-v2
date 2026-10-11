# Computer Use Runtime V2 — implementation contract

Mode: SHIP. User approved evolution on 2026-10-10. Implementation and isolated tests authorized; do not interrupt live delegated sessions, relaunch user browsers, alter their profiles, expose debugging ports, or change administrative accounts as part of this work.

## Current baseline

Repository HEAD 6356ac3 contains the native JXA host, transient window/tab indices and bounded task sessions. The deployed customized controller differs from upstream: it preserves project_register and the single dev-main workstation. The live bridge reports dynamic discovery and delegated-session support. A live task session existed during inspection; deployment must refuse while a delegation is active.

## Deliverable

Persistent, attach-only browser runtime inside the existing Mac bridge: one connection per configured Chrome/Edge provider, reusable opaque tab references, versioned page state, strict semantic locators, screenshots, bounded task authorization, serialized mutations, replay suppression and safe diagnostics. Keep native tools intact as explicit fallback. Never silently switch a failed semantic action to coordinate clicking or replay a mutation.

## Provider policy

Support Playwright connectOverCDP and Playwright protocol connections through explicitly provisioned numeric loopback endpoints only. Do not guess or scan ports. Dynamic browsing authorization applies to web pages; browser-internal pages remain excluded. No domain registration required when existing dynamic mode is enabled. No endpoint, filesystem path, arbitrary JavaScript/CDP command, cookies, storage dump, file upload or browser launch/close command in the public tool schema.

Authenticated default-profile reuse must be established separately. Chrome 136+ rejects remote-debugging flags against its default data directory. The official Playwright browser extension supports existing tabs and authenticated profiles; this release must not pretend an extension or endpoint exists before provisioning. Existing native automation stays operational when the persistent provider is absent.

## Acceptance gates

CUV2-1: concurrent discovery shares one lazy connection; tabs get stable opaque references without global index assumptions.
CUV2-2: reconnect invalidates previous refs; tab closure and navigation revisions fail safely.
CUV2-3: exact role/label/test-id locators resolve uniquely; password/file inputs are not filled; unsupported actions fail validation.
CUV2-4: delegated sessions are checked before work and immediately before dispatch; scope, expiry, action budget and revocation enforced; no local prompt per in-session action.
CUV2-5: explicit request_id suppresses duplicate events within the live process/session, conflicting replays fail, uncertain mutations are not retried; no exactly-once claim across crashes.
CUV2-6: append-only structured audit records omit content, typed text, raw URLs and session tokens; audit unavailable before dispatch denies the mutation, failure after dispatch never triggers replay.
CUV2-7: native tool compatibility and customized controller project_register preserved; source, build, package and deployed state distinguished.
CUV2-8: real isolated Chromium exercises connect/discovery/semantic read/click/fill, stale state, disconnect and reacquisition. No logged-in user profile in test fixtures.
CUV2-9: publish rollout manifest/dry-run/rollback and explicitly report unverified Mac Chrome/Edge provisioning and real UI gates.

## Trust boundaries and residual risks

A browser click cannot be reliably classified as a payment/deletion/DNS change from coordinates or a label alone. Session scope is technical browser authorization, not proof of business authorization. The agent must follow the user's task limits; semantic runtime denies unsupported operations but cannot guarantee that a permitted click has no consequential side effects. Page content is untrusted. ARIA content and screenshots can contain personal data and are returned only on explicit inspection, never stored as audit payloads. Cancellation prevents new dispatches; an event already sent may still complete.

## Official implementation references

- https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
- https://playwright.dev/docs/api/class-browser#browser-close
- https://playwright.dev/docs/actionability
- https://playwright.dev/mcp/configuration/browser-extension
- https://developer.chrome.com/blog/remote-debugging-port
- https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/
