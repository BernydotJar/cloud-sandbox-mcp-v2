/**
 * Capability-only routing for the authenticated Omnissa Horizon Web Client.
 * A screenshot of a VDI framebuffer is NOT a remote Windows DOM or UIA tree.
 * Pure/side-effect-free; does not connect to the Web Client or authorize input.
 */
import {URL} from 'node:url';

export const HORIZON_WEBCLIENT_GATE_VERSION='1.0.0';
const selected=(code,reason,extras={})=>({
  status:'selected',engine:'horizon_webclient_native_visual',
  code,reason,...extras
});
const blocked=(code,reason,extras={})=>({
  status:'blocked',engine:null,code,reason,...extras
});
const bo=x=>x===true;
function exactWebClientUrl(raw){
  if(typeof raw!=='string' || raw.length>2048)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:' || url.port || url.username || url.password ||
       url.hostname.length<4 || url.hostname.includes('*') ||
       !url.pathname.startsWith('/portal/webclient/'))
      return null;
    return {origin:url.origin,pathname:url.pathname};
  }catch{return null;}
}
export function evaluateHorizonWebClient({task={},capabilities={}}={}){
  if(task.kind!=='web' || task.context!=='existing_mac' ||
     !['edge','chrome'].includes(task.browser))
    return blocked('VDI_EXISTING_MAC_BROWSER_REQUIRED',
      'Reuse the explicitly requested authenticated Mac browser session; never copy the VDI credentials.');
  const expected=exactWebClientUrl(task.target_url);
  const observed=exactWebClientUrl(capabilities.observed_tab_url);
  if(!expected || !observed ||
     expected.origin!==observed.origin || expected.pathname!==observed.pathname)
    return blocked('VDI_WEBCLIENT_TAB_IDENTITY_UNVERIFIED',
      'Require the exact observed Horizon Web Client HTTPS origin and path, not a guessed tab or credential transfer.');
  if(!bo(task.explicitly_requested_mac_session) || !bo(capabilities.origin_allowlisted))
    return blocked('VDI_ORIGIN_OR_CONSENT_REQUIRED',
      'Require explicit operator scope and exact host origin authorization.');
  if(task.background_required===true)
    return blocked('VDI_VISUAL_FOREGROUND_REQUIRED',
      'Current native visual input focuses the operator browser; it is not a nonintrusive background driver.');
  if(task.requires_dom===true || task.requires_semantic===true)
    return blocked('VDI_GUEST_SEMANTICS_NOT_EXPOSED',
      'Host browser DOM cannot represent the Windows guest control tree.');
  if(task.intent==='mutate')
    return blocked('VDI_CORPORATE_WRITE_WORKFLOW_REQUIRED',
      'No administrative mutation through a screenshot-driven VDI route. Require a separately approved audited workflow.');
  if(!['qa','navigate'].includes(task.intent))
    return blocked('VDI_INTENT_UNSUPPORTED','Only read-only inspection and visual navigation are supported.');
  if(capabilities.browser_provider!=='native' ||
     !bo(capabilities.native_browser_available) ||
     !bo(capabilities.native_tab_identity_verified))
    return blocked('VDI_NATIVE_TARGET_UNAVAILABLE',
      'Require one fresh, identity-bound native browser tab reference.');
  if(!bo(capabilities.native_screenshot_verified) ||
     !bo(capabilities.remote_desktop_frame_observed))
    return blocked('VDI_REMOTE_FRAME_UNVERIFIED',
      'The remote desktop image must be observable and capture policies respected.');
  const base={
    browser:task.browser,context:'existing_mac',remote_surface:'horizon_webclient',
    guest_dom_available:false,semantic_evidence:false,fully_isolated:false,
    focus_impact:'may_activate_operator_browser',
    requires_authorization:task.intent==='navigate',
    corporate_identity_verified:false,
    origin:expected.origin, // never include remote URL query/fragment
    prerequisites:['exact_live_tab_and_title','allowlisted_https_origin',
      'corporate_capture_and_input_policy_respected','fresh_window_geometry',
      'redacted_before_after_capture','guest_identity_check_before_business_actions'],
    evidence:['observed_remote_frame','fresh_tab_identity','before_after_visual_readback',
      'mac_bridge_audit','grant_revoked']
  };
  if(task.intent==='qa') {
    return selected('VDI_VISUAL_READ_ONLY',
      'Inspect the authenticated Horizon Web Client visually; no Windows DOM or write access.',
      {...base,requires_authorization:false,acceptance_eligible:false,
       allowed_operations:['discover_tab','capture_window']});
  }
  if(!bo(task.native_fallback_approved) || !bo(task.foreground_approved) ||
     !bo(capabilities.native_window_geometry_verified))
    return blocked('VDI_FOREGROUND_INPUT_NOT_APPROVED',
      'Visual navigation requires a fresh coordinate mapping, explicit task authorization, and foreground acceptance.');
  return selected('VDI_READ_ONLY_VISUAL_NAVIGATION',
    'Use one scoped native browser click, then independently capture and verify the remote result.',
    {...base,requires_authorization:true,acceptance_eligible:true,
     allowed_operations:['discover_tab','capture_window','click_navigation_only',
       'verify_visual_readback','revoke_grant'],
     prerequisites:[...base.prerequisites,'own_delegated_browser_session',
       'independent_navigation_confirmation','no_corporate_resource_mutation']});
}
