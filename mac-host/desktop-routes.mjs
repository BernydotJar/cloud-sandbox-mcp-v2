import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAllowedBundles,requireAllowedBundle,validateDesktopTarget,
  validateMutation,requireDesktopSession,createDesktopRequestGate,desktopAudit} from './desktop-policy.mjs';

const exec=promisify(execFile);
const nativeScript=path.join(path.dirname(fileURLToPath(import.meta.url)),'desktop-native.jxa');
export const desktopPaths=new Set(['/v3/mac/windows','/v3/mac/inspect','/v3/mac/focus',
  '/v3/mac/action','/v3/mac/open']);
export async function desktopNative(operation,...args) {
  const {stdout}=await exec('/usr/bin/osascript',['-l','JavaScript',nativeScript,operation,...args],
    {timeout:12000,maxBuffer:200000});
  const result=JSON.parse(stdout.trim());
  if(result.ok!==true)throw new Error(result.error || 'MAC_ACCESSIBILITY_UNAVAILABLE');
  return result.data;
}
const gate=createDesktopRequestGate();
const permitted=new Set(['MAC_APP_NOT_ALLOWED','INVALID_MAC_TARGET','INVALID_MAC_ACTION',
  'INVALID_MAC_ELEMENT','INVALID_MAC_TEXT','INVALID_MAC_KEY','INVALID_MAC_SCROLL',
  'INVALID_MAC_REQUEST','SESSION_NOT_ACTIVE','SESSION_SCOPE_MISMATCH',
  'MAC_REQUEST_ALREADY_DISPATCHED','MAC_REQUEST_GATE_FULL','STALE_MAC_PROCESS',
  'STALE_MAC_WINDOW','STALE_MAC_TITLE','STALE_MAC_ELEMENT','MAC_PROTECTED_FIELD',
  'MAC_AUTOMATION_PERMISSION_DENIED','MAC_ACCESSIBILITY_UNAVAILABLE','MAC_SCROLL_UNSUPPORTED']);
export function desktopError(e) {return permitted.has(e?.message)?e.message:'MAC_DESKTOP_UNAVAILABLE';}
export function createDesktopRoutes({allowedBundles,sessionStore,auditHandler,
  nativeHandler=desktopNative,launchHandler=async bundle=>{
    await exec('/usr/bin/open',['-b',bundle],{timeout:12000,maxBuffer:1000});
  }}){
  const bundles=allowedBundles instanceof Set?allowedBundles:parseAllowedBundles(allowedBundles);
  if(!bundles.size)throw new Error('INVALID_MAC_ALLOWLIST');
  return async function route(url,input) {
    if(url==='/v3/mac/windows') {
      requireAllowedBundle(input.bundle_id,bundles);
      return {applications:await nativeHandler('windows',input.bundle_id)};
    }
    if(url==='/v3/mac/inspect') {
      const target=validateDesktopTarget(input,bundles);
      return await nativeHandler('inspect',...target);
    }
    if(url==='/v3/mac/focus') {
      const target=validateDesktopTarget(input,bundles);
      requireDesktopSession(input);
      sessionStore.authorize(input.session_id,'desktop');
      await auditHandler({category:'mac_desktop',action:'focus',outcome:'intent'});
      sessionStore.authorize(input.session_id,'desktop',{consume:true});
      return await nativeHandler('focus',...target);
    }
    if(url!=='/v3/mac/action'&&url!=='/v3/mac/open')throw new Error('INVALID_MAC_REQUEST');
    const type=url==='/v3/mac/open'?'open':input.action;
    const args=validateMutation({...input,action:url==='/v3/mac/open'?undefined:input.action},bundles);
    sessionStore.authorize(input.session_id,'desktop');
    // Content-free intent audit must succeed before an operating-system mutation.
    await auditHandler(desktopAudit({...input,action:type},'intent'));
    gate.claim(input.request_id);
    sessionStore.authorize(input.session_id,'desktop',{consume:true});
    let result;
    try {
      result=url==='/v3/mac/open'?
        (await launchHandler(input.bundle_id),{launched:true,bundle_id:input.bundle_id}):
        await nativeHandler('action',...args);
    }catch(e){
      try{await auditHandler(desktopAudit({...input,action:type},'uncertain'));}catch{ /* Audit failure after dispatch cannot trigger retry. */ }
      throw e;
    }
    try{await auditHandler(desktopAudit({...input,action:type},'performed'));}catch{ /* Audit failure after dispatch cannot trigger retry. */ }
    return result;
  };
}
