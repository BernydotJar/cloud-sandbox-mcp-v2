(()=>{
'use strict';
if(location.origin!=='https://teams.cloud.microsoft'||globalThis.__sandboxTeamsEditorMain)return;globalThis.__sandboxTeamsEditorMain=true;
const label=el=>el.getAttribute('aria-label')||el.getAttribute('data-placeholder')||'';
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const observe=async el=>{const value=el.innerText;return value.trim()?{kind:'text_digest',length:value.length,sha256:await sha(value),has_value:true}:{kind:'empty',has_value:false};};
const fail=code=>{throw Error(code);};
window.addEventListener('message',async event=>{
 const m=event.data;if(event.source!==window||event.origin!==location.origin||m?.kind!=='sandbox-teams-editor-request'||m.version!==1||!/^[a-f0-9-]{36}$/.test(m.id||''))return;
 try{
  if(m.operation!=='fill')fail('DOM_EDITOR_OPERATION_DENIED');
  const candidates=[...document.querySelectorAll('[contenteditable=true][role=textbox]')].filter(el=>label(el)===m.name&&el.getClientRects().length>0);
  if(candidates.length!==1)fail('DOM_EDITOR_NOT_UNIQUE');const el=candidates[0],editor=el.ckeditorInstance;
   if(typeof m.node_ref!=='string'||!/^node_[a-f0-9-]{36}$/.test(m.node_ref)||el.getAttribute('data-lch-dom-ref')!==m.node_ref||!el.isConnected||el.getAttribute('aria-disabled')==='true'||el.closest('[data-private]')||/password|passcode|one.time|otp|credit.card|cvv|verification.code|secret/i.test(m.name))fail('DOM_EDITOR_CONTROL_CHANGED');
   const observedText=el.innerText,observedHref=location.href;
   if(typeof m.value!=='string'||m.value.length>2000||typeof m.url_digest!=='string'||await sha(location.href)!==m.url_digest||JSON.stringify(await observe(el))!==JSON.stringify(m.expected_value))fail('DOM_EDITOR_CONTEXT_CHANGED');
   if(!editor||typeof editor.setData!=='function'||typeof editor.getData!=='function'||editor.editing?.view?.getDomRoot?.()!==el||editor.isReadOnly===true)fail('DOM_EDITOR_API_UNAVAILABLE');
   if(m.value&&el.innerText.trim())fail('DOM_NONEMPTY_REPLACE_DENIED');
   if(!el.isConnected||el.innerText!==observedText||location.href!==observedHref||document.title.replace(/^\(\d+\)\s*/,'').slice(0,300)!==m.expected_title)fail('DOM_EDITOR_CONTEXT_CHANGED');
   const beforeModel=editor.getData();
   if(m.expected_value.kind==='empty'&&!/^(?:<p>(?:&nbsp;|<br\s*\/?>|\s)*<\/p>|\s)*$/i.test(beforeModel))fail('DOM_EDITOR_MODEL_NOT_EMPTY');
   const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
   editor.setData(m.value?'<p>'+escape(m.value).replace(/\r?\n/g,'<br>')+'</p>':'');
   const data={backend:'ckeditor5_set_data',dispatched:true,model_changed:editor.getData()!==beforeModel,requires_readback:true,os_keyboard_events:0,os_pointer_events:0};
  window.postMessage({kind:'sandbox-teams-editor-response',id:m.id,ok:true,data},location.origin);
 }catch(e){window.postMessage({kind:'sandbox-teams-editor-response',id:m.id,ok:false,error:/^DOM_[A-Z_]+$/.test(e.message)?e.message:'DOM_EDITOR_UNAVAILABLE'},location.origin);}
});
})();
