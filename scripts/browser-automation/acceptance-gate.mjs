/**
 * Structural evidence gate for browser automation.
 *
 * This checks required proof references, browser/profile identity, semantic
 * limitations and persistence-readback structure. It does NOT authenticate
 * artifacts or replace an independent Graph Harness approver.
 */
import process from 'node:process';
import console from 'node:console';
import {pathToFileURL} from 'node:url';

const digest=/^[a-f0-9]{64}$/;
const safeId=/^[A-Za-z0-9][A-Za-z0-9:_./-]{4,199}$/;
const engines=new Set(['playwright_project','playwright_isolated','browser_mcp_semantic','browser_mcp_native']);

function evidenceRef(value) {
  return value && typeof value==='object' && !Array.isArray(value) &&
    typeof value.ref==='string' && safeId.test(value.ref) &&
    typeof value.sha256==='string' && digest.test(value.sha256);
}
function blocked(code,missing=[]) {
  return {state:'BLOCKED',code,missing,production_go:false,
    validation_scope:'structure_only_independent_attestation_required'};
}
function observed(scope,code) {
  return {state:'EVIDENCE_COMPLETE',code,scope,production_go:false,
    validation_scope:'structure_only_independent_attestation_required'};
}

export function assessBrowserEvidence({task={},decision={},evidence={}}={}) {
  if (!task || typeof task!=='object' || Array.isArray(task) ||
      !decision || typeof decision!=='object' || Array.isArray(decision) ||
      !evidence || typeof evidence!=='object' || Array.isArray(evidence))
    return blocked('INVALID_EVIDENCE_REQUEST');
  if(decision.status!=='selected' || !engines.has(decision.engine))
    return blocked('ROUTING_NOT_AUTHORIZED');
  const context=task.context||'isolated';
  const intent=task.intent||'navigate';
  const browser=task.browser||(context==='existing_mac'?null:'chromium');
  if (!['qa','navigate','mutate'].includes(intent) ||
      !['isolated','existing_mac'].includes(context))
    return blocked('INVALID_EVIDENCE_REQUEST');
  if(context==='existing_mac') {
    if(!['chrome','edge'].includes(browser) || decision.browser!==browser ||
       evidence.observed_browser!==browser || evidence.original_profile_preserved!==true)
      return blocked('BROWSER_PROFILE_MISMATCH');
    if(!evidenceRef(evidence.target_identity)) return blocked('MISSING_FRESH_TARGET_IDENTITY',['target_identity']);
  }else if(!['playwright_project','playwright_isolated'].includes(decision.engine) ||
           evidence.observed_browser!==(browser||'chromium') ||
           evidence.isolated_context!==true) {
    return blocked('ISOLATED_BROWSER_EVIDENCE_MISSING',['observed_browser','isolated_context']);
  }

  if(intent==='qa') {
    if(decision.engine==='browser_mcp_native')
      return blocked('NATIVE_INSPECTION_IS_NOT_SEMANTIC_QA',['semantic_assertions']);
    const assertions=evidence.assertions;
    if (!Array.isArray(assertions)||!assertions.length ||
        assertions.some(a=>!a||typeof a.name!=='string'||a.name.length<3||a.passed!==true) ||
        !evidenceRef(evidence.trace))
      return blocked('QA_EVIDENCE_INCOMPLETE',['passing_assertions','trace']);
    return observed('qa_evidence_only','QA_ASSERTIONS_AND_TRACE_PRESENT');
  }

  if(intent==='navigate') {
    if(!evidenceRef(evidence.after_observation))
      return blocked('MISSING_POST_ACTION_OBSERVATION',['after_observation']);
    if(decision.code==='NATIVE_INSPECTION_ONLY')
      return {state:'DIAGNOSTIC_ONLY',code:'NATIVE_NON_SEMANTIC_OBSERVATION',
        scope:'native_read_only',production_go:false,semantic_evidence:false,
        validation_scope:'structure_only_independent_attestation_required'};
    if(decision.engine==='browser_mcp_native' && !evidenceRef(evidence.action_receipt))
      return blocked('MISSING_NATIVE_ACTION_RECEIPT',['action_receipt']);
    return observed('navigation_only','NAVIGATION_OBSERVATION_PRESENT');
  }

  // Mutation is not complete until an independently observed persisted record
  // matches the intended value AFTER the UI's Save/reload behavior.
  if(!evidenceRef(evidence.authorization))
    return blocked('MISSING_ACTION_AUTHORIZATION',['authorization']);
  if(!evidenceRef(evidence.before_observation) ||
     !evidenceRef(evidence.action_receipt) ||
     !evidenceRef(evidence.after_observation))
    return blocked('MISSING_MUTATION_PROOF',['before_observation','action_receipt','after_observation']);
  if(!digest.test(String(evidence.expected_record_key_sha256||'')))
    return blocked('RECORD_IDENTITY_NOT_EVIDENCED',['expected_record_key_sha256']);
  const readback=evidence.persisted_readback;
  if(!readback || !evidenceRef(readback.artifact) ||
     readback.artifact.ref===evidence.after_observation.ref ||
     readback.source!=='application_reloaded' || readback.independent!==true ||
     !digest.test(String(readback.record_key_sha256||'')) ||
     readback.record_key_sha256!==evidence.expected_record_key_sha256 ||
     !digest.test(String(readback.expected_value_sha256||'')) ||
     !digest.test(String(readback.observed_value_sha256||'')) ||
     readback.expected_value_sha256!==readback.observed_value_sha256)
    return blocked('PERSISTENCE_NOT_VERIFIED',['persisted_readback','record_identity']);
  if(context==='existing_mac' && decision.engine==='browser_mcp_native' &&
     decision.semantic_evidence!==false)
    return blocked('NATIVE_SEMANTIC_EVIDENCE_CLAIM');
  if(task.requires_corporate_approval===true && !evidenceRef(evidence.corporate_approval))
    return blocked('CORPORATE_APPROVAL_NOT_EVIDENCED',['corporate_approval']);
  if(task.requires_category_coverage===true && !evidenceRef(evidence.category_coverage))
    return blocked('CATEGORY_COVERAGE_NOT_EVIDENCED',['category_coverage']);
  return observed('persisted_write_evidence_only','PERSISTED_READBACK_REFERENCED');
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const record=JSON.parse(process.argv[2]||'{}');
    const verdict=assessBrowserEvidence(record);
    console.log(JSON.stringify(verdict,null,2));
    if(verdict.state!=='EVIDENCE_COMPLETE')process.exitCode=3;
  } catch {
    console.error('INVALID_EVIDENCE_REQUEST');
    process.exitCode=2;
  }
}
