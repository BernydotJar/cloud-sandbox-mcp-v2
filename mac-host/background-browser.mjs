import {allowsWebOrigin} from './allowed-origins.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const apps={edge:'com.microsoft.edgemac',chrome:'com.google.Chrome'};
const routes=new Set(['status','windows','discover','snapshot','action']);
const localRoutes=new Set([...routes,'identity']);
export function verifyBackgroundTarget(t,origins,dynamicTabs,mutate=false){
 let url;try{url=new URL(t.expected_url);}catch{throw Error('INVALID_TARGET');}
 if(!Object.hasOwn(apps,t.browser)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||
   url.href!==t.expected_url||typeof t.expected_title!=='string'||!t.expected_title.length||t.expected_title.length>300||
   (!dynamicTabs&&!allowsWebOrigin(t.expected_url,origins)))throw Error('INVALID_TARGET');
 if(mutate&&!allowsWebOrigin(t.expected_url,origins))throw Error('MUTATION_ORIGIN_DENIED');
}
export function backgroundErrorCode(code){
 if(code==='SAME_MAC_NATIVE_TARGET_IS_FRONTMOST_USE_FOREGROUND_MODE')return 'BACKGROUND_TARGET_FRONTMOST';
 if(/^SAME_MAC_[A-Z_]{3,100}$/.test(code||''))return code;
 return 'BACKGROUND_AX_UNAVAILABLE';
}
export async function requestLocalBackgroundAX(route,body) {
 if(!localRoutes.has(route))throw Error('BACKGROUND_ROUTE_DENIED');
 const home=path.join(os.homedir(),'Library/Application Support/LCH/SameMacBackgroundAX');
 const file=path.join(home,'token'),stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('BACKGROUND_CREDENTIAL_UNTRUSTED');
 const token=(await fs.readFile(file,'utf8')).trim();
 const response=await fetch('http://127.0.0.1:9779/v1/'+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
 const result=await response.json();
 if(!response.ok||result.ok!==true)throw Error(backgroundErrorCode(result.error));
 return result.data;
}
export async function backgroundBrowserRequest(route,input,{validate,sessionStore,audit,request=requestLocalBackgroundAX}) {
 if(!routes.has(route))throw Error('BACKGROUND_ROUTE_DENIED');
 if(route==='status')return request('status',{});
 if(!Object.hasOwn(apps,input.browser))throw Error('INVALID_BROWSER');
 const bundle_id=apps[input.browser];
 if(route==='windows')return request('windows',{bundle_id});
 if(route==='discover'){
  const observed=await request('windows',{bundle_id});const tabs=[];
  for(const window_title of observed.windows){
   if(!window_title||window_title.length>120||observed.windows.filter(w=>w===window_title).length!==1)continue;
   if(input.title && !(input.exact===false?window_title.toLocaleLowerCase().includes(input.title.toLocaleLowerCase()):window_title===input.title||window_title.startsWith(input.title+' - ')))continue;
   try{
    const identity=await request('identity',{bundle_id,window_title});
    const title=identity.document_title||window_title;
    if(input.title && (input.exact===false?!title.toLocaleLowerCase().includes(input.title.toLocaleLowerCase()):title!==input.title))continue;
    validate({browser:input.browser,expected_title:title,expected_url:identity.browser_url},false);
    tabs.push({title,url:identity.browser_url,window_title});
   }catch{/* Inaccessible/nonweb windows are omitted; no synthetic identity or focus fallback. */}
  }
  return {tabs,frontmost_unchanged:observed.frontmost_unchanged};
 }

 const mutate=route==='action';
 validate(input,mutate);
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
 const target={bundle_id,window_title:input.window_title};
 const verifyIdentity=async()=>{
  const observed=await request('identity',target);
  if(observed.browser_url!==input.expected_url || observed.window_title!==input.window_title || observed.frontmost_unchanged!==true)
   throw Error('BACKGROUND_BROWSER_IDENTITY_CHANGED');
 };
 await verifyIdentity();
 if(!mutate)return request('snapshot',target);
 const event={action:'background_'+input.action,browser:input.browser,origin:new URL(input.expected_url).origin};
 await audit({...event,outcome:'session_authorized'});
 await verifyIdentity();
 sessionStore.authorize(input.session_id,input.browser,{consume:true});
 try {
  const result=await request('action',{...target,action:input.action,node_ref:input.node_ref,expected_revision:input.expected_revision,request_id:input.request_id,...(input.action==='set_value'?{value:input.value,focus_element:input.focus_element===true,...(['selected_text','process_unicode'].includes(input.text_method)?{text_method:input.text_method}:{})}:{})});
  try {await audit({...event,outcome:'dispatched'});}catch {/* Never replay a completed dispatch. */}
  return result;
 }catch(error){try{await audit({...event,outcome:'uncertain'});}catch{/* Preserve the original uncertain outcome. */}throw error;}
}
