# Teams DOM backend candidate — 29 October 2026

The operator requires Sandbox V3 to interact with the existing authenticated
Toyota Edge session while continuing to use other apps/windows. The previous
native AX route was not sufficient: real Teams accepted direct setter calls
without changing the composer. Process-targeted Unicode input also cannot
safely distinguish two foreground/background windows in the same Edge process.
These are backend limitations, not evidence that a Teams draft was saved.

## Architecture and scope

An MV3 extension runs only on https://teams.cloud.microsoft in the selected
Edge profile. The existing browser_tabs / browser_inspect / browser_action
tools dispatch through the Mac Bridge to a private Unix broker, a Native
Messaging host, and a content script in the exact tab. There is no CDP,
debugger port, OS keyboard/pointer event, app activation or cookie transfer.
The operator sees the ordinary installed extension and its browser permissions.

The extension needs nativeMessaging, storage (its own random profile instance)
and the single Teams host permission. It has no global tabs, cookies, history,
debugger, scripting or all-sites permission. Native Messaging registration
allows only its fixed extension ID, in Edge. The broker accepts a local private
secret and exact extension origin, rejects incognito/other profile instances,
and keeps a private profile pin. The pin binds this installation, not corporate
identity: account and chat recipient must still be observed before writing.

Typed DOM operations only; no arbitrary JS, CSS selectors or host commands.
Exact live control, unchanged document/full URL/title/value fingerprint and
fresh snapshot are mandatory. Protected fields are omitted. Editable values
are returned only as empty or digest/length. Rich edit uses the browser editing
command and real input event, with no direct textContent write fallback.
A nonempty rich composer cannot be overwritten with another nonempty value.

The host still checks own grant, current origin policy and shared busy state.
Disconnection, expiry, changed URL/control or uncertain dispatch cannot trigger
automatic native input or mutation replay. Once configured, Edge DOM discovery
fails visibly on disconnection. Existing native references retain their native
route; the controller tool inventory and all existing origin rules are preserved.

## Actual evidence and boundaries

Isolated Linux Chromium passed real extension loading, Native Messaging,
profile pin, private Unix connection, HTTP bridge and existing MCP tool calls.
It filled a rich editor with a trusted browser input event, read its digest,
reloaded and confirmed persistence, cleared and independently verified empty.
A separate operator tab stayed active and unchanged. No sends and zero calls
to the native transport. Replaced node, changed full URL, duplicate locator,
wrong profile/origin/grant, code drift and replay tests reject.

This fixture is not real Mac Edge or Toyota Teams. Installation and live
acceptance remain pending; do not report live capability from the fixture.
The original cloud chat has not independently exercised this backend.

## Deployment

Reviewed package and installer: deploy/browser-dom/. Build with
node deploy/browser-dom/build-release.mjs /absolute/new/release-directory.
Install only a reviewed package on the operator Mac. --inspect is read-only.
--install requires no active delegated session and exact baseline bridge hash;
it adds owned files and reloads only the existing Mac Bridge. No controller,
AX service, browser, Docker, profile migration or security-policy changes.
Unknown files/code or a preexisting Native Messaging registration stop installation.
The guarded --rollback restores the exact baseline and removes only owned files.

The operator must authorize the extension access, then load the unpacked
extension only in Toyota Work11. Developer Mode for extensions is distinct from
Remote Debugging; do not activate debugger features. Corporate restrictions
must not be changed. Inspect the browser's real account and self recipient.
Use an empty own-chat composer only; fill a disposable marker, independently
read, reload/read persistence, clear only the matching marker, verify empty
and close the own grant. Preserve the three accepted drafts and all messages.

## Agent routing

Observed provider extension_dom is a DOM provider, distinct from native AX or
persistent/CDP. The policy selector requires connected and profile-pinned
capabilities, actual semantic reference, explicit existing Edge request and
verified focus-preserving behavior for background work. The preflight accepts
the observed opaque DOM reference/revision without fabricating native indices.
It still requires fresh unique title/URL, exact control, own grant, allowlist
and persistence proof plan for business writes. Disconnection must block
rather than silently selecting a different account or native input.

Checks: npm run test:browser:dom, test:browser:policy,
test:browser:reinforcement, test:mac and verify:v2. Production dependency
findings predate this change; a source/fixture pass is not production GO.
