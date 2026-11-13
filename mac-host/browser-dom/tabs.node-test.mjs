import {test} from 'node:test';import assert from 'node:assert/strict';import {DOMBrowserTabs} from './tabs.mjs';
const url='https://teams.cloud.microsoft/',digest='a'.repeat(64);
function fixture({denySession=false,denyOrigin=false,uncertain=false,changeGeneration=false}={}){
 const calls=[],audit=[],sessions=[];
 const broker={generation:1,ready:true,status:()=>({enabled:true,connected:true}),request:async(op)=>{
  calls.push(op);if(op==='tabs')return {tabs:[{id:1,url,title:'Own chat',url_digest:digest}]};
  if(op==='inspect')return {doc_id:'fixture',url,url_digest:digest,title:'Own chat',revision:'snap_'+'a'.repeat(36),controls:[{node_ref:'node_1',role:'textbox',name:'Type a message',enabled:true,value_observation:{kind:'empty',has_value:false}}],text:'Own chat'};
  if(uncertain)throw Error('DOM_TIMEOUT_INSPECT');return {dispatched:true,requires_readback:true};
 }};
 const adapter=new DOMBrowserTabs({broker,allowedOrigins:new Set([denyOrigin?'https://other.test':new URL(url).origin]),dynamicTabs:true,sessionStore:{authorize:(id,b,o)=>{if(denySession||id!=='own')throw Error('SESSION_NOT_ACTIVE');sessions.push(Boolean(o?.consume));}},audit:async e=>{audit.push(e);if(changeGeneration)broker.generation++;}});
 return {broker,adapter,calls,audit,sessions};
}
async function ready(f){const d=await f.adapter.discover({browser:'edge'});const tab_ref=d.tabs[0].tab_ref;const s=await f.adapter.inspect({browser:'edge',tab_ref});return {browser:'edge',tab_ref,session_id:'own',expected_revision:s.revision,request_id:'unique-dom-action-0001',action:'fill',locator:{by:'role',role:'textbox',name:'Type a message'},value:'approved fixture'};}
test('same request returns its prior receipt; changed tab/value conflicts and never redispatches',async()=>{const f=fixture(),r=await ready(f);const first=await f.adapter.perform(r);assert.deepEqual(await f.adapter.perform(r),first);await assert.rejects(f.adapter.perform({...r,value:'changed'}),/REQUEST_CONFLICT/);assert.equal(f.calls.filter(x=>x==='action').length,1);assert.equal(f.sessions.filter(Boolean).length,1);assert(!JSON.stringify(f.audit).includes(r.value));});
test('foreign grants and nonallowlisted origins cannot send any browser action',async()=>{for(const opts of [{denySession:true},{denyOrigin:true}]){const f=fixture(opts),r=await ready(f);await assert.rejects(f.adapter.perform(r),/SESSION_NOT_ACTIVE|MUTATION_ORIGIN_DENIED/);assert(!f.calls.includes('action'));assert(!f.sessions.includes(true));}});
test('uncertain delivery cannot be retried by replaying the same request',async()=>{const f=fixture({uncertain:true}),r=await ready(f);await assert.rejects(f.adapter.perform(r),/UNCERTAIN/);await assert.rejects(f.adapter.perform(r),/UNCERTAIN/);assert.equal(f.calls.filter(x=>x==='action').length,1);});
test('connection generation changes before dispatch invalidate the stored reference',async()=>{const f=fixture({changeGeneration:true}),r=await ready(f);await assert.rejects(f.adapter.perform(r),/CONNECTION_CHANGED/);assert(!f.calls.includes('action'));assert(!f.sessions.includes(true));});
test('no invented native indices or fallback are necessary for the DOM reference',async()=>{const f=fixture(),r=await ready(f);assert(!('window_index' in r));f.broker.generation++;await assert.rejects(f.adapter.inspect(r),/TAB_STALE/);});
