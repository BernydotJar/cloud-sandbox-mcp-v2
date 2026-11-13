import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore,validateTaskScope} from './autonomy-session.mjs';
import {createBridgeServer} from './bridge.mjs';
import {BrowserRuntime} from './browser-runtime/runtime.mjs';
import {FakeConnection,FakePage} from './browser-runtime/test-fixtures.mjs';

const origin='https://luma.example';
const request={scope:'chrome',task_id:'authorized-task-123',origins:[origin],
  purpose:'Verify a user authorized task in an isolated fixture',duration_minutes:1,max_actions:3};
const token='fixture-bridge-token-only-abcdefghijklmnopqrstuvwxyz';
const target={browser:'chrome',window_index:1,tab_index:1,expected_url:origin+'/',
  expected_title:'LUMA',background_required:false,action:'press_key',key:'tab',reason:'Navigate a disposable fixture only'};

test('task origins are copied, exact and cannot expand from page instructions',()=>{
 const store=createSessionStore();
 const input={...request,origins:[origin]};
 const grant=store.begin(input);input.origins.push('https://evil.example');
 assert.equal(grant.task_ref.length,64);
 for(const value of ['https://evil.example','https://sub.luma.example','http://luma.example','https://luma.example.evil']){
  assert.throws(()=>store.authorize(grant.session_id,'chrome',{consume:true,origin:value}),/SESSION_ORIGIN_MISMATCH/);
 }
 assert.throws(()=>store.authorize(grant.session_id,'edge',{consume:true,origin}),/SESSION_SCOPE_MISMATCH/);
 assert.throws(()=>store.authorize(grant.session_id,'chrome',{consume:true}),/SESSION_ORIGIN_MISMATCH/);
 assert.equal(store.status().remaining_actions,3);
 assert.equal(store.authorize(grant.session_id,'chrome',{consume:true,origin}).remaining_actions,2);
 assert(!JSON.stringify(store.status()).includes(grant.session_id));
 assert(!JSON.stringify(store.status()).includes(request.task_id));
 store.end(grant.session_id);
 assert.throws(()=>store.authorize(grant.session_id,'chrome',{origin}),/SESSION_NOT_ACTIVE/);
});

test('wildcards, paths, credentials and incomplete task scopes fail before granting',()=>{
 for(const origins of [[],['https://*.example'],[origin+'/path'],[origin+'/?allow=all'],['http://luma.example'],['https://user:pass@luma.example'],[origin+':8443'],[origin,origin]]){
  assert.throws(()=>validateTaskScope({...request,origins},true),/INVALID_TASK_SCOPE/);
 }
 assert.throws(()=>validateTaskScope({},true),/INVALID_TASK_SCOPE/);
 assert.throws(()=>validateTaskScope({task_id:request.task_id}),/INVALID_TASK_SCOPE/);
});

test('one trusted grant serves native and CDP; no modal, no implicit task takeover; expiry and audit fail closed',async()=>{
 let time=1000,modals=0,nativeActions=0,failAudit=false;
 const store=createSessionStore({now:()=>time});
 const page=new FakePage(origin+'/'),connection=new FakeConnection([page]),events=[];
 const runtime=new BrowserRuntime({providers:{chrome:{endpoint:'http://127.0.0.1:9222'}},
  connect:async()=>connection,dynamicTabs:true,sessionStore:store,audit:async e=>events.push(e)});
 const server=createBridgeServer({token,platform:'darwin',allowedOrigins:new Set([origin,'https://other.example']),
  dynamicTabs:true,restrictBrowserWrites:true,trustedSessionNoticeEnabled:true,sessionStore:store,
  trustedSessionNoticeHandler:async()=>{},
  approvalHandler:async()=>{modals++;return true;},
  nativeHandler:async op=>{if(op==='action')nativeActions++;return {performed:true};},
  auditHandler:async e=>{if(failAudit)throw Error('fixture audit unavailable');events.push(e);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const post=async(route,input)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,
  {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)});return r.json();};
 try{
  assert.equal((await post('/v1/action',target)).error,'TASK_SESSION_REQUIRED');
  assert.equal((await post('/v1/session/begin',{...request,origins:undefined})).error,'INVALID_TASK_SCOPE');
  const grant=(await post('/v1/session/begin',request)).data;
  assert.equal((await post('/v1/session/begin',{...request,task_id:'other-task-123'})).error,'SESSION_ALREADY_ACTIVE');
  assert.equal((await post('/v1/action',{...target,session_id:grant.session_id})).ok,true);
  const tab=(await runtime.discover({browser:'chrome'})).tabs[0];
  const action={browser:'chrome',tab_ref:tab.tab_ref,expected_revision:tab.revision,
   session_id:grant.session_id,request_id:'scoped-cdp-click-0001',action:'click',locator:{by:'role',role:'button',name:'Start'}};
  assert.equal((await runtime.perform(action)).outcome,'dispatched');
  assert.equal(store.status().remaining_actions,1);
  assert.equal((await post('/v1/action',{...target,expected_url:'https://other.example/',session_id:grant.session_id})).error,'SESSION_ORIGIN_MISMATCH');
  failAudit=true;
  assert.equal((await post('/v1/action',{...target,session_id:grant.session_id})).ok,false);
  assert.equal(nativeActions,1);assert.equal(store.status().remaining_actions,1);
  failAudit=false;time+=60000;
  assert.equal((await post('/v1/action',{...target,session_id:grant.session_id})).error,'SESSION_NOT_ACTIVE');
  assert.throws(()=>runtime.perform({...action,request_id:'expired-cdp-click-02'}),/SESSION_NOT_ACTIVE/);
  assert.equal(modals,0);assert.equal(nativeActions,1);assert.equal(page.calls.length,1);
  assert(events.some(e=>e.action==='session_begin'&&e.task_ref===grant.task_ref));
  assert(events.some(e=>e.event==='intent'&&e.task_ref===grant.task_ref));
  assert(!JSON.stringify(events).includes(grant.session_id));
 }finally{await runtime.close();await new Promise(resolve=>server.close(resolve));}
});

test('CDP denies another origin in the same browser',async()=>{
 const store=createSessionStore(),grant=store.begin(request);
 const page=new FakePage('https://other.example/'),connection=new FakeConnection([page]);
 const runtime=new BrowserRuntime({providers:{chrome:{endpoint:'http://127.0.0.1:9222'}},
  connect:async()=>connection,dynamicTabs:true,sessionStore:store,audit:async()=>{}});
 try{
  const tab=(await runtime.discover({browser:'chrome'})).tabs[0];
  await assert.rejects(runtime.perform({browser:'chrome',tab_ref:tab.tab_ref,expected_revision:tab.revision,
   session_id:grant.session_id,request_id:'wrong-origin-click-01',action:'click',locator:{by:'role',role:'button',name:'Start'}}),/SESSION_ORIGIN_MISMATCH/);
  assert.equal(page.calls.length,0);assert.equal(store.status().remaining_actions,3);
 }finally{await runtime.close();}
});
