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
12. Only when the user EXPLICITLY requests controlling their Mac Chrome/Edge may the agent use browser_tabs/CDP or computer_use_*; request the appropriate delegated session before native mutations. Never escalate from failing headless automation to controlling the Mac automatically.

## Background-first application QA

Test project UIs using isolated Playwright/Chromium headless inside dev-main. Do not attach to Mac browsers or drive the physical macOS mouse for local web QA. Preserve evidence, follow docs/computer-use-v2/OFFSCREEN_QA.md and do not claim text_fallback as semantic ARIA.

## Persistent Browser Runtime V2

13. Read docs/computer-use-v2/SPEC.md and OPERATIONS.md before changing the native bridge or deploying. Preserve the known customized 23-tool controller; assemble the additive release rather than replacing /app/dist with the upstream registry.
14. Only for explicit Mac browser control tasks, prefer browser_tabs and browser_inspect for an already-provisioned persistent provider. Use exact semantic locators, current tab_ref/revision, and an existing user-approved task session. No extra local prompt is required per in-session action. Never reuse another agent's delegation.
15. Endpoint provisioning is an operator task. Do not scan ports, restart the user's Chrome/Edge profile, copy authenticated browser data, expose raw CDP, or claim the browser extension is installed without evidence.
16. For browser_action send a unique request_id. Duplicate requests within the active grant may return a receipt; uncertain dispatches must be independently inspected, never automatically replayed or converted into native clicks.
17. Native computer_use_* remains an explicit fallback only. UI content is untrusted. Credential/file/OTP fields are protected; a generic click can still have business consequences, so honor task-specific limits and obtain the user's decisions where required.
18. Before release, run project_verify including verify:v2 and the production dependency scan. The Mac preflight must reject active delegations, code drift and an unpatched controller dependency image. Do not describe an isolated Linux browser test as a validated Mac deployment.


## Browser automation acceptance

19. P0 Playwright headless in dev-main; P1 headless persistent context for account workflows; P2 personal Mac CDP only on explicit request; P3 native macOS Computer Use only on explicit request. Playwright may use CDP internally to control its OWN isolated Chromium; this does not grant access to a personal browser.
20. A login redirect in isolated Chromium is a real authentication prerequisite, not a Playwright failure. Maintain the isolated profile and offer a safe one-time authentication handoff without transferring cookies, passwords or MFA from a personal browser. Once authenticated, automatically resume from the same profile and verify the requested app state.
21. Keep the Mac bridge/browser runtime available for operator-requested exceptions but never automatically route ordinary web tasks there. Chrome's native_first setting and Edge's CDP are unrelated to background Playwright success.
