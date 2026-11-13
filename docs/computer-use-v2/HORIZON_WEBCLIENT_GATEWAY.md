# ADR: External Interaction Gateway for authenticated Horizon Web Client

Status: ENGINE ROUTE IMPLEMENTED AND UNIT-TESTED; production gateway NOT deployed.
Live pilot: 2026-11-02, Sandbox V3 -> operator's existing Mac Edge tab ->
Horizon Web Client -> Windows desktop -> Power Platform. One navigation action
to Inventario de creadores was dispatched via a scoped delegated Edge grant
and its visual result was independently checked. The grant was revoked. No
business record was created, edited or deleted. Verified observation:
15 environments in Power Platform; inventory UI indicated "Mostrando 1.000 de
2.690 elementos" at the time of observation. This is NOT a bulk inventory
extraction, Windows guest DOM inspection, or acceptance of DTI-14819.

## Architecture: an egress of capabilities, not unrestricted host access

                  Cloud Sandbox V3 orchestrator
                   agent task + policy + audit
                              |
                   capability-broker decision
                              |
               existing authenticated Mac Bridge
             (no new public listener or port needed)
                              |
          Edge native browser, exact URL/title/bounds
                              |
              Horizon Web Client + Blast display
                              |
              Windows guest with own Toyota ID
                              |
                  Power Platform Admin Center

The "door to the external world" must be a capability gateway, not a
general SSH tunnel, unrestricted HTTP proxy, credential extractor or
remote Windows agent. Existing Mac Bridge provides an authorized narrow
browser path. The Sandbox Linux workstation does NOT inherit access to
the operator's desktop or Mac browser cookies just because the Bridge
is connected. Any future Mac host agent, desktop AX, API egress or VDI
adapter needs independent policy, identity and auditing.

## Engine selection (current verified path)

The chooseExecutionEngine policy uses a special case only with
remote_surface: horizon_webclient, context: existing_mac,
browser: edge or chrome, an exact expected URL and a matching
live browser tab. This case CANNOT silently fall back to isolated
Playwright, generic DOM, Chrome's different profile or unrestricted
desktop control.

The adapter has three decisions:
1. VDI_VISUAL_READ_ONLY: inspect an existing authenticated tab and
   capture a view, without input. Not a semantic E2E acceptance.
2. VDI_READ_ONLY_VISUAL_NAVIGATION: the operator specifically requests
   navigation, the bridge host is exact and allowlisted, geometry and
   remote frame are observed, native foreground use is accepted, and
   the task is scoped. Use screenshot -> one click -> fresh screenshot ->
   verify visible effect -> revoke grant.
3. All VDI resource mutations, semantic Windows DOM requirements and
   background-only native requests are blocked. A corporate-approved
   workflow is needed for any administrative write.

The observed URL was:
  https://vdi.toyota.com.ar/portal/webclient/#/desktop
Native tab identity strips URL fragments and query strings:
  https://vdi.toyota.com.ar/portal/webclient/
The origin is:
  https://vdi.toyota.com.ar

## Important technical limits

Omnissa Horizon Web Client uses an encoded remote display stream
(Horizon Blast), not a local Windows DOM. The HTML page's DOM identifies
the client shell, not the remote Power Platform controls. Do not claim
that Playwright selectors or browser CDP can reach inside guest Edge.
Neither Selenium nor an extension that can inspect the client DOM
automatically gains semantic control over the Windows guest.

Native browser screenshots and mouse events can work, as verified by
the pilot, but they may activate Edge and are NOT nonintrusive
background automation. The click must be bound to:
- a recently discovered exact browser tab URL and title;
- a fresh actual window rectangle, using screenshot pixels converted
  to global macOS screen points;
- a task-specific delegated session grant for that browser;
- one intended, read-only navigation target;
- an independently captured post-action result.

The installed MCP tool schema does not yet expose screenshot_ref plus
coordinate_space=screenshot_pixels even though the underlying Mac Bridge
supports both. The live navigation used Mac screen points measured from
the verified window rectangle, followed by visual readback. That is
acceptable as a narrowly scoped operator-supervised pilot, but not yet
production-ready for repeated or background visual targeting. Next
tool-surface release should expose short-lived screenshot geometry refs
with stale-window and identity checks, not just raw global x/y.

A click dispatch receipt is not a business outcome or persistent readback.
Corporate controls can prohibit screen capture, clipboard transfer or
synthetic input. If blocked, stop and use an approved manual or API path.
No bypass, alternate transport or guest-side helper is authorized by
this pilot.

## Proposed V3 External Interaction Gateway (future)

Implement typed capabilities such as:
- browser.observe: exact origin/tab + redacted screenshot or DOM evidence;
- browser.navigate: one scoped navigation action with readback;
- mac.ax.observe: exact signed app/bundle/window via macOS Accessibility;
- mac.ax.act: certified accessible control only, explicit operator scope;
- vdi.visual.observe: image-backed remote view only;
- vdi.visual.navigate: foreground-only, policy-approved navigation;
- api.call: explicit destination/method/tenant, not an arbitrary HTTP proxy;
- host.command: approved executable/args and sandboxed output, not shell eval.

Each capability lease should be bound to:
host identity, operator identity, browser profile identity, allowed origin,
app/window/tab identity, action type, expiry, revocation, per-action receipt
and a privacy/redaction policy. Human operator authentication, corporate
VDI restrictions and application RBAC remain inside existing systems.
No copied browser profiles, cookies, tokens, passwords, port scanning,
new public Cloudflare routes or shadow Windows sessions.

Prefer native extension-DOM semantic automation for non-VDI websites
when an approved profile and reliable controls exist; isolated
Playwright for regular QA; and a separate authorized Windows UIA/API
connection only if Toyota explicitly provides one. Never label a
foreground click as background execution.

## Next engineering gates

- Gate H0 PASSED: live native Mac browser discovery at exact HTTPS
  origin, allowed browser action and screenshot readback.
- Gate H1 PENDING: verify VDI identity, Windows session and corporate
  authorization for the proposed automation scope (the avatar is not
  proof of the username or tenant).
- Gate H2 PENDING: sustained visual target mapping, window resize /
  high-DPI safety, repeated navigation and stale target adversarial
  testing on the already authorized VDI.
- Gate H3 PENDING: security/privacy retention and corporate screen
  capture/input policy review for any unattended or production usage.
- Gate DTI-14819 PENDING: read-only identification of the two named
  cloud flows, Flow IDs, Environment IDs, owner, connections,
  last run and Default-vs-DEV reconciliation with evidence.
- Existing Graph Harness GH04/GH05 remain independent and unchanged.

No host runtime, browser, VDI, network or policy configuration is
modified by this ADR or the pure engine route. It is a selection
contract only; the observed pilot used existing connected tools.
