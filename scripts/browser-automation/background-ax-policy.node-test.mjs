import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseExecutionEngine} from './engine-router.mjs';
import {evaluateAgentPlan} from './agent-preflight.mjs';
const task={kind:'web',context:'existing_mac',intent:'navigate',browser:'edge',background_required:true,background_mode:'focus_preserving',explicitly_requested_mac_session:true,background_ax_approved:true};
const capabilities={browser_provider:'native',same_mac_background_ax_available:true,same_mac_background_ax_live_verified:true,same_mac_background_ax_tab_ref_present:true};
const plan={engine:'same_mac_background_ax',operation:'navigate',target:{browser:'edge',window_index:1,tab_index:6,expected_title:'Own Teams chat',expected_url:'https://teams.cloud.microsoft/',fresh_observation:true,exact_match_count:1},background_tab_ref:'tab_'+'a'.repeat(32),background_revision:2,ax_control_identity_verified:true,delegated_session_ownership:'active_own',origin_allowlist_status:'allowed',authorization:{ref:'evidence/authorized-background-task.json',sha256:'b'.repeat(64)}};
test('explicit live verified background AX is selectable without a fake DOM claim',()=>{
 const r=chooseExecutionEngine({task,capabilities});assert.equal(r.engine,'same_mac_background_ax');assert.equal(r.semantic_evidence,false);assert.equal(r.ax_semantic_evidence,true);assert.equal(r.fully_isolated,false);assert.equal(evaluateAgentPlan({task,capabilities,plan}).state,'PLAN_VALIDATED');
});
test('configuration or foreground AX alone cannot pass background verification',()=>{
 for(const key of ['same_mac_background_ax_available','same_mac_background_ax_live_verified','same_mac_background_ax_tab_ref_present'])assert.equal(chooseExecutionEngine({task,capabilities:{...capabilities,[key]:false}}).status,'blocked');
 assert.equal(chooseExecutionEngine({task:{...task,background_ax_approved:false},capabilities}).status,'blocked');
});
test('native AX cannot satisfy a DOM requirement or isolated-session request',()=>{
 assert.equal(chooseExecutionEngine({task:{...task,requires_dom:true},capabilities}).code,'BACKGROUND_DOM_PROVIDER_REQUIRED');assert.equal(chooseExecutionEngine({task:{...task,background_mode:'isolated'},capabilities}).status,'blocked');
});
test('fresh AX control, own grant and origin remain mandatory',()=>{
 assert.equal(evaluateAgentPlan({task,capabilities,plan:{...plan,ax_control_identity_verified:false}}).code,'FRESH_BACKGROUND_AX_CONTROL_REQUIRED');
 assert.equal(evaluateAgentPlan({task,capabilities,plan:{...plan,delegated_session_ownership:'another_agent'}}).code,'ACTIVE_OTHER_AGENT_SESSION');
 assert.equal(evaluateAgentPlan({task,capabilities,plan:{...plan,origin_allowlist_status:'denied'}}).code,'MUTATION_ORIGIN_NOT_ALLOWED');
});
