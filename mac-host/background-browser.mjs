import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const apps={edge:'com.microsoft.edgemac',chrome:'com.google.Chrome'};
const routes=new Set(['status','windows','snapshot','action']);
export async function requestLocalBackgroundAX(route,body) {
 if(!routes.has(route))throw Error('BACKGROUND_ROUTE_DENIED');
 const home=path.join(os.homedir(),'Library/Application Support/LCH/SameMacBackgroundAX');
 const file=path.join(home,'token'),stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('BACKGROUND_CREDENTIAL_UNTRUSTED');
 const token=(await fs.readFile(file,'utf8')).trim();
 const response=await fetch('http://127.0.0.1:9779/v1/'+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
 const result=await response.json();
 if(!response.ok||result.ok!==true)throw Error(/^SAME_MAC_[A-Z_]{3,100}$/.test(result.error)?result.error:'BACKGROUND_AX_UNAVAILABLE');
 return result.data;
}
export async function backgroundBrowserRequest(route,input,{validate,inspect,sessionStore,audit,request=requestLocalBackgroundAX}) {
 if(!routes.has(route))throw Error('BACKGROUND_ROUTE_DENIED');
 if(route==='status')return request('status',{});
 if(!Object.hasOwn(apps,input.browser))throw Error('INVALID_BROWSER');
 const bundle_id=apps[input.browser];
 if(route==='windows')return request('windows',{bundle_id});
 const mutate=route==='action';
 const args=validate(input,mutate);
 if(typeof input.window_title!=='string'||input.window_title.length>120||
    !(input.window_title===input.expected_title||input.window_title.startsWith(input.expected_title+' - ')))throw Error('BACKGROUND_WINDOW_IDENTITY_REQUIRED');
 if(mutate) {
  if(typeof input.session_id!=='string')throw Error('BACKGROUND_TASK_SESSION_REQUIRED');
  sessionStore.authorize(input.session_id,input.browser);
  if(!['press','set_value'].includes(input.action)||!['node_ref','expected_revision','request_id'].every(k=>/^[a-f0-9]{64}$/.test(input[k]||''))||
    typeof input.reason!=='string'||input.reason.length<10||input.reason.length>300||
    (input.action==='set_value'&&(typeof input.value!=='string'||input.value.length>2000))||
    (input.focus_element!==undefined&&typeof input.focus_element!=='boolean'))throw Error('BACKGROUND_ACTION_INVALID');
 }
 await inspect(...args);
 const target={bundle_id,window_title:input.window_title};
 if(!mutate)return request('snapshot',target);
 const event={action:'background_'+input.action,browser:input.browser,origin:new URL(input.expected_url).origin};
 await audit({...event,outcome:'session_authorized'});
 await inspect(...args);
 sessionStore.authorize(input.session_id,input.browser,{consume:true});
 try {
  const result=await request('action',{...target,action:input.action,node_ref:input.node_ref,expected_revision:input.expected_revision,request_id:input.request_id,...(input.action==='set_value'?{value:input.value,focus_element:input.focus_element===true,...(['selected_text','process_unicode'].includes(input.text_method)?{text_method:input.text_method}:{})}:{})});
  try {await audit({...event,outcome:'dispatched'});}catch {/* Never replay a completed dispatch. */}
  return result;
 }catch(error){try{await audit({...event,outcome:'uncertain'});}catch{/* Preserve the original uncertain outcome. */}throw error;}
}
