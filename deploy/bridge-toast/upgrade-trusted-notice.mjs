/**
 * Additive operator-opt-in delegation notice migration.
 * Does not remove the existing approval flow for deployments without opt-in.
 * Auto-delegation is bounded to a single browser and an exact HTTPS allowlist.
 */
import {upgradeToastBridgeSource,upgradeToastEnvSource} from './upgrade-toast.mjs';

export const TRUSTED_NOTICE_MARKER='// LCH_BRIDGE_TRUSTED_NOTICE_V2';

function replaceOnce(s,from,to,stage){
  const i=s.indexOf(from);
  if(i<0 || s.indexOf(from,i+from.length)!==-1)throw Error('TRUSTED_NOTICE_BRIDGE_MISMATCH_'+stage);
  return s.slice(0,i)+to+s.slice(i+from.length);
}

export function upgradeTrustedNoticeBridgeSource(source) {
  const base=upgradeToastBridgeSource(source);
  if(base.source.includes(TRUSTED_NOTICE_MARKER)){
    for(const invariant of ['trustedSessionNoticeEnabled','trustedSessionNoticeHandler',
      'configured_trust','TRUSTED_SESSION_LIMITS_EXCEEDED'])
      if(!base.source.includes(invariant))throw Error('PARTIAL_TRUSTED_NOTICE_PATCH');
    return {...base,applied:false};
  }
  const helper=[
    TRUSTED_NOTICE_MARKER,
    'async function showTrustedSessionNotice({scope,duration_minutes}) {',
    "  const executable=path.join(os.homedir(),",
    "    'Library/Application Support/LCH/CloudSandboxComputerUse/ux/bridge-toast');",
    "  try { await exec(executable,['--session-notice',scope,",
    "    String(duration_minutes),'unlimited'],{timeout:25000,maxBuffer:512}); }",
    '  catch { /* Visual confirmation is optional. */ }',
    '}'
  ].join('\n');
  let updated=replaceOnce(base.source,
    'export function nativeDiscoveryFallback',
    helper+'\n\nexport function nativeDiscoveryFallback','HELPER');
  updated=replaceOnce(updated,
    'bridgeToastHandler = showDedicatedChromeToast}) {',
    'bridgeToastHandler = showDedicatedChromeToast,\n'+
    '                                   trustedSessionNoticeEnabled = false,\n'+
    '                                   trustedSessionNoticeHandler = showTrustedSessionNotice}) {',
    'HANDLER_SIGNATURE');
  updated=replaceOnce(updated,
    "  if (typeof restrictBrowserWrites !== 'boolean') throw new Error('INVALID_MUTATION_POLICY');",
    "  if (typeof restrictBrowserWrites !== 'boolean') throw new Error('INVALID_MUTATION_POLICY');\n"+
    "  if (trustedSessionNoticeEnabled && !restrictBrowserWrites)\n"+
    "    throw new Error('TRUSTED_NOTICE_REQUIRES_ALLOWLIST');",
    'MUTATION_GUARD');
  updated=replaceOnce(updated,
    "        if (!await approvalHandler(prompt)) throw new Error('USER_DENIED_SESSION');",
    [
      "        // Trusted mode is an explicit Mac operator opt-in, never an agent-request flag.",
      "        // Only exact configured HTTPS allowlisted origins may be mutated.",
      "        const trusted=trustedSessionNoticeEnabled;",
      "        if(trusted && (input.scope==='both' || input.duration_minutes>30))",
      "          throw new Error('TRUSTED_SESSION_LIMITS_EXCEEDED');",
      "        if(trusted) {",
      "          // Fail closed if the audit cannot record intent BEFORE creating authority.",
      "          try { await auditHandler({action:'trusted_session_intent',",
      "            outcome:'prepared',scope:input.scope,",
      "            duration_minutes:input.duration_minutes,unlimited_actions:true}); }",
      "          catch { throw new Error('AUDIT_UNAVAILABLE'); }",
      "        } else if(!await approvalHandler(prompt))throw new Error('USER_DENIED_SESSION');"
    ].join('\n'),
    'APPROVAL_BRANCH');
  updated=replaceOnce(updated,
    '          const session=sessionStore.begin(input);',
    [
      '          const session=sessionStore.begin(trusted',
      '            ? {...input,unlimited_actions:true}',
      '            : input);'
    ].join('\n'),
    'TRUSTED_NOTIFICATION');
  updated=replaceOnce(updated,
    "          reply(res,200,{ok:true,data:{...session,audit_receipt:auditSaved?'saved':'unavailable'}});",
    "          if(trusted && !auditSaved) {\n"+
    "            sessionStore.end(session.session_id);\n"+
    "            throw new Error('AUDIT_UNAVAILABLE');\n"+
    "          }\n"+
    "          if(trusted) {\n"+
    "            bridgeToastShown=true;\n"+
    "            void Promise.resolve().then(()=>trustedSessionNoticeHandler({\n"+
    "              scope:input.scope,duration_minutes:input.duration_minutes,\n"+
    "              max_actions:null})).catch(()=>{});\n"+
    "          }\n"+
    "          reply(res,200,{ok:true,data:{...session,\n"+
    "            ...(trusted?{approval_mode:'configured_trust',notice_seconds:20}:{}),\n"+
    "            audit_receipt:auditSaved?'saved':'unavailable'}});",
    'RECEIPT');
  updated=replaceOnce(updated,
    "  const restrictBrowserWrites = mutationPolicyFlag === 'true';",
    [
      "  const trustedSessionNoticeEnabled = environment.COMPUTER_USE_TRUSTED_SESSION_NOTICE === 'true';",
      "  if(trustedSessionNoticeEnabled && mutationPolicyFlag === 'false')",
      "    throw new Error('TRUSTED_NOTICE_ALLOWLIST_CONFLICT');",
      "  const restrictBrowserWrites = trustedSessionNoticeEnabled || mutationPolicyFlag === 'true';"
    ].join('\n'),
    'ALLOWLIST_BINDING');
  updated=replaceOnce(updated,
    "    bridgeToastEnabled: environment.COMPUTER_USE_BRIDGE_TOAST === 'true'",
    "    bridgeToastEnabled: environment.COMPUTER_USE_BRIDGE_TOAST === 'true',\n"+
    "    trustedSessionNoticeEnabled",
    'ENV_BINDING');
  updated=replaceOnce(updated,
    "          approval_modes:['per_action','delegated_session'],",
    "          approval_modes:['per_action','delegated_session'],\n"+
    "          trusted_delegation_notice:{\n"+
    "            enabled:trustedSessionNoticeEnabled,seconds:20,closable:true,\n"+
    "            max_minutes:30,max_actions:null,unlimited_actions:true,scope:'single_browser'\n"+
    "          },",
    'STATUS_METADATA');
  updated=replaceOnce(updated,
    "'STALE_TITLE','INVALID_SESSION_REQUEST','SESSION_ALREADY_ACTIVE',",
    "'STALE_TITLE','INVALID_SESSION_REQUEST','SESSION_ALREADY_ACTIVE',"+
    "\n        'TRUSTED_SESSION_LIMITS_EXCEEDED','AUDIT_UNAVAILABLE',",
    'ERROR_CLASSIFICATION');
  return {source:updated,applied:true,variant:base.variant};
}

export function upgradeTrustedNoticeEnvSource(contents,{enabled=false}={}) {
  const env=upgradeToastEnvSource(contents);
  if(!enabled)return env;
  const eol=env.includes('\r\n')?'\r\n':'\n';
  const lines=env.split(/\r?\n/);
  const changes={
    COMPUTER_USE_TRUSTED_SESSION_NOTICE:'true',
    COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY:'true'
  };
  for(const [name,value] of Object.entries(changes)){
    const indices=lines.flatMap((l,i)=>l.startsWith(name+'=')?[i]:[]);
    if(indices.length>1)throw Error('DUPLICATE_TRUSTED_NOTICE_KEY_'+name);
    if(indices.length)lines[indices[0]]=name+'='+value;
    else lines.push(name+'='+value);
  }
  return lines.join(eol);
}
