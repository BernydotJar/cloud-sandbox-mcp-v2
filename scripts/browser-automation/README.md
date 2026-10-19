# Background-first browser automation

Use the existing Cloud Sandbox MCP V2 `workspace_exec` tool. For general web tasks, run `node scripts/browser-automation/run.mjs <site-id> <https-url>` in the existing `/workspace/projects/cloud-sandbox-mcp-v2` checkout. This reuses the site's isolated headless Linux Chromium profile under `/workspace/.browser-automation/profiles/<site-id>` and places screenshots, Playwright traces, and JSON reports under `/workspace/.browser-automation/evidence/<site-id>`. It never connects to a Mac browser.

`page_loaded_not_auth_verified` means navigation worked but authentication and business workflows remain unverified. `auth_required` means authentication is needed. Never treat it as success or import credentials/cookies from a Mac profile. A user must authenticate to the isolated browser through an approved one-time interactive handoff before an unattended authenticated workflow can run; that handoff is not currently implemented in the MCP tool registry. Do not bypass login, CAPTCHA, or MFA.

This CLI is a reusable **diagnostic runner**, not a generic autonomous UI agent or a hosted browser service. Agents can develop purpose-built, bounded Playwright workflows using its profile and evidence conventions. Do not run concurrent processes for the same profile. Site-specific profile keys must not be shared between accounts. For routine QA without persisted authentication, use `npm run test:qa:offscreen`.

Personal Chrome/Edge CDP and Computer Use native remain available **only on explicit user request**. Internal Playwright control of its own headless Chromium is permitted.
