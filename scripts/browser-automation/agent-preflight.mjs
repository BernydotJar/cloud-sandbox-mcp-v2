/**
 * Behavioral reinforcement: evaluate a proposed agent plan against observed
 * browser capabilities before dispatch.
 *
 * PURE policy: never executes UI, reads cookies, authorizes a Mac session,
 * verifies artifact bytes, or grants production permissions.
 */
import {chooseExecutionEngine} from './engine-router.mjs';
import {pathToFileURL,URL} from 'node:url';
import process from 'node:process';
import console from 'node:console';

const digest=/^[a-f0-9]{64}$/;
const ref=/^[A-Za-z0-9][A-Za-z0-9:_./-]{4,199}$/;
const proposedOperations=new Set(['inspect','navigate','run_qa','save','submit_for_approval','desktop_action','shell_action']);
function evidenceReference(value) {
  return Boolean(value && typeof value==='object' && !Array.isArray(value) &&
    typeof value.ref==='string' && ref.test(value.ref) &&
    typeof value.sha256==='string' && digest.test(value.sha256));
}
function outcome(state,code,engine=null,extra={}) {
  return {state,code,recommended_engine:engine,dispatch_authorized:false,
    production_go:false,...extra};
}
function block(code,engine,missing=[]) {
  return outcome('BLOCKED',code,engine,{missing});
}
function exactBrowserTarget(task,plan) {
  const target=plan.target;
  if(!target || typeof target!=='object' || Array.isArray(target) ||
    target.browser!==task.browser ||
    !Number.isInteger(target.window_index) || target.window_index<1 ||
    !Number.isInteger(target.tab_index) || target.tab_index<1 ||
    typeof target.expected_title!=='string' ||
    target.expected_title.trim().length===0 || target.expected_title.length>300 ||
    typeof target.expected_url!=='string' ||
    target.expected_url.length>2048) return false;
  try {
    const u=new URL(target.expected_url);
    if(u.protocol!=='https:' || u.username || u.password || u.search ||
      u.hash || u.toString()!==target.expected_url) return false;
  } catch { return false; }
  return target.fresh_observation===true && target.exact_match_count===1;
}
function operationAllowed(task,decision,operation) {
  if (task.kind==='shell_api') return operation==='shell_action';
  if (task.kind==='mac_desktop') return operation==='desktop_action';
  if (task.intent==='qa') return decision.code==='NATIVE_INSPECTION_ONLY'
    ? operation==='inspect'
    : operation==='run_qa';
  if (task.intent==='navigate') return ['inspect','navigate'].includes(operation);
  if (task.intent==='mutate') return ['inspect','navigate','save','submit_for_approval'].includes(operation);
  return false;
}

export function evaluateAgentPlan({task,capabilities,plan}={}) {
  const decision=chooseExecutionEngine({task,capabilities});
  if(decision.status!=='selected')
    return block(decision.code,decision.engine,decision.prerequisites||[]);
  if(!plan || typeof plan!=='object' || Array.isArray(plan) ||
    !proposedOperations.has(plan.operation))
    return block('INVALID_AGENT_PLAN',decision.engine,['operation']);
  if(plan.engine!==decision.engine)
    return block('ENGINE_POLICY_MISMATCH',decision.engine,['matching_proposed_engine']);
  if(!operationAllowed(task,decision,plan.operation))
    return block('OPERATION_SCOPE_ESCALATION',decision.engine,['permitted_operation']);
  if(task.kind==='mac_desktop') {
    if(plan.delegated_session_ownership!=='active_own' ||
      evidenceReference(plan.authorization)!==true)
      return block('MAC_DESKTOP_AUTHORIZATION_REQUIRED',decision.engine,['own_mac_session','authorization_ref']);
    return outcome('PLAN_VALIDATED','NATIVE_DESKTOP_PREFLIGHT',decision.engine,{evidence_status:'metadata_only'});
  }
  if(task.kind==='shell_api') return outcome('PLAN_VALIDATED','SCOPED_SHELL_PREFLIGHT',decision.engine);

  if(task.context==='existing_mac') {
    if(!['chrome','edge'].includes(task.browser) ||
      !exactBrowserTarget(task,plan))
      return block('FRESH_UNIQUE_BROWSER_TARGET_REQUIRED',decision.engine,
        ['exact_browser','exact_sanitized_url','exact_title','fresh_window_and_tab_index','unique_tab_match']);
    if(plan.delegated_session_ownership==='another_agent')
      return block('ACTIVE_OTHER_AGENT_SESSION',decision.engine);
    const uiAction=plan.operation!=='inspect' && plan.operation!=='run_qa';
    if(decision.code==='NATIVE_INSPECTION_ONLY' && uiAction)
      return block('NATIVE_INSPECTION_READONLY',decision.engine);
    if(uiAction && (plan.delegated_session_ownership!=='active_own' ||
      !evidenceReference(plan.authorization)))
      return block('TASK_SCOPED_DELEGATION_REQUIRED',decision.engine,['own_browser_session','authorization_ref']);
    if(uiAction && plan.origin_allowlist_status!=='allowed')
      return block('MUTATION_ORIGIN_NOT_ALLOWED',decision.engine,['observed_origin_policy']);
    if(decision.engine==='browser_mcp_native' && task.requires_semantic===true &&
      plan.operation!=='inspect')
      return block('SEMANTIC_EVIDENCE_UNAVAILABLE',decision.engine);
  } else if(!['playwright_project','playwright_isolated'].includes(decision.engine)) {
    return block('ISOLATED_PLAYWRIGHT_REQUIRED',decision.engine);
  }

  if(plan.operation==='save'||plan.operation==='submit_for_approval') {
    if(plan.proof_strategy!=='reload_readback')
      return block('PERSISTENCE_PROOF_PLAN_REQUIRED',decision.engine,['reload_readback']);
    if(!evidenceReference(plan.record_identity))
      return block('RECORD_IDENTITY_PROOF_REQUIRED',decision.engine,['record_identity']);
    if(!evidenceReference(plan.duplicate_check))
      return block('DUPLICATE_CHECK_REQUIRED',decision.engine,['duplicate_check']);
    if(task.requires_category_coverage===true &&
      !evidenceReference(plan.category_coverage))
      return block('CATEGORY_COVERAGE_REQUIRED',decision.engine,['category_coverage']);
    if(task.requires_corporate_approval===true &&
      !evidenceReference(plan.corporate_approval))
      return block('CORPORATE_APPROVAL_REQUIRED',decision.engine,['corporate_approval']);
    if(plan.operation==='submit_for_approval' &&
      (task.submit_explicitly_authorized!==true ||
       !evidenceReference(plan.submit_authorization)))
      return block('SUBMIT_NOT_AUTHORIZED',decision.engine,['explicit_submit_permission']);
  }

  return outcome('PLAN_VALIDATED','BROWSER_PREFLIGHT',decision.engine,{
    evidence_status:'metadata_only',semantic_evidence:decision.semantic_evidence??null,
    next_step:'Host still enforces grants, exact target and origin; independently verify effects.'
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    // Prefer stdin so URLs, task details and tokens are not put into argv.
    // Never pass passwords, session IDs or raw cookies into this preflight.
    let raw='';
    for await(const chunk of process.stdin) {
      raw += chunk.toString('utf8');
      if(raw.length>50000)throw Error('PREFLIGHT_INPUT_TOO_LARGE');
    }
    const input=JSON.parse(raw);
    const result=evaluateAgentPlan(input);
    console.log(JSON.stringify(result,null,2));
    if(result.state!=='PLAN_VALIDATED')process.exitCode=3;
  }catch{
    console.error('INVALID_AGENT_PREFLIGHT');
    process.exitCode=2;
  }
}
