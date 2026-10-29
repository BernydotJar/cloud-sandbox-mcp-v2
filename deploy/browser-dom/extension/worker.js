'use strict';
const origin='https://teams.cloud.microsoft';let port=null,connecting=false;
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const safe=url=>{const u=new URL(url);if(u.origin!==origin||u.username||u.password)throw Error('DOM_ORIGIN_DENIED');u.search='';u.hash='';return u.href;};
async function dispatch(operation,input={}){
 if(operation==='tabs'){
  const tabs=await chrome.tabs.query({url:origin+'/*'});return {tabs:await Promise.all(tabs.map(async t=>({id:t.id,title:String(t.title||'').slice(0,300),url:safe(t.url),url_digest:await sha(t.url),active:t.active===true}))) };
 }
 if(!Number.isInteger(input.tab_id))throw Error('DOM_TAB_INVALID');const tab=await chrome.tabs.get(input.tab_id);const url=safe(tab.url);
 if(input.url&&url!==input.url)throw Error('DOM_TAB_CHANGED');
 if(operation==='reload'){await chrome.tabs.reload(tab.id);return {dispatched:true,requires_readback:true,tab_activation_requested:false};}
 if(!['inspect','action'].includes(operation))throw Error('DOM_OPERATION_DENIED');
 const reply=await chrome.tabs.sendMessage(tab.id,{kind:'sandbox-dom-request',operation,input},{frameId:0});
 if(reply?.ok!==true)throw Error(/^DOM_[A-Z_]{3,45}$/.test(reply?.error||'')?reply.error:'DOM_CONTENT_UNAVAILABLE');return reply.data;
}
async function connect(){
 if(port||connecting)return;connecting=true;
 let profile=(await chrome.storage.local.get('sandbox_profile_instance')).sandbox_profile_instance;
 if(!profile){profile=crypto.randomUUID();await chrome.storage.local.set({sandbox_profile_instance:profile});}
 try{port=chrome.runtime.connectNative('com.lch.sandbox_v3_dom');}catch{connecting=false;return;}
 connecting=false;const current=port;
 current.onMessage.addListener(message=>{
  if(message?.kind!=='request'||typeof message.id!=='string')return;
  dispatch(message.operation,message.input).then(data=>current.postMessage({kind:'reply',id:message.id,ok:true,data}),e=>current.postMessage({kind:'reply',id:message.id,ok:false,error:/^DOM_[A-Z_]{3,45}$/.test(e?.message||'')?e.message:'DOM_REQUEST_FAILED_INSPECT'}));
 });
 current.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(port===current)port=null;});
 current.postMessage({kind:'extension_hello',extension_id:chrome.runtime.id,protocol:1,scope:origin,profile_instance:profile,incognito:chrome.extension.inIncognitoContext===true});
}
chrome.runtime.onStartup.addListener(connect);chrome.runtime.onInstalled.addListener(connect);chrome.action.onClicked.addListener(connect);
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m?.kind==='teams-ready'&&s.id===chrome.runtime.id&&s.tab?.url?.startsWith(origin+'/')){connect();reply({ok:true});}});
connect();
