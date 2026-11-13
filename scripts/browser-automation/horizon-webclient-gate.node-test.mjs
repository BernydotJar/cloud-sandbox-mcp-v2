import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateHorizonWebClient} from './horizon-webclient-gate.mjs';
import {chooseExecutionEngine} from './engine-router.mjs';

const task={
  kind:'web',intent:'navigate',context:'existing_mac',browser:'edge',
  remote_surface:'horizon_webclient',
  target_url:'https://vdi.toyota.com.ar/portal/webclient/#/desktop',
  explicitly_requested_mac_session:true,
  native_fallback_approved:true,foreground_approved:true,
  requires_semantic:false
};
const caps={
  browser_provider:'native',native_browser_available:true,
  native_tab_identity_verified:true,
  observed_tab_url:'https://vdi.toyota.com.ar/portal/webclient/',
  origin_allowlisted:true,native_screenshot_verified:true,
  remote_desktop_frame_observed:true,native_window_geometry_verified:true
};
const decide=(t=task,c=caps)=>evaluateHorizonWebClient({task:t,capabilities:c});
test('real pilot routes to explicit visual VDI not Playwright or remote Windows DOM',()=>{
  const r=chooseExecutionEngine({task,capabilities:caps});
  assert.equal(r.status,'selected');
  assert.equal(r.engine,'horizon_webclient_native_visual');
  assert.equal(r.code,'VDI_READ_ONLY_VISUAL_NAVIGATION');
  assert.equal(r.guest_dom_available,false);
  assert.equal(r.focus_impact,'may_activate_operator_browser');
  assert.equal(r.fully_isolated,false);
  assert.equal(r.corporate_identity_verified,false);
  assert.equal(r.origin,'https://vdi.toyota.com.ar');
  assert.equal(r.requires_authorization,true);
  assert(r.allowed_operations.includes('click_navigation_only'));
  assert(!r.allowed_operations.includes('fill'));
  assert(!r.allowed_operations.includes('execute_js'));
  assert(r.evidence.includes('grant_revoked'));
});
test('visual inspection does not authorize click or production acceptance',()=>{
  const r=decide({...task,intent:'qa',native_fallback_approved:false,foreground_approved:false},
    {...caps,native_window_geometry_verified:false});
  assert.equal(r.code,'VDI_VISUAL_READ_ONLY');
  assert.deepEqual(r.allowed_operations,['discover_tab','capture_window']);
  assert.equal(r.acceptance_eligible,false);
});
test('admin writes and business mutations are blocked even if browser and screenshot work',()=>{
  const r=chooseExecutionEngine({task:{...task,intent:'mutate'},capabilities:caps});
  assert.equal(r.code,'VDI_CORPORATE_WRITE_WORKFLOW_REQUIRED');
  assert.equal(r.engine,null);
});
test('no implicit corporate VDI automation when owner did not authorize',()=>{
  assert.equal(decide({...task,explicitly_requested_mac_session:false}).code,
    'VDI_ORIGIN_OR_CONSENT_REQUIRED');
  assert.equal(decide(task,{...caps,origin_allowlisted:false}).code,
    'VDI_ORIGIN_OR_CONSENT_REQUIRED');
});
test('fail closed on URL/path mismatch, HTTP, arbitrary origin, credentials and missing tab',()=>{
  for(const url of [
    'http://vdi.toyota.com.ar/portal/webclient/',
    'https://evil.example.com/portal/webclient/',
    'https://vdi.toyota.com.ar/portal/other/',
    'https://user:password@vdi.toyota.com.ar/portal/webclient/',
    'https://vdi.toyota.com.ar:8443/portal/webclient/',
    'not-a-url'
  ])assert.equal(decide(task,{...caps,observed_tab_url:url}).code,
    'VDI_WEBCLIENT_TAB_IDENTITY_UNVERIFIED',url);
  assert.equal(decide({...task,target_url:'https://other.example.com/portal/webclient/'}).code,
    'VDI_WEBCLIENT_TAB_IDENTITY_UNVERIFIED');
});
test('no hidden background native input and no Windows guest semantic claim',()=>{
  assert.equal(decide({...task,background_required:true,background_mode:'focus_preserving'}).code,
    'VDI_VISUAL_FOREGROUND_REQUIRED');
  assert.equal(decide({...task,requires_dom:true}).code,
    'VDI_GUEST_SEMANTICS_NOT_EXPOSED');
  assert.equal(decide({...task,requires_semantic:true}).code,
    'VDI_GUEST_SEMANTICS_NOT_EXPOSED');
});
test('capture verification and window geometry are required before clicking',()=>{
  assert.equal(decide(task,{...caps,remote_desktop_frame_observed:false}).code,
    'VDI_REMOTE_FRAME_UNVERIFIED');
  assert.equal(decide(task,{...caps,native_screenshot_verified:false}).code,
    'VDI_REMOTE_FRAME_UNVERIFIED');
  assert.equal(decide(task,{...caps,native_window_geometry_verified:false}).code,
    'VDI_FOREGROUND_INPUT_NOT_APPROVED');
  assert.equal(decide({...task,foreground_approved:false}).code,
    'VDI_FOREGROUND_INPUT_NOT_APPROVED');
});
test('browser mismatches, arbitrary surfaces and malformed requests never default to VDI control',()=>{
  assert.equal(decide({...task,browser:'chromium'}).code,'VDI_EXISTING_MAC_BROWSER_REQUIRED');
  assert.equal(decide({...task,context:'isolated'}).code,'VDI_EXISTING_MAC_BROWSER_REQUIRED');
  assert.equal(chooseExecutionEngine({task:{...task,remote_surface:'unknown'},capabilities:caps}).code,
    'UNSUPPORTED_REMOTE_SURFACE');
  assert.equal(chooseExecutionEngine({task:{kind:'web',intent:'qa'},
    capabilities:{isolated_playwright:true}}).engine,'playwright_isolated');
});
