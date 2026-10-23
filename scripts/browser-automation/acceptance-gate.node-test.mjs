import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chooseExecutionEngine} from './engine-router.mjs';
import {assessBrowserEvidence} from './acceptance-gate.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const artifact=name=>({ref:'evidence/'+name,sha256:hash(name)});
const route=(task,capabilities)=>chooseExecutionEngine({task,capabilities});

const webQa={kind:'web',intent:'qa'};
const qaRoute=route(webQa,{isolated_playwright:true});
const qaEvidence={observed_browser:'chromium',isolated_context:true,
  assertions:[{name:'checkout confirmation visible',passed:true}],trace:artifact('trace.zip')};
const task={kind:'web',intent:'mutate',context:'existing_mac',browser:'edge',
  explicitly_requested_mac_session:true,requires_semantic:false,
  native_fallback_approved:true,result_independently_verifiable:true,
  requires_corporate_approval:true,requires_category_coverage:true};
const nativeRoute=route(task,{browser_provider:'native',native_browser_available:true});
const writeEvidence={observed_browser:'edge',original_profile_preserved:true,
  target_identity:artifact('target-captured'),authorization:artifact('user-approval'),
  before_observation:artifact('before.png'),action_receipt:artifact('action-audit'),
  after_observation:artifact('after.png'),corporate_approval:artifact('corp-authorized'),
  category_coverage:artifact('all-assignments-and-holidays'),expected_record_key_sha256:hash('edge|loves|2026-10-19|development'),
  persisted_readback:{artifact:artifact('reloaded.png'),
    source:'application_reloaded',independent:true,
    record_key_sha256:hash('edge|loves|2026-10-19|development'),
    expected_value_sha256:hash('08'),observed_value_sha256:hash('08')}};

test('a blocked engine cannot be promoted to evidence PASS',()=>{
 const d=assessBrowserEvidence({task:webQa,decision:{status:'blocked',engine:null},evidence:qaEvidence});
 assert.equal(d.state,'BLOCKED');
 assert.equal(d.production_go,false);
});
test('QA needs passing assertions and a content-addressed trace',()=>{
 const missing=assessBrowserEvidence({task:webQa,decision:qaRoute,
   evidence:{...qaEvidence,trace:null}});
 assert.equal(missing.code,'QA_EVIDENCE_INCOMPLETE');
 const accepted=assessBrowserEvidence({task:webQa,decision:qaRoute,evidence:qaEvidence});
 assert.equal(accepted.state,'EVIDENCE_COMPLETE');
 assert.equal(accepted.production_go,false);
});
test('native visual inspection never establishes semantic E2E acceptance',()=>{
 const nativeTask={kind:'web',intent:'qa',context:'existing_mac',browser:'edge',
   explicitly_requested_mac_session:true};
 const decision=route(nativeTask,{browser_provider:'native',native_browser_available:true});
 assert.equal(decision.code,'NATIVE_INSPECTION_ONLY');
 const d=assessBrowserEvidence({task:nativeTask,decision,evidence:{
   observed_browser:'edge',original_profile_preserved:true,
   target_identity:artifact('edge-tab'),after_observation:artifact('screen.png')}});
 assert.equal(d.code,'NATIVE_INSPECTION_IS_NOT_SEMANTIC_QA');
});
test('read-only native navigation is diagnostic, not a production GO',()=>{
 const t={...task,intent:'qa'};
 const d=route(t,{browser_provider:'native',native_browser_available:true});
 assert.equal(d.allowed_operations.includes('native_action'),false);
 const inspected=assessBrowserEvidence({task:{...task,intent:'navigate'},
   decision:{...d,code:'NATIVE_INSPECTION_ONLY'},evidence:{
   observed_browser:'edge',original_profile_preserved:true,
   target_identity:artifact('tab'),after_observation:artifact('visual')}});
 assert.equal(inspected.state,'DIAGNOSTIC_ONLY');
});
test('corporate write with a persisted readback still requires independent Graph Harness attestation',()=>{
 assert.equal(nativeRoute.engine,'browser_mcp_native');
 const d=assessBrowserEvidence({task,decision:nativeRoute,evidence:writeEvidence});
 assert.equal(d.state,'EVIDENCE_COMPLETE');
 assert.equal(d.scope,'persisted_write_evidence_only');
 assert.equal(d.production_go,false);
});
test('never accept Chrome evidence for a requested authenticated Edge profile',()=>{
 const d=assessBrowserEvidence({task,decision:nativeRoute,
   evidence:{...writeEvidence,observed_browser:'chrome'}});
 assert.equal(d.code,'BROWSER_PROFILE_MISMATCH');
});
test('do not count performed=true or populated fields as a saved record',()=>{
 const d=assessBrowserEvidence({task,decision:nativeRoute,
   evidence:{...writeEvidence,persisted_readback:null}});
 assert.equal(d.code,'PERSISTENCE_NOT_VERIFIED');
});
test('a reload whose value changed is not a successful persisted write',()=>{
 const d=assessBrowserEvidence({task,decision:nativeRoute,
   evidence:{...writeEvidence,persisted_readback:{
     ...writeEvidence.persisted_readback,observed_value_sha256:hash('00')}}});
 assert.equal(d.code,'PERSISTENCE_NOT_VERIFIED');
});
test('mandatory corporate approval remains a distinct gate',()=>{
 const d=assessBrowserEvidence({task,decision:nativeRoute,
   evidence:{...writeEvidence,corporate_approval:null}});
 assert.equal(d.code,'CORPORATE_APPROVAL_NOT_EVIDENCED');
});
test('missing prior state, action audit or authorization is never accepted',()=>{
 for(const key of ['before_observation','action_receipt','authorization']){
   const d=assessBrowserEvidence({task,decision:nativeRoute,
     evidence:{...writeEvidence,[key]:null}});
   assert.equal(d.state,'BLOCKED');
 }
});
test('an anonymous isolated Playwright profile is not evidence of authenticated Mac browser use',()=>{
 const d=assessBrowserEvidence({task,decision:qaRoute,evidence:qaEvidence});
 assert.equal(d.code,'BROWSER_PROFILE_MISMATCH');
});


test('eight hours on a different project/day cannot satisfy a readback',()=>{
 const d=assessBrowserEvidence({task,decision:nativeRoute,
   evidence:{...writeEvidence,persisted_readback:{
     ...writeEvidence.persisted_readback,record_key_sha256:hash('other-project|2026-10-20')}}});
 assert.equal(d.code,'PERSISTENCE_NOT_VERIFIED');
});
test('category and holiday coverage is mandatory for jobs that require it',()=>{
 const d=assessBrowserEvidence({task,decision:nativeRoute,
   evidence:{...writeEvidence,category_coverage:null}});
 assert.equal(d.code,'CATEGORY_COVERAGE_NOT_EVIDENCED');
});
test('the same after screenshot cannot masquerade as a separate reload verification',()=>{
 const d=assessBrowserEvidence({task,decision:nativeRoute,
   evidence:{...writeEvidence,persisted_readback:{
     ...writeEvidence.persisted_readback,artifact:writeEvidence.after_observation}}});
 assert.equal(d.code,'PERSISTENCE_NOT_VERIFIED');
});
