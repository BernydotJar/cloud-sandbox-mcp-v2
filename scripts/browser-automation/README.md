# Background-first browser automation

Use the existing Cloud Sandbox MCP V2 `workspace_exec` tool. For general web tasks, run `node scripts/browser-automation/run.mjs <site-id> <https-url>` in the existing `/workspace/projects/cloud-sandbox-mcp-v2` checkout. This reuses the site's isolated headless Linux Chromium profile under `/workspace/.browser-automation/profiles/<site-id>` and places screenshots, Playwright traces, and JSON reports under `/workspace/.browser-automation/evidence/<site-id>`. It never connects to a Mac browser.

`page_loaded_not_auth_verified` means navigation worked but authentication and business workflows remain unverified. `auth_required` means authentication is needed. Never treat it as success or import credentials/cookies from a Mac profile. A user must authenticate to the isolated browser through an approved one-time interactive handoff before an unattended authenticated workflow can run; that handoff is not currently implemented in the MCP tool registry. Do not bypass login, CAPTCHA, or MFA.

This CLI is a reusable **diagnostic runner**, not a generic autonomous UI agent or a hosted browser service. Agents can develop purpose-built, bounded Playwright workflows using its profile and evidence conventions. Do not run concurrent processes for the same profile. Site-specific profile keys must not be shared between accounts. For routine QA without persisted authentication, use `npm run test:qa:offscreen`.

Personal Chrome/Edge CDP and Computer Use native remain available **only on explicit user request**. Internal Playwright control of its own headless Chromium is permitted.

## Playwright-first selection policy (all web tasks)

Every agent must prefer an existing project's Playwright suite, then an
isolated Playwright Chromium workflow. This applies to web navigation/forms
as well as QA, and is independent of the macOS Chrome/Edge CDP health.

The pure router is `engine-router.mjs`; it requires **observed** runtime
capabilities and never executes UI actions:

```bash
node scripts/browser-automation/engine-router.mjs \
  '{"task":{"kind":"web","intent":"navigate"},"capabilities":{"isolated_playwright":true}}'
npm run test:engine-routing
```

For ordinary navigation the selection result is `playwright_isolated`.
For QA, `project_playwright_suite=true` selects `playwright_project`
when it is actually available. After routing, use a project-specific
Playwright workflow with semantic assertions and trace/screenshot evidence,
or use the simple `run.mjs` diagnostic above for an isolated URL smoke.

Only when the user expressly requests an existing authenticated Chrome/Edge
Mac session should the agent set `context=existing_mac` and select Browser
MCP based on actual tab/provider capability. The persistent browser adapter
may internally use Playwright-over-CDP, but CDP is not required for any
isolated Playwright task. Never copy cookies, tokens or a browser profile
to make an isolated browser appear authenticated.

The router returns `BLOCKED_SEMANTIC_BROWSER` for unsupported authenticated
semantic actions, `AUTH_REQUIRED` for isolated login prerequisites and
`BLOCKED_EXACT_BROWSER` if an explicitly requested browser channel is not
available. Native foreground fallback needs separate authorization and
independent business-result verification; it is never an automatic retry.

See `docs/computer-use-v2/ENGINE_ROUTING.md` and shared
`/workspace/AGENTS.md`. Router unit tests are included in `npm run verify`.
The selector is policy logic, not an installed autonomous MCP routing service:
agents must act on the decision using the existing appropriate tools.
