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

export const ROUTING_POLICY_VERSION = '1.1.0';
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
 *   result_independently_verifiable: boolean,
 *   background_required: boolean,
 *   background_mode: isolated | focus_preserving (isolated by default),
 *   target_host: macos | sandbox,
 *   isolated_desktop_authorized: boolean
 * }
 * capabilities = {
 *   project_playwright_suite, project_suite_supports_browser,
 *   isolated_playwright, isolated_chrome, isolated_edge,
 *   isolated_profile_authenticated, browser_provider,
 *   browser_semantic_available, browser_tab_ref_present,
 *   native_browser_available, native_mac_available, shell_api_available,
 *   isolated_playwright_headless, project_suite_headless,
 *   browser_focus_preserving_verified, native_mac_isolated_session,
 *   native_mac_independent_input, native_mac_ax_available,
 *   mac_host_scoped_command_runner_available
 * }
 */
export function chooseExecutionEngine({task={},capabilities={}}={}) {
  if (!task || typeof task !== 'object' || Array.isArray(task) ||
      !capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))
    return unavailable('INVALID_ROUTING_REQUEST','A task and capabilities object are required.');

  const kind=task.kind ?? 'web';
  const background=task.background_required===true;
  const backgroundMode=task.background_mode??'isolated';
  if(background && !['isolated','focus_preserving'].includes(backgroundMode))
    return unavailable('INVALID_BACKGROUND_MODE',
      'Choose isolated or explicitly requested focus_preserving; never infer another mode.');
  if (kind === 'shell_api') {
    if(background && task.target_host==='macos') {
      if(!bool(capabilities.mac_host_scoped_command_runner_available))
        return unavailable('BACKGROUND_MAC_COMMAND_RUNNER_UNAVAILABLE',
          'Mac Terminal CUA is interactive. Run a scoped, authorized host command runner with no GUI instead.');
      return chosen('mac_host_scoped_api','BACKGROUND_MAC_SCOPED_COMMAND',
        'Execute an explicitly scoped macOS command without opening or focusing Terminal.',
        {requires_authorization:true,prerequisites:['authorized_mac_host_command','no_interactive_terminal'],
         background_mode:'isolated',focus_impact:'none',evidence:['command_exit_code','redacted_output']});
    }
    return bool(capabilities.shell_api_available)
      ? chosen('shell_api','DETERMINISTIC_EXECUTION','Use a scoped deterministic CLI or API action.',
          {evidence:['command_exit_code','observed_business_result'],
           ...(background?{background_mode:'isolated',focus_impact:'none',
             fully_isolated:true}: {})})
      : unavailable('SHELL_API_UNAVAILABLE','The requested deterministic tool is not available.');
  }

  if (kind === 'mac_desktop') {
    if(background){
      if(backgroundMode!=='isolated' ||
         !bool(capabilities.native_mac_isolated_session) ||
         !bool(capabilities.native_mac_independent_input) ||
         !bool(capabilities.native_mac_ax_available) ||
         !bool(task.isolated_desktop_authorized))
        return unavailable('BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED',
          'Native macOS AX and global keyboard actions on the active desktop can steal focus. Require a separately authorized isolated macOS GUI session with independent input.',
          {prerequisites:['separate_macos_gui_session','independent_input','native_ax','explicit_isolated_desktop_authorization']});
      return chosen('native_mac_isolated','BACKGROUND_NATIVE_DESKTOP',
        'Use only the independently isolated and authorized Mac GUI session.',
        {requires_authorization:true,background_mode:'isolated',focus_impact:'isolated_mac_gui',
         prerequisites:['verified_isolated_gui_identity','task_scoped_mac_consent','fresh_window_and_ax_identity'],
         evidence:[...evidenceNative,'no_user_desktop_focus_change']});
    }
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
    if(background && backgroundMode==='isolated')
      return unavailable('BACKGROUND_PERSONAL_BROWSER_NOT_ISOLATED',
        'An attached personal Mac tab is not an isolated background session. Use headless Playwright with a separately authorized isolated profile.');
    // A profile-paired DOM extension is distinct from native AX and CDP.
    // It never falls back to shared-desktop input when disconnected.
    if(capabilities.browser_provider==='extension_dom') {
      if(task.explicitly_requested_mac_session!==true || browser!=='edge')
        return unavailable('MAC_BROWSER_CONSENT_REQUIRED','The paired existing Edge session must be explicitly requested.');
      if(!bool(capabilities.browser_semantic_available) || !bool(capabilities.browser_tab_ref_present) ||
         !bool(capabilities.extension_dom_connected) || !bool(capabilities.extension_profile_pinned) ||
         (background && !bool(capabilities.browser_focus_preserving_verified)))
        return unavailable('EXTENSION_DOM_NOT_VERIFIED','Require the connected approved profile and fresh DOM reference; never substitute native input.');
      return chosen('browser_mcp_extension_dom','PAIRED_PROFILE_DOM_BROWSER',
        'Use exact per-tab DOM actions in the paired Edge profile through existing Browser MCP tools.',
        {browser,context,requires_authorization:true,semantic_evidence:true,
         allowed_operations:['inspect','semantic_action'],
         prerequisites:['fresh_dom_ref_and_revision','own_browser_grant','allowlisted_origin','verified_dom_control'],
         evidence:intent==='mutate'?evidenceWrite:evidenceWeb,
         transport:'native_messaging_private_unix',
         ...(background?{background_mode:'focus_preserving',focus_impact:'os_focus_not_required',fully_isolated:false}: {})});
    }
    if(background && backgroundMode==='focus_preserving' && task.background_ax_approved===true &&
       task.explicitly_requested_mac_session===true && ['chrome','edge'].includes(browser) &&
       capabilities.same_mac_background_ax_available===true &&
       capabilities.same_mac_background_ax_live_verified===true &&
       capabilities.same_mac_background_ax_tab_ref_present===true) {
      if(task.requires_dom===true)return unavailable('BACKGROUND_DOM_PROVIDER_REQUIRED','Native AX is not DOM/ARIA.');
      return chosen('same_mac_background_ax','VERIFIED_SAME_MAC_BACKGROUND_AX',
        'Use the explicitly selected, live-verified native AX background reference and certified per-process text backend.',
        {browser,context,requires_authorization:true,background_mode:'focus_preserving',
         focus_impact:'os_focus_not_required',fully_isolated:false,semantic_evidence:false,ax_semantic_evidence:true,
         prerequisites:['fresh_background_ax_ref_and_revision','own_browser_grant','allowlisted_origin','verified_control_and_value_fingerprint'],
         evidence:['before_state','independent_readback','unchanged_foreground','audit_receipt']});
    }
    if(background && (capabilities.browser_provider!=='persistent' ||
        !bool(capabilities.browser_semantic_available) ||
        !bool(capabilities.browser_tab_ref_present) ||
        !bool(capabilities.browser_focus_preserving_verified)))
      return unavailable('BACKGROUND_SEMANTIC_BROWSER_REQUIRED',
        'Do not fall back to native screenshot/keyboard/AX on the active Mac desktop. Confirm a focus-preserving persistent semantic provider or use an isolated headless browser.');
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
         transport:'provider_managed',semantic_evidence:true,
         ...(background ? {background_mode:'focus_preserving',
           focus_impact:'os_focus_not_required',fully_isolated:false,
           caveat:'Existing browser tab content can still change; user must not share this tab concurrently.'} : {})});
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
  // A project suite that opens a headed window is not background automation.
  // Prefer its truly headless execution, otherwise use isolated headless runner.
  if(background && !bool(capabilities.isolated_playwright_headless) &&
     !(intent==='qa' && bool(capabilities.project_playwright_suite) &&
       bool(capabilities.project_suite_headless)))
    return unavailable('BACKGROUND_HEADLESS_PLAYWRIGHT_REQUIRED',
      'A background-only web task must have a verified headless project suite or isolated Playwright runtime.');
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
      (!background || bool(capabilities.project_suite_headless)) &&
      (browser==='chromium' || bool(capabilities.project_suite_supports_browser))) {
    return chosen('playwright_project','PLAYWRIGHT_PROJECT_FIRST',
      'Run the existing project Playwright suite with isolated test identities.',
      {evidence:evidenceWeb, browser,
       ...(background?{background_mode:'isolated',focus_impact:'none',
         fully_isolated:true}: {})});
  }
  if (bool(capabilities.isolated_playwright) &&
      (!background||bool(capabilities.isolated_playwright_headless))) {
    return chosen('playwright_isolated','PLAYWRIGHT_DEFAULT',
      'Use isolated headless Playwright; no Mac Chrome/Edge session or CDP attachment is required.',
      {requires_authorization:intent==='mutate',
       prerequisites:intent==='mutate'?['explicit_user_authorization','approved_environment']:[],
       evidence:intent==='mutate'?evidenceWrite:evidenceWeb, browser,
       ...(background?{background_mode:'isolated',focus_impact:'none',
         fully_isolated:true}: {})});
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
