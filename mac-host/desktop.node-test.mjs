import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore} from './autonomy-session.mjs';
import {createDesktopRoutes} from './desktop-routes.mjs';
import {parseAllowedBundles,validateMutation,createDesktopRequestGate} from './desktop-policy.mjs';
const allowed=parseAllowedBundles('com.apple.finder,com.apple.Terminal,com.microsoft.VSCode');
const token='a'.repeat(48);
const base={bundle_id:'com.apple.finder',pid:42,window_index:1,expected_title:'Documents'};
const action={...base,session_id:token,request_id:'unique_request_00001',
  reason:'Inspect the requested Finder location',action:'click',element_path:'0.1',
  expected_role:'AXButton',expected_name:'Back'};
test('macOS app allowlist rejects unknown bundles',()=>{
  assert.equal(allowed.size,3);
  assert.throws(()=>parseAllowedBundles('com.apple.finder,invalid'),/INVALID_MAC_ALLOWLIST/);
  assert.throws(()=>validateMutation({...action,bundle_id:'com.apple.systempreferences'},allowed),
    /MAC_APP_NOT_ALLOWED/);
});
test('desktop delegation does not authorize browser actions',()=>{
  const s=createSessionStore({randomId:()=>token});
  s.begin({scope:'desktop',duration_minutes:1,max_actions:3,purpose:'Inspect a selected Finder window'});
  assert.throws(()=>s.authorize(token,'chrome'),/SESSION_SCOPE_MISMATCH/);
  assert.equal(s.authorize(token,'desktop').remaining_actions,3);
});
test('no action without explicit desktop session',()=>{
  const s=createSessionStore();
  const route=createDesktopRoutes({allowedBundles:allowed,sessionStore:s,auditHandler:async()=>{},
    nativeHandler:async()=>({performed:true})});
  return assert.rejects(()=>route('/v3/mac/action',action),/SESSION_NOT_ACTIVE/);
});
test('desktop routes inspect without mutation and protect against replay',async()=>{
  const events=[],calls=[],s=createSessionStore({randomId:()=>token});
  s.begin({scope:'desktop',duration_minutes:1,max_actions:3,purpose:'Operate the selected Finder window'});
  const route=createDesktopRoutes({allowedBundles:allowed,sessionStore:s,
    auditHandler:async event=>events.push(event),
    nativeHandler:async(...args)=>{calls.push(args);return {performed:true};}});
  await route('/v3/mac/inspect',base);
  assert.equal(events.length,0);
  await route('/v3/mac/action',action);
  assert.equal(calls[1][0],'action');
  assert.equal(s.status().remaining_actions,2);
  await assert.rejects(()=>route('/v3/mac/action',action),/MAC_REQUEST_ALREADY_DISPATCHED/);
  assert.equal(calls.length,2);
  assert.equal(JSON.stringify(events).includes('Back'),false);
});
test('malformed text and accessibility paths fail before dispatch',()=>{
  assert.throws(()=>validateMutation({...action,element_path:'0.__proto__'},allowed),/INVALID_MAC_ELEMENT/);
  assert.throws(()=>validateMutation({...action,action:'type_text',text:''},allowed),/INVALID_MAC_TEXT/);
});
test('replay gate never dispatches a duplicate operation',()=>{
  const gate=createDesktopRequestGate();
  gate.claim('unique_request_00009');
  assert.throws(()=>gate.claim('unique_request_00009'),/MAC_REQUEST_ALREADY_DISPATCHED/);
});
