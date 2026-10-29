# Teams DOM backend — 29 October 2026

Current handoff: TEAMS_BACKEND_TECHNICAL_HANDOFF_20261029.txt.
Acceptance is PARTIAL: the recorded background workflow passed, but later
idle inspections returned DOM_TIMEOUT_INSPECT despite a connected broker.
A sleeping/frozen tab is suspected; a fresh lifecycle flag was not collected.
The exploratory wake worker was not installed and was removed from the
release tree into explicit WIP artifacts. The user prefers avoiding an extension.


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

Real Toyota uses CKEditor 5. Generic execCommand fired a trusted input event
but CKEditor discarded the DOM change. The final typed editor-main.js companion
runs as a static MAIN-world content script on the same sole Teams origin.
It uses the documented editable.ckeditorInstance.setData API, with escaped plain
text and no focus call. The isolated script checks the exact live node, URL,
title and value fingerprint; the companion repeats these checks and verifies
the matching editor root/read-only state before writing. Its page-only channel
exposes no Chrome API, host grant, Native Messaging, arbitrary code or selectors.
The website already controls its own editor; host authorization remains solely
in the private broker/bridge route. MAIN-world replies do not prove persistence:
independent DOM and reload readback are mandatory.

References: https://ckeditor.com/docs/ckeditor5/latest/framework/how-tos.html
and https://ckeditor.com/docs/ckeditor5/latest/getting-started/setup/getting-and-setting-data.html.

The host still checks own grant, current origin policy and shared busy state.
Disconnection, expiry, changed URL/control or uncertain dispatch cannot trigger
automatic native input or mutation replay. Teams DOM errors remain visible on disconnection; native Teams alternatives
from other profiles are excluded, while other origins keep native discovery. Existing native references retain their native
route; the controller tool inventory and all existing origin rules are preserved.

## Actual evidence and boundaries

Isolated Linux Chromium passed real extension loading, Native Messaging,
profile pin, private Unix connection, HTTP bridge and existing MCP tool calls.
It filled a rich editor with a trusted browser input event, read its digest,
reloaded and confirmed persistence, cleared and independently verified empty.
A separate operator tab stayed active and unchanged. No sends and zero calls
to the native transport. Replaced node, changed full URL, duplicate locator,
wrong profile/origin/grant, code drift and replay tests reject.

The approved extension and backend are installed on the operator Mac, in
Toyota Work11 only. Actual Sandbox V3 browser tools observed Toyota identity,
self recipient and empty composer. The CKEditor model adapter filled the
33-character marker (SHA256 b9c8737d81fbeafdf340cfd50273772d49cf841a214e779449a21be595c10167),
read it back, reloaded and confirmed the same digest, cleared it, then reloaded
and independently confirmed empty. Teams remained inactive with the Extensions
tab active in Edge. No sends, Jira writes or changes to other drafts. The own
grant was revoked. The final 0.1.1 run additionally passed while Docker (com.docker.docker) stayed
foreground before, during and after fill/reload/clear plus Calendar/Chat
navigation; Edge remained behind and Teams inactive. The final own grant was
revoked. No UI or native fallback performed the tested DOM mutations.
The generic browser fixture is additionally joined by a genuine CKEditor 49.0.1
npm-distribution E2E (GPL fixture, bundle hash pinned), including escaped text,
model edit, reload persistence and empty cleanup without tab activation.
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

Checks: npm run test:browser:dom:ckeditor, test:browser:policy,
test:browser:reinforcement, test:mac and verify:v2. Production dependency
findings predate this change; a source/fixture pass is not production GO.

Final discovery compatibility was verified on Mac: 145 rows (one DOM Teams and
144 native other-origin rows); DTI-14949 remained native. Mixed discovery labels
per-tab providers and does not claim global DOM semantics. The later attempted
full workflow on this final bridge stopped at inspect timeouts, before any new
write. Preserve the successful older run separately from current reliability.
