import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundBrowserTabs} from './background-browser-tabs.mjs';
function fixture({duplicate=false}={}) {
 const calls=[];const nodes=[{role:'AXTextArea',name:'Type a message',enabled:true,node_ref:'a'.repeat(64),fill_backend:'process_unicode'}];if(duplicate)nodes.push({...nodes[0]});
 const request=async(route,body)=>{calls.push([route,body]);if(route==='windows')return {windows:['Teams - Microsoft Edge']};if(route==='snapshot')return {revision:'b'.repeat(64),nodes,frontmost_unchanged:true};return {dispatched:true,frontmost_unchanged:true};};
 const adapter=new BackgroundBrowserTabs(request);
 const discovered={browser:'edge',provider:'native',tabs:[{title:'Teams',native_target:{browser:'edge',window_index:1,tab_index:1,expected_title:'Teams',expected_url:'https://teams.example.test/'}}]};
 return {adapter,calls,discovered};
}
async function prepare(f) {const d=await f.adapter.augment(f.discovered);const tab_ref=d.tabs[0].background_ax.tab_ref;const s=await f.adapter.inspect({browser:'edge',tab_ref});return {tab_ref,s};}
test('native AX is an explicit optional reference, never mislabeled DOM or CDP',async()=>{
 const f=fixture();const {tab_ref,s}=await prepare(f);assert.match(tab_ref,/^tab_[a-f0-9]{32}$/);assert.equal(s.semantic_available,false);assert.equal(s.ax_semantic_available,true);assert.equal(s.inspection_mode,'native_ax');assert.equal(s.frontmost_unchanged,true);
});
test('certified composer fills select process backend from observed snapshot',async()=>{
 const f=fixture();const {tab_ref,s}=await prepare(f);
 await f.adapter.perform({browser:'edge',tab_ref,expected_revision:s.revision,session_id:'own',request_id:'unique-request-id-001',action:'fill',value:'test',locator:{by:'role',role:'textbox',name:'Type a message'}});
 assert.equal(f.calls.at(-1)[1].text_method,'process_unicode');assert.equal(f.calls.at(-1)[1].value,'test');
});
test('duplicate labels and stale revisions never reach a mutation',async()=>{
 const f=fixture({duplicate:true});const {tab_ref,s}=await prepare(f);
 const a={browser:'edge',tab_ref,expected_revision:s.revision,session_id:'own',request_id:'unique-request-id-001',action:'fill',value:'test',locator:{by:'label',name:'Type a message'}};
 await assert.rejects(f.adapter.perform(a),/CONTROL_NOT_UNIQUE/);await assert.rejects(f.adapter.perform({...a,expected_revision:1}),/REVISION_STALE/);assert(!f.calls.some(c=>c[0]==='action'));
});
test('request replay stays blocked across freshly discovered references in same grant',async()=>{
 const f=fixture();let p=await prepare(f);const a={browser:'edge',expected_revision:p.s.revision,session_id:'own',request_id:'unique-request-id-001',action:'fill',value:'test',locator:{by:'label',name:'Type a message'}};
 await f.adapter.perform({...a,tab_ref:p.tab_ref});p=await prepare(f);await assert.rejects(f.adapter.perform({...a,tab_ref:p.tab_ref,expected_revision:p.s.revision}),/REPLAY_BLOCKED/);
});
test('keys and test IDs cannot trigger an implicit global input fallback',async()=>{
 const f=fixture();const p=await prepare(f);await assert.rejects(f.adapter.perform({browser:'edge',tab_ref:p.tab_ref,expected_revision:p.s.revision,action:'press',key:'Enter',locator:{by:'label',name:'Type a message'}}),/ACTION_UNSUPPORTED/);assert(!f.calls.some(c=>c[0]==='action'));
});
