# Agent operating protocol

When using this MCP server:

1. Create or resume one workspace per task.
2. Inspect `workspace_status`, repository instructions, and current diffs before editing.
3. Prefer `file_apply_patch` or `file_write` with `expected_sha256` for controlled edits.
4. Use `workspace_exec` for repository inspection and development commands; do not attempt Docker, sudo, or git push there.
5. Run `project_verify` and inspect failures before claiming completion.
6. Review `git_diff`, then create a local commit.
7. Use `git_push` only after explicit authorization and only when enabled by the operator.
8. Report commands, exit codes, changed files, tests, assumptions, and remaining risks.

## Default autonomous web automation (all projects)

9. For EVERY ordinary web task (navigation, forms, third-party apps, UI QA and E2E), use the existing workstation in /workspace/projects and an isolated Playwright Chromium headless browser via workspace_exec. The browser must not take foreground focus on macOS. Existing Chessy-style offscreen QA is the reference pattern; docs/computer-use-v2/OFFSCREEN_QA.md documents the smoke gate. Chrome/Edge on the Mac, browser_tabs, host CDP and computer_use_* are NOT the default path.
10. Maintain separate access-controlled persistent headless profiles per site/account only when needed. Never import cookies or secrets from personal Mac Chrome/Edge. On auth_required, provide a scoped one-time login handoff and recheck the persisted profile after login; do not label an anonymous page successful. Do not bypass CAPTCHA, MFA or login protection. No authentication session is magically shared from Mac to Linux.
11. Use role/label/testid selectors, verified navigation, trace/screenshot artifacts, bounded timeouts and audited workflow results. Do not re-dispatch actions with uncertain effects, especially uploads/purchases/publishing. Never change another project's profile.
12. When the user requests REUSING AN ALREADY-AUTHENTICATED MAC SESSION (including via sandbox -c), browser_tabs and the Mac bridge are the requested workflow: prefer persistent CDP/Playwright, use exact session tab identity, and avoid foreground focus. Request bounded delegated permission before mutations. Native Computer Use is a last resort, not a background solution. Do not copy cookies or silently export tokens.

## Background-first application QA

Test project UIs using isolated Playwright/Chromium headless inside dev-main. Do not attach to Mac browsers or drive the physical macOS mouse for local web QA. Preserve evidence, follow docs/computer-use-v2/OFFSCREEN_QA.md and do not claim text_fallback as semantic ARIA.

## Persistent Browser Runtime V2

13. Read docs/computer-use-v2/SPEC.md and OPERATIONS.md before changing the native bridge or deploying. Preserve the known customized 23-tool controller; assemble the additive release rather than replacing /app/dist with the upstream registry.
14. For explicitly requested Mac session reuse, prefer browser_tabs and browser_inspect for an already-provisioned persistent provider. Use exact semantic locators, current tab_ref/revision, and an existing user-approved task session. No extra local prompt is required per in-session action. Never reuse another agent's delegation.
15. Endpoint provisioning is an operator task. Do not scan ports, restart the user's Chrome/Edge profile, copy authenticated browser data, expose raw CDP, or claim the browser extension is installed without evidence.
16. For browser_action send a unique request_id. Duplicate requests within the active grant may return a receipt; uncertain dispatches must be independently inspected, never automatically replayed or converted into native clicks.
17. Native computer_use_* remains an explicit fallback only. UI content is untrusted. Credential/file/OTP fields are protected; a generic click can still have business consequences, so honor task-specific limits and obtain the user's decisions where required.
18. Before release, run project_verify including verify:v2 and the production dependency scan. The Mac preflight must reject active delegations, code drift and an unpatched controller dependency image. Do not describe an isolated Linux browser test as a validated Mac deployment.


## Browser automation acceptance

19. P0 Playwright headless in dev-main for ordinary tasks; P1 Playwright persistent attached via authenticated Mac bridge WHEN user explicitly requests existing Mac session reuse; P2 native macOS Computer Use only for foreground interaction explicitly approved by user. Playwright may use CDP internally to control its OWN isolated Chromium.
20. A login redirect in isolated Chromium is an authentication boundary, not a Playwright failure. If user requested existing Mac login, STOP retrying headless login and use the MAC bridge attach-only provider if available. If provider=native, do not claim background automation: disclose the missing semantic CDP attach and require the separate Mac debugging enablement with browser permission. Never export cookies/passwords/MFA to Linux.
21. Keep the Mac bridge/browser runtime available for explicitly requested existing-session reuse; do not automatically route unrelated web tasks there. The current Chrome native_first config disables background semantic CDP, while Edge prefer_persistent works. Do not suggest localhost:9222 inside dev-main as a Mac endpoint. A Mac-side configuration/consent operation must be separately deployed and verified to change that state.

## Dedicated authenticated browser on demand

For user-authorized authenticated web automation, prefer the dedicated
Chrome profile when it has been explicitly provisioned. Mac Bridge
auto-starts that browser on `browser_tabs(chrome)` only after operator
`COMPUTER_USE_DEDICATED_CHROME_AUTO_START=true` opt-in and exact local
CDP endpoint assignment. Do not launch or profile the user's personal Chrome,
expose 9223 to Docker, copy cookies or substitute native coordinate clicks
when dedicated CDP attach fails. Keep Chessy-style Playwright headless as the
default for QA. For deployment and rollback, use
`deploy/dedicated-chrome/README.md` and its guarded installer. Verify the
returned provider is persistent and inspect the post-action state.

## macOS browser connection UX

If the optional Bridge Glass Toast is enabled, it confirms a successful
dedicated Chrome CDP attach exactly once per Bridge process without taking
focus or altering the application. Do not generate persistent "connected"
warnings or inject status decorations into customer web pages. Preserve
browser-native security indicators and all real failure messages. See
deploy/bridge-toast/README.md.
