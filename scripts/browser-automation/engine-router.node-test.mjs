import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseExecutionEngine} from './engine-router.mjs';

const route=(task,capabilities)=>chooseExecutionEngine({task,capabilities});
const qa={kind:'web',intent:'qa'};
const web={kind:'web',intent:'mutate'};
const mac={...web,context:'existing_mac',browser:'edge',explicitly_requested_mac_session:true};

test('Playwright project suite is the web QA default, regardless of CDP failure',()=>{
 const r=route(qa,{project_playwright_suite:true,isolated_playwright:true,
   browser_provider:'native',native_browser_available:true});
 assert.equal(r.engine,'playwright_project');
 assert.equal(r.code,'PLAYWRIGHT_PROJECT_FIRST');
 assert.equal(r.requires_authorization,false);
});
test('generic web navigation and mutation prefer independent Playwright',()=>{
 for(const intent of ['qa','navigate','mutate']){
   const r=route({...qa,intent},{isolated_playwright:true,
     browser_provider:'persistent',browser_semantic_available:true,browser_tab_ref_present:true});
   assert.equal(r.engine,'playwright_isolated');
   assert.equal(r.browser,'chromium');
   assert.equal(r.status,'selected');
   assert.equal(r.requires_authorization,intent==='mutate');
 }
});
test('not having isolated Playwright cannot automatically trigger personal browser interaction',()=>{
 assert.equal(route(qa,{isolated_playwright:false,browser_provider:'persistent'}).code,
   'BLOCKED_PLAYWRIGHT_UNAVAILABLE');
});
test('exact Edge browser QA must not silently substitute Chromium',()=>{
 assert.equal(route({...qa,browser:'edge'},{isolated_playwright:true}).code,'BLOCKED_EXACT_BROWSER');
 assert.equal(route({...qa,browser:'edge'},{isolated_playwright:true,isolated_edge:true}).engine,'playwright_isolated');
});
test('an isolated session requiring authentication must never copy a Mac login',()=>{
 const r=route({...web,requires_authenticated_access:true},{isolated_playwright:true,
   browser_provider:'persistent',isolated_profile_authenticated:false});
 assert.equal(r.code,'AUTH_REQUIRED');
 assert.equal(r.engine,null);
});
test('existing authenticated Edge uses Browser MCP semantic only after confirmed tab capability',()=>{
 const noTab=route(mac,{browser_provider:'persistent',browser_semantic_available:true,browser_tab_ref_present:false});
 assert.equal(noTab.code,'BLOCKED_SEMANTIC_BROWSER');
 const yesTab=route(mac,{browser_provider:'persistent',browser_semantic_available:true,browser_tab_ref_present:true});
 assert.equal(yesTab.engine,'browser_mcp_semantic');
 assert.equal(yesTab.requires_authorization,true);
 assert(yesTab.evidence.includes('persisted_readback'));
});
test('personal Mac browser cannot be selected without explicit request',()=>{
 assert.equal(route({...mac,explicitly_requested_mac_session:false},{
   browser_provider:'persistent',browser_semantic_available:true,browser_tab_ref_present:true}).code,
   'MAC_BROWSER_CONSENT_REQUIRED');
});
test('native browser fallback only for independently verifiable non-semantic tasks',()=>{
 const caps={browser_provider:'native',native_browser_available:true};
 assert.equal(route({...mac,native_fallback_approved:true,requires_semantic:true,
   result_independently_verifiable:true},caps).code,'BLOCKED_SEMANTIC_BROWSER');
 assert.equal(route({...mac,native_fallback_approved:true,requires_semantic:false,
   result_independently_verifiable:false},caps).code,'BLOCKED_SEMANTIC_BROWSER');
 const r=route({...mac,native_fallback_approved:true,requires_semantic:false,
   result_independently_verifiable:true},caps);
 assert.equal(r.engine,'browser_mcp_native');
 assert.equal(r.semantic_evidence,false);
});
test('native macOS apps use their own engine, never Browser MCP/CDP',()=>{
 assert.equal(route({kind:'mac_desktop'},{native_mac_available:false}).code,'BLOCKED_NATIVE_DESKTOP');
 const r=route({kind:'mac_desktop'},{native_mac_available:true});
 assert.equal(r.engine,'native_mac');
 assert.equal(r.requires_authorization,true);
});
test('shell API tasks remain deterministic without a browser',()=>{
 assert.equal(route({kind:'shell_api'},{shell_api_available:true}).engine,'shell_api');
});
test('invalid/empty requests do not invent availability',()=>{
 assert.equal(chooseExecutionEngine().code,'BLOCKED_PLAYWRIGHT_UNAVAILABLE');
 assert.equal(route({kind:'other'},{}).code,'INVALID_ROUTING_REQUEST');
 assert.equal(route({kind:'web',context:'existing_mac',browser:'chromium',
   explicitly_requested_mac_session:true},{}).code,'INVALID_ROUTING_REQUEST');
});

test('existing Edge session can be inspected natively even if CDP is broken',()=>{
 const t={kind:'web',intent:'qa',context:'existing_mac',browser:'edge',
   explicitly_requested_mac_session:true,requires_semantic:true};
 const d=route(t,{browser_provider:'native',native_browser_available:true});
 assert.equal(d.engine,'browser_mcp_native');
 assert.equal(d.code,'NATIVE_INSPECTION_ONLY');
 assert.equal(d.acceptance_eligible,false);
 assert.deepEqual(d.allowed_operations,['state','screenshot']);
 assert.equal(d.semantic_evidence,false);
});
test('native visual navigation proceeds with explicit authorization but no semantic claim',()=>{
 const t={kind:'web',intent:'navigate',context:'existing_mac',browser:'edge',
   explicitly_requested_mac_session:true,native_fallback_approved:true};
 const d=route(t,{browser_provider:'native',native_browser_available:true});
 assert.equal(d.code,'AUTHENTICATED_VISUAL_NAVIGATION');
 assert.equal(d.engine,'browser_mcp_native');
 assert.equal(d.browser,'edge');
 assert.equal(d.requires_authorization,true);
 assert.equal(d.semantic_evidence,false);
 assert(d.allowed_operations.includes('native_action'));
});
test('native visual navigation without fallback permission does not dispatch',()=>{
 const t={kind:'web',intent:'navigate',context:'existing_mac',browser:'edge',
   explicitly_requested_mac_session:true};
 const d=route(t,{browser_provider:'native',native_browser_available:true});
 assert.equal(d.status,'blocked');
 assert.equal(d.engine,null);
});
test('native corporate mutation remains blocked without independent readback',()=>{
 const t={kind:'web',intent:'mutate',context:'existing_mac',browser:'edge',
   explicitly_requested_mac_session:true,native_fallback_approved:true,
   requires_semantic:false,result_independently_verifiable:false};
 const d=route(t,{browser_provider:'native',native_browser_available:true});
 assert.equal(d.status,'blocked');
});
test('Edge native fallback never silently changes to Chrome persistent profile',()=>{
 const t={kind:'web',intent:'navigate',context:'existing_mac',browser:'edge',
   explicitly_requested_mac_session:true,native_fallback_approved:true};
 const d=route(t,{browser_provider:'native',native_browser_available:true,
   isolated_chrome:true,isolated_playwright:true});
 assert.equal(d.browser,'edge');
 assert.equal(d.context,'existing_mac');
 assert.equal(d.engine,'browser_mcp_native');
});

test('background web QA uses only a verified headless and isolated Playwright engine',()=>{
 const t={kind:'web',intent:'qa',context:'isolated',background_required:true};
 const c={isolated_playwright:true,isolated_playwright_headless:true};
 const decision=route(t,c);
 assert.equal(decision.status,'selected');
 assert.equal(decision.engine,'playwright_isolated');
 assert.equal(decision.focus_impact,'none');
 assert.equal(decision.fully_isolated,true);
 assert.equal(decision.background_mode,'isolated');
});
test('headed project suite cannot be mislabeled as background automation',()=>{
 const t={kind:'web',intent:'qa',context:'isolated',background_required:true};
 const c={project_playwright_suite:true,project_suite_headless:false,
   isolated_playwright:true,isolated_playwright_headless:true};
 assert.equal(route(t,c).engine,'playwright_isolated');
 assert.equal(route(t,{...c,isolated_playwright_headless:false}).code,
   'BACKGROUND_HEADLESS_PLAYWRIGHT_REQUIRED');
});
test('background project suite works only with confirmed headless support',()=>{
 const t={kind:'web',intent:'qa',context:'isolated',background_required:true};
 assert.equal(route(t,{project_playwright_suite:true,project_suite_headless:true}).engine,'playwright_project');
});
test('default isolated background forbids personal authenticated Mac tabs even with CDP',()=>{
 const t={...mac,background_required:true};
 const c={browser_provider:'persistent',browser_semantic_available:true,
   browser_tab_ref_present:true,browser_focus_preserving_verified:true};
 assert.equal(route(t,c).code,'BACKGROUND_PERSONAL_BROWSER_NOT_ISOLATED');
});
test('focus-preserving existing Mac browsing requires attested semantic transport',()=>{
 const t={...mac,background_required:true,background_mode:'focus_preserving'};
 const c={browser_provider:'persistent',browser_semantic_available:true,
   browser_tab_ref_present:true,browser_focus_preserving_verified:true};
 const allow=route(t,c);
 assert.equal(allow.engine,'browser_mcp_semantic');
 assert.equal(allow.fully_isolated,false);
 assert.equal(allow.focus_impact,'os_focus_not_required');
 assert.equal(route(t,{...c,browser_focus_preserving_verified:false}).code,
   'BACKGROUND_SEMANTIC_BROWSER_REQUIRED');
 assert.equal(route(t,{...c,browser_provider:'native',native_browser_available:true}).code,
   'BACKGROUND_SEMANTIC_BROWSER_REQUIRED');
});
test('active desktop CUA is not a background engine even when AX exists',()=>{
 const t={kind:'mac_desktop',background_required:true};
 assert.equal(route(t,{native_mac_available:true,native_mac_ax_available:true}).code,
   'BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED');
 assert.equal(route({...t,background_mode:'focus_preserving'},{
   native_mac_isolated_session:true,native_mac_independent_input:true,
   native_mac_ax_available:true}).code,'BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED');
});
test('isolated Mac GUI is a future distinct provider, not current shared CUA',()=>{
 const t={kind:'mac_desktop',background_required:true,
   isolated_desktop_authorized:true};
 const c={native_mac_isolated_session:true,native_mac_independent_input:true,
   native_mac_ax_available:true};
 const r=route(t,c);
 assert.equal(r.engine,'native_mac_isolated');
 assert.equal(r.focus_impact,'isolated_mac_gui');
 assert.equal(r.requires_authorization,true);
 assert.equal(route({...t,isolated_desktop_authorized:false},c).code,
   'BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED');
});
test('a Mac Terminal command cannot be falsely routed to the Linux workstation',()=>{
 const t={kind:'shell_api',background_required:true,target_host:'macos'};
 assert.equal(route(t,{shell_api_available:true,mac_host_scoped_command_runner_available:false}).code,
   'BACKGROUND_MAC_COMMAND_RUNNER_UNAVAILABLE');
 const r=route(t,{mac_host_scoped_command_runner_available:true});
 assert.equal(r.engine,'mac_host_scoped_api');
 assert.equal(r.focus_impact,'none');
 assert.equal(r.requires_authorization,true);
});
test('non-Mac deterministic shell remains a focus-free background option',()=>{
 const t={kind:'shell_api',background_required:true,target_host:'sandbox'};
 const r=route(t,{shell_api_available:true});
 assert.equal(r.engine,'shell_api');
 assert.equal(r.focus_impact,'none');
});
