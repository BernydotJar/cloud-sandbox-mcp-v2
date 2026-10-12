# Offscreen UI QA routing: Chessy and Computer Use V2

Date: 2026-10-12. Scope: one trusted Cloud Sandbox owner. This is not a Mac deployment attestation.

## Routing decision

**Default to isolated headless Playwright for application QA.** Do not use the user's daily macOS cursor, Chrome, Edge or logged-in browser profile just to test a locally built application.

| Task | Execution lane | User impact | Gate |
| --- | --- | --- | --- |
| UI regression, drag/drop, mobile/touch, visual evidence, a11y | workspace_exec -> project Playwright -> Chromium headless -> fresh context | No Mac app focus or physical mouse input | Test authorization; no real account writes |
| Inspect a logged-in web tab | browser_runtime_status -> browser_tabs -> persistent browser_inspect / browser_screenshot | Does not intentionally foreground the page | Requested relevant tab; content untrusted/private |
| Mutate a logged-in web tab | browser_action with exact locator, revision, unique request ID and active session | CDP does not request focus, but business side effects are real | Scoped one-time Mac approval PLUS business authorization |
| Tab without attachable CDP | Native computer_use_state/screenshot/action | May change Mac focus and physical UI | Fresh target identity and local consent |

Never downgrade a failed semantic mutation to native coordinates or retry an uncertain action without verification. Keep each task's delegated grant private.

## Chessy evidence

- Checkout: /workspace/projects/chessy. It had an active dirty working tree owned by another workflow. Do not change its files or replace concurrent test evidence.
- Entry point: scripts/browser-verify.cjs via npm run test:e2e.
- The script chooses headless Chromium when CHESSY_HEADLESS=1 or GitHub Actions is active. Otherwise it tries an existing CDP endpoint and falls back to headless. Explicitly set CHESSY_HEADLESS=1 for non-intrusive QA.
- It tests true piece drags through Playwright page.mouse move/down/up, CDP touch gestures on mobile, browser contexts, application-state assertions, screenshots, and accessibility checks. Its full run writes files under progress/evidence/browser and MUST NOT run concurrently on the same dirty checkout.
- Independent one-off smoke performed inside dev-main: launched Chromium 145.0.7632.0 headless, routed static assets from existing Chessy dist/, started a game, dragged e2 -> e4 and verified e4 in the move history. PASS. Screenshot stored privately at /tmp/chessy-headless-proof-20261012.png inside the workstation. No host Mac browser or native input was touched. This is not an assertion about unbuilt current source or the complete suite.

On an independent checkout with uncontended evidence:

    CHESSY_HEADLESS=1 npm run test:e2e

CHESSY_E2E_FILTER can select a particular named scenario; check script names first. It still writes evidence files.

## Actual Mac host audit on 2026-10-12

- Native computer_use_status: enabled and connected; zero active delegated sessions.
- Chrome browser_tabs: provider=persistent, tab_ref and revision present, LUMA login tab discovered. browser_screenshot returned a PNG without moving the Mac cursor.
- **Open gate:** browser_inspect on that same Chrome tab returned NATIVE_UNAVAILABLE; an advertised semantic provider is not automatically proof of live accessibility inspection.
- Edge browser_tabs: provider=native, semantic_available=false, fallback_reason=PERSISTENT_BROWSER_UNAVAILABLE. Discovery works but true Edge CDP is not ready.
- Isolated repository gates passed before and after the source patch. This does not validate deployment of the patch on Mac.

## Source-only inspection mitigation (not deployed)

The new inspection contract tries ARIA first, returning inspection_mode=aria, semantic_available=true and a scrubbed aria field. If that fails, it may return read-only body text with inspection_mode=text_fallback, semantic_available=false and page_text. It never invents an accessibility tree or invokes the native cursor. If both reads fail it returns BROWSER_INSPECT_UNAVAILABLE. Navigation revision is rechecked after reading. Page contents remain sensitive and scrubbing is best effort.

A versioned host release and actual Mac verification are still needed. Do not hotpatch the running bridge during QA.

## Gates required before claiming full readiness

1. Offscreen suite exercises keyboard, drag/drop, touch, desktop/mobile viewport, accessibility and evidence without Mac focus.
2. Mac Chrome persistent path can discover, inspect (ARIA or clearly labeled non-semantic fallback), screenshot and reject stale page revisions.
3. Mac Edge gains approved true CDP attach and semantic read, or is explicitly documented as native-only; never restart, copy or replace daily browser profiles to force debugging.
4. A designated fixture tab completes a harmless explicitly authorized semantic action, result verification, revocation and replay check. Do not use real administrative or financial forms.
5. Pinned customized MCP tool registry, current dependency image, release hashes, maintenance preflight and rollback drill pass.
6. Operational metrics cover per-browser provider, attach/reconnect, inspection mode, safe errors, session uncertainty and latency. Never log credentials, raw page text, URLs, or screenshots.

## Codex-inspired public patterns

- OpenAI describes background Codex desktop use with each agent's own cursor and parallel sessions: https://openai.com/index/codex-for-almost-everything/
- OpenAI's public computer use documentation recommends an agent executing code through an isolated browser/desktop with Playwright, or a structured action tool: https://developers.openai.com/api/docs/guides/tools-computer-use
- Playwright browser-context isolation: https://playwright.dev/docs/browser-contexts

We can adopt these documented ideas without private reverse engineering. The macOS native bridge cannot promise independent cursors by itself. If fully background native desktop UI becomes a separate requirement, assess per-agent virtual displays/sessions; headless Playwright already solves the current web-QA requirement.
