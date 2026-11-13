import crypto from 'node:crypto';
const roles={button:['AXButton'],link:['AXLink'],textbox:['AXTextArea','AXTextField'],combobox:['AXComboBox'],checkbox:['AXCheckBox'],radio:['AXRadioButton'],tab:['AXRadioButton'],menuitem:['AXMenuItem'],switch:['AXCheckBox']};
export class BackgroundBrowserTabs {
 constructor(request){this.request=request;this.tabs=new Map();this.used=new Set();}
 has(ref){return this.tabs.has(ref);}
 async discover(input){
  const data=await this.request('discover',input);
  const tabs=data.tabs.map(row=>{
   const ref='tab_'+crypto.randomBytes(16).toString('hex');
   this.tabs.set(ref,{target:{browser:input.browser,expected_title:row.title,expected_url:row.url,window_title:row.window_title},revision:1,expires:Date.now()+300000,last:null});
   return {title:row.title,url:row.url,active:true,background_ax:{tab_ref:ref,revision:1,provider:'same_mac_background_ax',inspection_mode:'native_ax',background_only:true}};
  });
  return {browser:input.browser,provider:'native',discovery_backend:'same_mac_background_ax',semantic_available:false,running:true,launch_available:false,tabs,background_ax_available:tabs.length>0,
   next_step:'Use background_ax.tab_ref with browser_inspect/browser_action. AX discovery has no native window/tab indices; foreground actions are unavailable on this target.'};
 }
 async augment(result) {
  if(result.provider!=='native'||result.discovery_backend==='same_mac_background_ax'||!Array.isArray(result.tabs))return result;
  let windows;
  try {windows=(await this.request('windows',{browser:result.browser})).windows;}
  catch(error){return {...result,background_ax_available:false,
   background_ax_error:/^SAME_MAC_[A-Z_]{3,80}$/.test(error?.message||'')?error.message:'BACKGROUND_AX_UNAVAILABLE',
   background_ax_notice:'Background AX unavailable. This is not permission for foreground input. Repair actual AX readiness before background mutations.'};}
  const tabs=result.tabs.map(tab=>{
   const matching=windows.filter(w=>w===tab.title||w.startsWith(tab.title+' - '));
   if(matching.length!==1)return tab;
   const ref='tab_'+crypto.randomBytes(16).toString('hex');
   this.tabs.set(ref,{target:{...tab.native_target,window_title:matching[0]},revision:1,expires:Date.now()+300000,last:null});
   return {...tab,background_ax:{tab_ref:ref,revision:1,provider:'same_mac_background_ax',inspection_mode:'native_ax',background_only:true}};
  });
  for(const [k,v] of this.tabs)if(v.expires<Date.now())this.tabs.delete(k);
  return {...result,tabs,...(tabs.some(t=>t.background_ax)?{next_step:'For background work use browser_inspect with background_ax.tab_ref, then browser_action with exact AX labels. Do not call native focus/screenshot/action.'}:{}),background_ax_available:tabs.some(t=>t.background_ax),background_ax_notice:'Explicit optional native AX background references. No DOM/ARIA or persistent CDP claim. Use browser_inspect with background_ax.tab_ref; no native focus/screenshot/click fallback.'};
 }
 get(input) {const tab=this.tabs.get(input.tab_ref);if(!tab||tab.expires<Date.now()||tab.target.browser!==input.browser)throw Error('BACKGROUND_TAB_STALE');return tab;}
 async inspect(input) {
  const tab=this.get(input);
  // Memory suffixes can change without changing the selected application page.
  const windows=(await this.request('windows',{browser:input.browser})).windows;
  const matches=windows.filter(w=>w===tab.target.expected_title||w.startsWith(tab.target.expected_title+' - '));
  if(matches.length!==1)throw Error('BACKGROUND_WINDOW_CHANGED');
  tab.target.window_title=matches[0];
  const snapshot=await this.request('snapshot',tab.target);
  tab.last=snapshot;tab.revision++;tab.expires=Date.now()+300000;
  return {browser:input.browser,tab_ref:input.tab_ref,revision:tab.revision,provider:'same_mac_background_ax',inspection_mode:'native_ax',semantic_available:false,ax_semantic_available:true,background_only:true,frontmost_unchanged:snapshot.frontmost_unchanged,nodes:snapshot.nodes,notice:'AX labels and roles, not DOM/ARIA. Value fingerprints require independent readback. Use label locators or exact AX-role mappings.'};
 }
 async perform(input) {
  const tab=this.get(input);
  if(input.expected_revision!==tab.revision||!tab.last)throw Error('BACKGROUND_REVISION_STALE');
  if(!['click','fill'].includes(input.action)||!input.locator||!['label','role'].includes(input.locator.by))throw Error('BACKGROUND_ACTION_UNSUPPORTED');
  if(typeof input.request_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/.test(input.request_id))throw Error('BACKGROUND_REQUEST_ID_REQUIRED');
  const id=crypto.createHash('sha256').update(input.session_id+'|'+input.request_id).digest('hex');
  if(this.used.has(id))throw Error('BACKGROUND_REPLAY_BLOCKED');
  const found=tab.last.nodes.filter(n=>n.enabled&&n.name===input.locator.name&&(input.locator.by!=='role'||roles[input.locator.role]?.includes(n.role)));
  if(found.length!==1)throw Error('BACKGROUND_CONTROL_NOT_UNIQUE');
  const node=found[0];this.used.add(id);
  const result=await this.request('action',{...tab.target,action:input.action==='fill'?'set_value':'press',node_ref:node.node_ref,expected_revision:tab.last.revision,request_id:id,session_id:input.session_id,reason:'User-authorized background browser AX '+input.action,...(input.action==='fill'?{value:input.value,...(['process_unicode','selected_text'].includes(node.fill_backend)?{text_method:node.fill_backend}:{})}:{})});
  tab.last=null;tab.revision++;
  return {...result,provider:'same_mac_background_ax',revision:tab.revision,outcome:'dispatched',requires_readback:true};
 }
}
