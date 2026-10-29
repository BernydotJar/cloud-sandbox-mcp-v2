# Background browser interaction on the current Mac

The Toyota self-chat test now has live Sandbox V3 evidence, rather than a
foreground screenshot or a source-only claim. Existing browser tools can select
an explicit `background_ax` reference. DOM/ARIA remains unavailable on that
native reference; real AX roles, names, opaque nodes and value fingerprints are
available instead.

## Agent path

1. Honor the current user scope. The three accepted pilot drafts are out of
   scope; no edits, restores, sends or Jira writes.
2. `browser_tabs(edge, title=...)` is read-only and can return
   `tabs[].background_ax.tab_ref`. Use this explicit optional reference for
   background work. Do not call native focus, screenshot or coordinate actions.
3. `browser_inspect(browser, tab_ref)` returns `inspection_mode=native_ax`,
   `ax_semantic_available=true`, `semantic_available=false`, a numeric revision,
   nodes and `frontmost_unchanged`. A missing background reference is not
   permission to use the foreground driver.
4. Create your OWN existing `computer_use_session_begin` grant, scoped to Edge.
   Do not read or reuse another agent's token. The existing host origin policy,
   duration, audit and session controls still apply.
5. Inspect immediately before an action. Use `browser_action` with the exact
   observed role/label, current revision, your grant and a unique request ID.
   AX `click` uses AXPress. AX `fill` uses direct AXSetValue on normal inputs.
   A certified `AXTextArea` advertises `fill_backend=process_unicode`: its
   independent helper verifies exact PID, window, control and content digest,
   settles AX focus inside the inactive app, and posts Unicode only to Edge's
   PID. It never posts to a session/HID tap, moves a pointer or activates Edge.
6. This text backend supports an empty composer and a fingerprint-bound clear.
   Replacing a nonempty body is rejected. A clear requires readback of the full
   AX selection before ONE process-targeted Backspace. Do not infer empty from
   an arbitrary nonempty value: the observed empty Teams placeholder is the
   exact `Type a message` plus newline fingerprint, separately verified in the
   pilot evidence.
7. Independently inspect the effect. Dispatch success is insufficient. Changes
   such as Chat -> Calendar change title identity; rediscover the background
   reference and verify the selected AX checkbox/title. A browser tab can itself
   be selected with the observed AX radio/tab control inside a background window.
8. Close your own grant. On uncertainty, inspect and never replay a mutation.
   Repeated request IDs remain blocked across newly discovered references in
   the same grant. Refs expire; reacquire read state before acting.

The engine router supports `same_mac_background_ax` only for explicit existing-
Mac, focus-preserving tasks with observed live verification and fresh AX refs.
The agent preflight still requires exact sanitized target, own authorization,
origin policy and verified AX control. A DOM requirement remains blocked.
This provider is not an independent desktop and cannot guarantee compatibility
with every app or control. If the target app becomes foreground, the native
background helper refuses dispatch rather than sending input to the operator.

## Evidence and installation

Live smoke through Sandbox V3: self-chat selection and title readback; Search
empty -> z fingerprint -> empty; Chat -> Calendar selected -> Chat selected;
44-character composer marker fingerprint -> empty-placeholder fingerprint.
Foreground unchanged at each operation, zero global event posts, zero pointer
events, zero sends, zero changes to the three accepted drafts, grant revoked.
The initial direct AX composer assignments had no effect. A process-specific
Unicode probe established the working backend. A burst of Backspaces removed
only a prefix; cleanup was independently verified after replacing that approach
with full AX selection verification and one targeted Backspace.

The localhost AX service and stable native helpers are installed under
`~/Library/Application Support/LCH/SameMacBackgroundAX`. It still listens ONLY
on 127.0.0.1:9779. Authenticated bridge proxy routes reuse the existing protected
9764 listener; no new public listener or credential export was introduced.
The customized controller retains its original 29 tools and adds four optional
background tools (33 total), while the existing browser tools work immediately
for clients with the older catalog. No browser restart, profile change or CDP
provisioning is needed. Installed customized bridge code is patched additively
with `deploy/background-ax/patch-bridge.mjs`; the canonical bounded-session
baseline and its exact regression remain unchanged.

The existing helper deployment was backed up privately. The source installer
now packages BackgroundProcessText, keeps that capability disabled by default,
and supports explicit `--certify-process-text com.microsoft.edgemac` after a
real app compatibility test. Source, installed hashes, live smoke and fixture
acceptance are separate evidence. The live pilot result is in the shared
Toyota evidence directory as `background-interaction-result.json`.
