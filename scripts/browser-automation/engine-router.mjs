/**
 * Capability-driven selection policy for Cloud Sandbox browser and native Mac work.
 * This is a pure decision engine: it never opens browsers, elevates permissions,
 * obtains sessions, copies profiles, or dispatches an OS/UI event.
 *
 * Availability must come from current runtime probes, not static configuration.
 * A caller must still enforce the returned authorization and evidence contract.
 */
import {pathToFileURL} from 'node:url';
import console from 'node:console';
import process from 'node:process';

export const ROUTING_POLICY_VERSION = '1.0.0';
const webIntents = new Set(['qa', 'navigate', 'mutate']);
const browsers = new Set(['chromium', 'chrome', 'edge']);
const evidenceWeb = Object.freeze(['observed_ui', 'business_assertions', 'screenshot_or_trace']);
const evidenceWrite = Object.freeze(['before_state', 'confirmed_write', 'persisted_readback', 'audit_receipt']);
const evidenceNative = Object.freeze(['fresh_target_identity', 'post_action_inspection', 'audit_receipt']);

function outcome(status, engine, code, reason, extras={}) {
  return {policy_version:ROUTING_POLICY_VERSION,status,engine,code,reason,
    requires_authorization:false,prerequisites:[],evidence:[],...extras};
}
function unavailable(code, reason, extras={}) {
  return outcome('blocked',null,code,reason,extras);
}
function chosen(engine, code, reason, extras={}) {
  return outcome('selected',engine,code,reason,extras);
}
const bool = x => x === true;

/**
 * task = {
 *   kind: web | mac_desktop | shell_api,
 *   intent: qa | navigate | mutate,
 *   context: isolated | existing_mac,
 *   browser: chromium | chrome | edge,
 *   requires_authenticated_access: boolean,
 *   explicitly_requested_mac_session: boolean,
 *   requires_semantic: boolean,
 *   native_fallback_approved: boolean,
 *   result_independently_verifiable: boolean
 * }
 * capabilities = {
 *   project_playwright_suite, project_suite_supports_browser,
 *   isolated_playwright, isolated_chrome, isolated_edge,
 *   isolated_profile_authenticated, browser_provider,
 *   browser_semantic_available, browser_tab_ref_present,
 *   native_browser_available, native_mac_available, shell_api_available
 * }
 */
export function chooseExecutionEngine({task={},capabilities={}}={}) {
  if (!task || typeof task !== 'object' || Array.isArray(task) ||
      !capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))
    return unavailable('INVALID_ROUTING_REQUEST','A task and capabilities object are required.');

  const kind=task.kind ?? 'web';
  if (kind === 'shell_api') {
    return bool(capabilities.shell_api_available)
      ? chosen('shell_api','DETERMINISTIC_EXECUTION','Use a scoped deterministic CLI or API action.',
          {evidence:['command_exit_code','observed_business_result']})
      : unavailable('SHELL_API_UNAVAILABLE','The requested deterministic tool is not available.');
  }

  if (kind === 'mac_desktop') {
    if (!bool(capabilities.native_mac_available))
      return unavailable('BLOCKED_NATIVE_DESKTOP','The general native Mac application driver is not exposed to this agent.');
    return chosen('native_mac','NATIVE_DESKTOP','Use macOS Accessibility against a fresh, allowlisted application/window.',
      {requires_authorization:true,prerequisites:['task_scoped_mac_consent','fresh_window_and_ax_identity'],
       evidence:evidenceNative});
  }

  if (kind !== 'web') return unavailable('INVALID_ROUTING_REQUEST','Unsupported task kind.');
  const intent=task.intent ?? 'navigate';
  const context=task.context ?? 'isolated';
  const browser=task.browser ?? 'chromium';
  if (!webIntents.has(intent) || !browsers.has(browser) || !['isolated','existing_mac'].includes(context))
    return unavailable('INVALID_ROUTING_REQUEST','Unsupported web intent, browser, or execution context.');

  if (context === 'existing_mac') {
    if (!bool(task.explicitly_requested_mac_session))
      return unavailable('MAC_BROWSER_CONSENT_REQUIRED','A personal/authenticated Mac browser session must be explicitly requested.');
    if (browser === 'chromium')
      return unavailable('INVALID_ROUTING_REQUEST','Identify Chrome or Edge for existing-Mac browser reuse.');

    if (capabilities.browser_provider === 'persistent' &&
        bool(capabilities.browser_semantic_available) &&
        bool(capabilities.browser_tab_ref_present)) {
      return chosen('browser_mcp_semantic','AUTHENTICATED_SEMANTIC_BROWSER',
        'Use the exact authenticated tab through Browser MCP. Playwright/CDP is a provider detail, not a global dependency.',
        {browser,context,requires_authorization:true,
         allowed_operations:['inspect','screenshot',...((intent==='qa')?[]:['semantic_action'])],
         prerequisites:['fresh_tab_ref_and_revision','task_scoped_browser_grant_for_mutations'],
         evidence:intent==='mutate'?evidenceWrite:evidenceWeb,
         transport:'provider_managed',semantic_evidence:true});
    }

    // Read-only inspection is not a mutation. A CDP failure must not hide
    // accessible Edge/Chrome screenshots from the agent. Native observations
    // can support diagnosis, but cannot pass a semantic browser acceptance gate.
    if (capabilities.browser_provider === 'native' && bool(capabilities.native_browser_available)) {
      if (intent==='qa') {
        return chosen('browser_mcp_native','NATIVE_INSPECTION_ONLY',
          'Read the authenticated native browser state/screenshot; do not claim semantic E2E acceptance.',
          {browser,context,allowed_operations:['state','screenshot'],
           acceptance_eligible:false,semantic_evidence:false,
           evidence:['fresh_native_tab_target','observed_screenshot','unmet_semantic_gates']});
      }
      if (intent==='navigate' && bool(task.native_fallback_approved)) {
        return chosen('browser_mcp_native','AUTHENTICATED_VISUAL_NAVIGATION',
          'Use scoped native browser navigation, inspect each change, and preserve the original authenticated profile.',
          {browser,context,requires_authorization:true,semantic_evidence:false,
           allowed_operations:['state','screenshot','native_action'],
           prerequisites:['fresh_native_tab_target','task_scoped_browser_grant','foreground_acceptable'],
           evidence:['fresh_target_identity','post_action_inspection','audit_receipt']});
      }
      if (intent==='mutate' && bool(task.native_fallback_approved) &&
          task.requires_semantic===false && bool(task.result_independently_verifiable)) {
        return chosen('browser_mcp_native','LIMITED_AUTHENTICATED_NATIVE',
          'Use a scoped native action only where the business result can be independently verified.',
          {browser,context,requires_authorization:true,
           allowed_operations:['state','screenshot','native_action'],
           prerequisites:['fresh_native_tab_target','task_scoped_browser_grant','foreground_acceptable'],
           evidence:evidenceWrite,semantic_evidence:false});
      }
    }

    return unavailable('BLOCKED_SEMANTIC_BROWSER',
      'The requested authenticated browser operation lacks an authorized capable provider. CDP failure never blocks independent Playwright.',
      {prerequisites:['verify_browser_runtime_and_tab_capability'],
       evidence:['blocker_with_provider_and_capabilities']});
  }

  // DEFAULT for ALL ordinary web UI: isolated Playwright, never personal Mac tabs.
  const exactBrowser=browser==='chrome'?'isolated_chrome':browser==='edge'?'isolated_edge':null;
  if (exactBrowser && !bool(capabilities[exactBrowser])) {
    return unavailable('BLOCKED_EXACT_BROWSER',
      'The requested isolated browser channel is unavailable; do not silently substitute Chromium.');
  }
  if (bool(task.requires_authenticated_access) && !bool(capabilities.isolated_profile_authenticated)) {
    return unavailable('AUTH_REQUIRED',
      'Authenticate the isolated profile via approved handoff. Never copy Mac browser cookies, passwords, or tokens.',
      {prerequisites:['isolated_login_handoff','recheck_authentication']});
  }
  if (intent==='qa' && bool(capabilities.project_playwright_suite) &&
      (browser==='chromium' || bool(capabilities.project_suite_supports_browser))) {
    return chosen('playwright_project','PLAYWRIGHT_PROJECT_FIRST',
      'Run the existing project Playwright suite with isolated test identities.',
      {evidence:evidenceWeb, browser});
  }
  if (bool(capabilities.isolated_playwright)) {
    return chosen('playwright_isolated','PLAYWRIGHT_DEFAULT',
      'Use isolated headless Playwright; no Mac Chrome/Edge session or CDP attachment is required.',
      {requires_authorization:intent==='mutate',
       prerequisites:intent==='mutate'?['explicit_user_authorization','approved_environment']:[],
       evidence:intent==='mutate'?evidenceWrite:evidenceWeb, browser});
  }
  return unavailable('BLOCKED_PLAYWRIGHT_UNAVAILABLE',
    'The isolated Playwright runtime is unavailable; never automatically access personal browser sessions.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2]==='--help') {
    console.log('Usage: node engine-router.mjs \'{"task":{"kind":"web","intent":"qa"},"capabilities":{"isolated_playwright":true}}\'');
  } else {
    try {
      const request=JSON.parse(process.argv[2] || '{}');
      const result=chooseExecutionEngine(request);
      console.log(JSON.stringify(result,null,2));
      if (result.status==='blocked') process.exitCode=3;
    } catch {
      console.error('INVALID_ROUTING_REQUEST');
      process.exitCode=2;
    }
  }
}
