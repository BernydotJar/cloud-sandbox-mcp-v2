(()=>{
 'use strict';
 const origin='https://teams.cloud.microsoft';
 if(location.origin!==origin||globalThis.__sandboxTeamsDOM)return;
 globalThis.__sandboxTeamsDOM=true;
 const docId=crypto.randomUUID(),snapshots=new Map(),nodeIds=new WeakMap();
 const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const fail=code=>{throw Error(code);};
 const mainEditor=(el,operation,input)=>new Promise(resolve=>{
  const id=crypto.randomUUID();let timer;const listener=event=>{if(event.source===window&&event.origin===location.origin&&event.data?.kind==='sandbox-teams-editor-response'&&event.data.id===id){globalThis.clearTimeout(timer);window.removeEventListener('message',listener);resolve(event.data.ok?event.data.data:{error:event.data.error});}};
  window.addEventListener('message',listener);timer=globalThis.setTimeout(()=>{window.removeEventListener('message',listener);resolve({error:'DOM_EDITOR_TIMEOUT_INSPECT'});},2500);
  window.postMessage({kind:'sandbox-teams-editor-request',version:1,id,operation,name:name(el),...input},location.origin);
 });

 const visible=el=>el.isConnected&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
 const name=el=>String(el.getAttribute('aria-label')||String(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||el.labels?.[0]?.textContent||el.getAttribute('placeholder')||el.getAttribute('data-placeholder')||el.getAttribute('title')||((el.matches('input,textarea')||el.isContentEditable||el.getAttribute('role')==='textbox')?'':el.textContent)||'').replace(/\s+/g,' ').trim().slice(0,200);
 const protectedField=el=>el.matches('input[type=password],input[type=file],input[type=hidden],[data-private]')||!!el.closest('[data-private]')||/password|passcode|one.time|\botp\b|credit.card|\bcvv\b|verification.code|access.token|secret/i.test([el.autocomplete,el.getAttribute('type'),el.getAttribute('aria-label'),el.getAttribute('name')].join(' '));
 function role(el){
  const declared=el.getAttribute('role');if(declared)return declared;
  if(el.matches('button,input[type=button],input[type=submit]'))return 'button';
  if(el.matches('a[href]'))return 'link';
  if(el.matches('textarea,input:not([type]),input[type=text],input[type=search],input[type=email],input[type=number]')||el.isContentEditable)return 'textbox';
  if(el.matches('select'))return 'combobox';
  if(el.matches('input[type=checkbox]'))return 'checkbox';
  if(el.matches('input[type=radio]'))return 'radio';return '';
 }
 function elements(){return [...new Set(document.querySelectorAll('button,a[href],input,textarea,select,[role],[contenteditable="true"],[contenteditable="plaintext-only"]'))].filter(el=>visible(el)&&!protectedField(el)&&['button','link','textbox','combobox','checkbox','radio','tab','menuitem','switch','treeitem'].includes(role(el))).slice(0,500);}
 const enabled=el=>!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.readOnly;
 const value=el=>el.isContentEditable?el.innerText:String(el.value??'');
 async function observeValue(el){const s=value(el);return s.trim()?{kind:'text_digest',length:s.length,sha256:await sha(s),has_value:true}:{kind:'empty',has_value:false};}
 const context=async()=>({doc_id:docId,url:location.origin+location.pathname,url_digest:await sha(location.href),title:document.title.replace(/^\(\d+\)\s*/,'').slice(0,300)});
 function publicText(){
  const root=document.querySelector('main,[role=main]')||document.body;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){const el=node.parentElement;return el&&visible(el)&&!el.closest('script,style,input,textarea,[contenteditable],[data-private]')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
  let text='';while(walker.nextNode()&&text.length<12000){const t=walker.currentNode.textContent.trim();if(t)text+=t+'\n';}return text.slice(0,12000);
 }
 async function inspect(){
  const current=await context(),refs=new Map(),controls=[];
  for(const el of elements()){
   let ref=nodeIds.get(el);if(!ref){ref='node_'+crypto.randomUUID();nodeIds.set(el,ref);}
   const r=role(el),n=name(el),record={node_ref:ref,role:r,name:n,enabled:enabled(el)};
   if(['textbox','combobox'].includes(r))record.value_observation=await observeValue(el);
   if(r==='textbox'&&el.isContentEditable)record.fill_backend=(el.getAttribute('data-tid')==='ckeditor'||el.classList.contains('ck-editor__editable'))?'ckeditor5_model':'browser_edit_command';
   if(el.matches('input[type=checkbox],input[type=radio]')||el.hasAttribute('aria-checked')||el.hasAttribute('aria-selected'))record.selected=el.checked===true||el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-selected')==='true';
   controls.push(record);refs.set(ref,{el,record});
  }
  const revision='snap_'+crypto.randomUUID();snapshots.set(revision,{current,refs,expires:Date.now()+30000});
  for(const [key,s] of snapshots)if(s.expires<Date.now()||snapshots.size>8)snapshots.delete(key);
  return {...current,revision,controls,text:publicText(),inspection_mode:'dom',semantic_available:true};
 }
 async function action(input){
  const snap=snapshots.get(input.snapshot_revision);if(!snap||snap.expires<Date.now())fail('DOM_SNAPSHOT_STALE');
  const current=await context();if(JSON.stringify(current)!==JSON.stringify(snap.current))fail('DOM_CONTEXT_CHANGED');
  const locator=input.locator;if(!locator||!['role','label','test_id'].includes(locator.by)||typeof locator.name!=='string'||locator.name.length>200)fail('DOM_LOCATOR_INVALID');
  const matches=elements().filter(el=>locator.by==='test_id'?[el.getAttribute('data-testid'),el.getAttribute('data-tid')].includes(locator.name):name(el)===locator.name&&(locator.by!=='role'||role(el)===locator.role));
  if(matches.length!==1)fail('DOM_CONTROL_NOT_UNIQUE');const el=matches[0],ref=nodeIds.get(el),prior=snap.refs.get(ref);
  if(!prior||!enabled(el)||protectedField(el))fail('DOM_CONTROL_CHANGED');
  if(['textbox','combobox'].includes(role(el))&&JSON.stringify(await observeValue(el))!==JSON.stringify(prior.record.value_observation))fail('DOM_VALUE_CHANGED');
  snapshots.delete(input.snapshot_revision);
  if(input.action==='fill'){
   if(typeof input.value!=='string'||input.value.length>2000||role(el)!=='textbox')fail('DOM_FILL_INVALID');
   if(el.isContentEditable){
    const before=value(el);if(before.trim()&&input.value)fail('DOM_NONEMPTY_REPLACE_DENIED');
    if(el.getAttribute('data-tid')==='ckeditor'||el.classList.contains('ck-editor__editable')){
     el.setAttribute('data-lch-dom-ref',ref);
     const response=await mainEditor(el,'fill',{node_ref:ref,value:input.value,url_digest:current.url_digest,expected_title:current.title,expected_value:prior.record.value_observation});
     if(response.error)fail(response.error);if(response.backend!=='ckeditor5_set_data'||response.dispatched!==true)fail('DOM_EDITOR_RESPONSE_INVALID');
    }else{
    el.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(el);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
    const ok=document.execCommand(input.value?'insertText':'delete',false,input.value);
    if(!ok)fail('DOM_EDIT_UNAVAILABLE_INSPECT');
    }
   }else{
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)fail('DOM_FILL_UNSUPPORTED');setter.call(el,input.value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
   }
  }else if(input.action==='click'){el.click();}
  else if(input.action==='select'){
   if(!el.matches('select')||typeof input.value!=='string'||![...el.options].some(o=>o.value===input.value))fail('DOM_SELECT_INVALID');el.value=input.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }else fail('DOM_ACTION_UNSUPPORTED');
  return {dispatched:true,requires_readback:true,os_keyboard_events:0,os_pointer_events:0,tab_activation_requested:false};
 }
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||message?.kind!=='sandbox-dom-request')return false;
  const run=async()=>{if(location.origin!==origin)fail('DOM_ORIGIN_DENIED');if(message.operation==='inspect')return inspect();if(message.operation==='action')return action(message.input||{});fail('DOM_OPERATION_DENIED');};
  run().then(data=>reply({ok:true,data}),error=>reply({ok:false,error:/^DOM_[A-Z_]{3,45}$/.test(error?.message||'')?error.message:'DOM_ACTION_FAILED_INSPECT'}));return true;
 });
 chrome.runtime.sendMessage({kind:'teams-ready'}).catch(()=>{});
})();
