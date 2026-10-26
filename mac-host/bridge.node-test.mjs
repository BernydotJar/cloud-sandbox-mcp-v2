import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeServer,safeUrl,allowedPeer,isAllowlistedTabUrl} from './bridge.mjs';
import {setImmediate} from 'node:timers';

const token='not-a-real-production-token-abcdefghijklmnopqrstuvwxyz0123456789';
const allowedOrigins = new Set(['https://admin.microsoft.com']);
const target = {browser:'edge',window_index:1,tab_index:2,expected_url:'https://admin.microsoft.com/'};
const openServers = [];
async function ready(overrides={}) {
  const calls=[];
  const srv=createBridgeServer({
    token, allowedOrigins, platform:'darwin',
    nativeHandler: async (operation,...args) => {
      calls.push({operation,args});
      if(operation==='state') return {running:true,windows:[{window_index:1,tabs:[
        {tab_index:1,active:false,title:'Personal',url:'https://private.invalid/'},
        {tab_index:2,active:true,title:'Microsoft 365',url:'https://admin.microsoft.com/'}
      ]}]};
      if(operation==='bounds') return {x:0,y:0,width:100,height:100};
      return {performed:true,operation};
    },
    approvalHandler:async()=>false,
    captureHandler:async()=>({mime_type:'image/png',base64:'iVBORw0KGgo='}),
    ...overrides
  });
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
  openServers.push(srv);
  const url='http://127.0.0.1:'+srv.address().port;
  const post = async(path,body={},auth=token) => {
    const r=await fetch(url+path,{method:'POST',headers:{
      'authorization':'Bearer '+auth,'content-type':'application/json'
    },body:JSON.stringify(body)});
    return {status:r.status,...(await r.json())};
  };
  return {post,calls};
}
afterEach(async()=>{while(openServers.length) await new Promise(resolve=>openServers.pop().close(resolve));});

test('state hides unapproved tabs and strips query and hash',async()=>{
  const {post}=await ready();
  const result=await post('/v1/state');
  assert.equal(result.ok,true);
  assert.equal(result.data.browsers[1].windows[0].tabs.length,1);
  assert.equal(result.data.browsers[1].windows[0].tabs[0].url,'https://admin.microsoft.com/');
});
test('credential guard rejects requests before invoking native driver',async()=>{
  const {post,calls}=await ready();
  assert.equal((await post('/v1/state',{},'bad-token')).status,403);
  assert.equal(calls.length,0);
});
test('origin allowlist rejects external domains',async()=>{
  const {post,calls}=await ready();
  const result=await post('/v1/focus',{...target,expected_url:'https://somewhere-else.test/'});
  assert.equal(result.status,400);
  assert.equal(calls.length,0);
});
test('native approval denial blocks dangerous actions',async()=>{
  const {post,calls}=await ready();
  const r=await post('/v1/action',{...target,action:'press_key',key:'enter',reason:'Submit settings after inspection'});
  assert.equal(r.status,400);
  assert.equal(r.error,'USER_DENIED_ACTION');
  assert.deepEqual(calls.map(x=>x.operation),['inspect']);
});
test('approved action revalidates native target',async()=>{
  const {post,calls}=await ready({approvalHandler:async()=>true});
  const r=await post('/v1/action',{...target,action:'click',x:12,y:60,reason:'Open settings section'});
  assert.equal(r.status,200);
  assert.deepEqual(calls.map(x=>x.operation),['inspect','bounds','bounds','action']);
});
test('malformed action does not trigger user prompt',async()=>{
  let prompts=0;
  const {post}=await ready({approvalHandler:async()=>{prompts++;return true;}});
  const r=await post('/v1/action',{...target,action:'type_text',text:'',reason:'Test malformed input'});
  assert.equal(r.status,400);
  assert.equal(prompts,0);
});
test('local peer detection and URL sanitization',()=>{
  assert.equal(allowedPeer('::ffff:192.168.65.7'),true);
  assert.equal(allowedPeer('8.8.8.8'),false);
  assert.equal(safeUrl('https://admin.microsoft.com/users?token=secret#fragment'),'https://admin.microsoft.com/users');
});
test('cannot start host service without explicit origins',()=>{
  assert.throws(()=>createBridgeServer({token,platform:'darwin',allowedOrigins:new Set()}),/ALLOWLIST/);
});
test('audit stores only safe event metadata, never typed input',async()=>{
  const events=[];
  const {post}=await ready({approvalHandler:async()=>true,auditHandler:async evt=>events.push(evt)});
  const secretText='confidential-local-text';
  const result=await post('/v1/action',{...target,action:'type_text',text:secretText,
    reason:'Fill a user requested draft field'});
  assert.equal(result.status,200);
  assert.deepEqual(events.map(x=>x.outcome),['approved','performed']);
  assert.equal(JSON.stringify(events).includes(secretText),false);
});
test('state skips blank, loading and unsupported browser tabs without failing discovery',async()=>{
  const {post}=await ready({nativeHandler:async operation=>{
    if(operation==='state') return {running:true,windows:[{window_index:1,tabs:[
      {tab_index:1,title:'New tab',url:''},
      {tab_index:2,title:'Edge internal',url:'edge://newtab/'},
      {tab_index:3,title:'Loading',url:undefined},
      {tab_index:4,title:'Private site',url:'https://private.example/path?token=abc'},
      {tab_index:5,title:'Allowed site',url:'https://admin.microsoft.com/users?private=123#x'}
    ]}]};
    throw Error('Unexpected native operation');
  }});
  const r=await post('/v1/state',{browser:'edge'});
  assert.equal(r.ok,true);
  assert.equal(r.data.browsers[0].running,true);
  assert.deepEqual(r.data.browsers[0].windows[0].tabs.map(t=>t.tab_index),[5]);
  assert.equal(r.data.browsers[0].windows[0].tabs[0].url,'https://admin.microsoft.com/users');
});
test('state classifies native macOS Automation denial without exposing error detail',async()=>{
  const {post}=await ready({nativeHandler:async()=>{throw Error('MAC_AUTOMATION_PERMISSION_DENIED');}});
  const r=await post('/v1/state',{browser:'edge'});
  assert.equal(r.ok,true);
  assert.deepEqual(r.data.browsers[0],{
    browser:'edge',running:null,windows:[],error:'MAC_AUTOMATION_PERMISSION_DENIED'
  });
});

test('dynamic discovery includes web tabs across origins',async()=>{
  const {post}=await ready({dynamicTabs:true});
  const result=await post('/v1/state',{browser:'edge'});
  assert.equal(result.ok,true);
  const tabs=result.data.browsers[0].windows[0].tabs;
  assert.equal(tabs.length,2);
  assert.equal(tabs[0].title,'Personal');
  assert.equal(tabs[0].url,'https://private.invalid/');
});
test('dynamic mode requires fresh title for tab selection',async()=>{
  const {post,calls}=await ready({dynamicTabs:true});
  const base={...target,tab_index:1,expected_url:'https://private.invalid/'};
  const denied=await post('/v1/focus',base);
  assert.equal(denied.error,'EXPECTED_TITLE_REQUIRED');
  assert.equal(calls.length,0);
  const selected=await post('/v1/focus',{...base,expected_title:'Personal'});
  assert.equal(selected.status,200);
  assert.deepEqual(calls[0].args,['edge','1','1','https://private.invalid/','Personal']);
});
test('dynamic mode still blocks writes without local consent',async()=>{
  const {post,calls}=await ready({dynamicTabs:true});
  const response=await post('/v1/action',{
    ...target,expected_title:'Microsoft 365',action:'press_key',key:'tab',
    reason:'Move focus through navigation links'});
  assert.equal(response.error,'USER_DENIED_ACTION');
  assert.deepEqual(calls.map(x=>x.operation),['inspect']);
});
test('dynamic mode rejects internal pages',async()=>{
  const {post,calls}=await ready({dynamicTabs:true});
  const response=await post('/v1/focus',{
    ...target,expected_title:'New Tab',expected_url:'edge://newtab/'});
  assert.equal(response.status,400);
  assert.equal(calls.length,0);
});

test('strict write allowlist blocks native delegated actions on dynamically discovered origins', async () => {
  let prompts = 0;
  const {post, calls} = await ready({
    dynamicTabs: true, restrictBrowserWrites: true,
    approvalHandler: async () => { prompts++; return true; }
  });
  const status = await post('/v1/status');
  assert.equal(status.data.mutation_policy, 'allowlist_only');
  const denied = await post('/v1/action', {
    ...target, expected_url: 'https://private.invalid/', expected_title: 'Personal',
    action: 'press_key', key: 'tab', reason: 'Inspect an unrelated but visible tab'
  });
  assert.equal(denied.error, 'MUTATION_ORIGIN_DENIED');
  assert.equal(prompts, 0);
  assert.equal(calls.length, 0);
  const allowed = await post('/v1/action', {
    ...target, expected_title: 'Microsoft 365',
    action: 'press_key', key: 'tab', reason: 'Navigate an approved origin only'
  });
  assert.equal(allowed.status, 200);
  assert.equal(prompts, 1);
  assert.deepEqual(calls.map(c => c.operation), ['inspect', 'action']);
});

test('legacy mode defaults to existing allowlist policy',async()=>{
  const {post}=await ready();
  const response=await post('/v1/status');
  assert.equal(response.data.discovery_mode,'allowlist');
});

test('one local approval enables multiple Chrome and Edge actions in the same delegated session',async()=>{
  let prompts=0;
  const {post,calls}=await ready({
    dynamicTabs:true,
    approvalHandler:async()=>{prompts++;return true;}
  });
  const beginning=await post('/v1/session/begin',{
    scope:'both',duration_minutes:20,max_actions:5,
    purpose:'Navigate LUMA in Chrome and inspect Microsoft 365 in Edge'
  });
  assert.equal(beginning.status,200);
  assert.equal(prompts,1);
  const sid=beginning.data.session_id;
  assert.match(sid,/^[0-9a-f]{48}$/);
  for(const browser of ['chrome','edge','chrome']){
    const response=await post('/v1/action',{
      ...target,browser,expected_title:'Microsoft 365',
      session_id:sid,action:'press_key',key:'tab',
      reason:'Navigate to the next safe browser control'
    });
    assert.equal(response.status,200);
    assert.equal(response.data.approval_mode,'delegated_session');
  }
  assert.equal(prompts,1);
  assert.equal(calls.filter(x=>x.operation==='action').length,3);
  const active=await post('/v1/session/status');
  assert.equal(active.data.remaining_actions,2);
  assert.equal(active.data.scope,'both');
  const revoked=await post('/v1/session/end',{session_id:sid});
  assert.equal(revoked.data.revoked,true);
  const after=await post('/v1/action',{
    ...target,expected_title:'Microsoft 365',
    session_id:sid,action:'press_key',key:'tab',reason:'Attempt action after revocation'
  });
  assert.equal(after.error,'SESSION_NOT_ACTIVE');
  assert.equal(prompts,1);
});
test('delegated session scope rejects a different browser, without prompting or clicking',async()=>{
  let prompts=0;
  const {post,calls}=await ready({dynamicTabs:true,approvalHandler:async()=>{
    prompts++;return true;
  }});
  const r=await post('/v1/session/begin',{
    scope:'chrome',duration_minutes:10,max_actions:3,purpose:'Inspect and navigate Chrome only'
  });
  const result=await post('/v1/action',{
    ...target,browser:'edge',expected_title:'Microsoft 365',
    session_id:r.data.session_id,action:'click',x:30,y:100,
    reason:'Navigate the Edge license settings'
  });
  assert.equal(result.error,'SESSION_SCOPE_MISMATCH');
  assert.equal(prompts,1);
  assert.equal(calls.filter(x=>x.operation==='action').length,0);
});
test('session identifier never falls back to per-click approval if invalid',async()=>{
  let prompts=0;
  const {post,calls}=await ready({approvalHandler:async()=>{prompts++;return true;}});
  const result=await post('/v1/action',{
    ...target,session_id:'f'.repeat(48),action:'click',x:10,y:50,
    reason:'Attempt a potentially unauthorized browser change'
  });
  assert.equal(result.error,'SESSION_NOT_ACTIVE');
  assert.equal(prompts,0);
  assert.equal(calls.filter(x=>x.operation==='action').length,0);
});
test('rejected delegated grant creates no session',async()=>{
  const {post,calls}=await ready();
  const granted=await post('/v1/session/begin',{
    scope:'both',duration_minutes:20,max_actions:70,
    purpose:'Navigate two browsers without modifying data'
  });
  assert.equal(granted.error,'USER_DENIED_SESSION');
  const state=await post('/v1/session/status');
  assert.equal(state.data.active,false);
  assert.equal(calls.length,0);
});
test('no delegated grant retains the legacy one-approval-per-action policy',async()=>{
  let prompts=0;
  const {post}=await ready({approvalHandler:async()=>{prompts++;return true;}});
  for(let i=0;i<2;i++){
    const r=await post('/v1/action',{...target,action:'press_key',key:'tab',
      reason:'Navigate Microsoft administrator interface'});
    assert.equal(r.status,200);
    assert.equal(r.data.approval_mode,'per_action');
  }
  assert.equal(prompts,2);
});
test('invalid delegated grant parameters are rejected before showing approval dialog',async()=>{
  let prompts=0;
  const {post}=await ready({approvalHandler:async()=>{prompts++;return true;}});
  for(const patch of [{scope:'all_mac'},{duration_minutes:31},{max_actions:201},
    {purpose:'short'}]) {
    const result=await post('/v1/session/begin',{
      scope:'both',duration_minutes:20,max_actions:120,
      purpose:'Navigate Chrome and Edge for an explicit task',...patch
    });
    assert.equal(result.error,'INVALID_SESSION_REQUEST');
  }
  assert.equal(prompts,0);
});

test('revocation while an action is preparing cancels dispatch',async()=>{
  const {createSessionStore}=await import('./autonomy-session.mjs');
  const store=createSessionStore({randomId:()=> '9'.repeat(48)});
  const audit=[];
  const {post,calls}=await ready({
    sessionStore:store,
    approvalHandler:async()=>true,
    auditHandler:async e=>{
      audit.push(e);
      if(e.outcome==='session_authorized')store.end();
    }
  });
  const grant=await post('/v1/session/begin',{
    scope:'edge',duration_minutes:20,max_actions:30,
    purpose:'Inspect the Microsoft 365 page without changing licenses'
  });
  const action=await post('/v1/action',{
    ...target,session_id:grant.data.session_id,
    action:'press_key',key:'tab',
    reason:'Navigate the Microsoft 365 administrative links'
  });
  assert.equal(action.error,'SESSION_NOT_ACTIVE');
  assert.equal(calls.filter(c=>c.operation==='action').length,0);
});
test('only one delegated session can be active at once',async()=>{
  let approvals=0;
  const {post}=await ready({approvalHandler:async()=>{approvals++;return true;}});
  const request={scope:'chrome',duration_minutes:20,max_actions:20,
    purpose:'Navigate LUMA through Chrome without data changes'};
  assert.equal((await post('/v1/session/begin',request)).status,200);
  assert.equal((await post('/v1/session/begin',request)).error,'SESSION_ALREADY_ACTIVE');
  assert.equal(approvals,1);
});
test('session audit never captures typed content',async()=>{
  const audit=[];
  const {post}=await ready({approvalHandler:async()=>true,auditHandler:async e=>audit.push(e)});
  const grant=await post('/v1/session/begin',{scope:'both',duration_minutes:5,
    max_actions:10,purpose:'Type test text into the designated form field'});
  const typed='sensitive_test_input_visible_only_to_page';
  const reply=await post('/v1/action',{...target,session_id:grant.data.session_id,
    action:'type_text',text:typed,reason:'Fill the temporary authorized test field'});
  assert.equal(reply.status,200);
  assert.equal(JSON.stringify(audit).includes(typed),false);
});

test('browser_tabs transparently returns native targets if CDP cannot attach',async()=>{
 const {post,calls}=await ready({
   enableBrowserRuntime:true,dynamicTabs:true,
   browserProviders:{chrome:{endpoint:'chrome',protocol:'cdp'}},
   // Force a transport failure without launching any browser.
   browserAudit:async()=>{},
 });
 const r=await post('/v2/browser/tabs',{browser:'chrome'});
 assert.equal(r.status,200);
 assert.equal(r.data.provider,'native');
 assert.equal(r.data.semantic_available,false);
 assert.equal(r.data.running,true);
 assert.equal(r.data.tabs.length,2);
 assert.equal(r.data.tabs[0].title,'Personal');
 assert.equal(r.data.tabs[0].native_target.expected_url,'https://private.invalid/');
 assert.equal(r.data.tabs[1].native_target.expected_title,'Microsoft 365');
 assert.equal(r.data.tabs[0].tab_ref,undefined);
 assert(calls.some(c=>c.operation==='state'));
});
test('fallback never returns unsafe schemes, blank titles or disallowed origins',async()=>{
 const {post}=await ready({
   dynamicTabs:false,enableBrowserRuntime:true,
   browserProviders:{edge:{endpoint:'msedge',protocol:'cdp'}}
 });
 const r=await post('/v2/browser/tabs',{browser:'edge',title:'Microsoft',exact:false});
 assert.equal(r.status,200);
 assert.equal(r.data.provider,'native');
 assert.equal(r.data.tabs.length,1);
 assert.equal(r.data.tabs[0].url,'https://admin.microsoft.com/');
});
test('fallback reports closed browser without pretending a persistent provider exists',async()=>{
 const {post}=await ready({
   dynamicTabs:true,enableBrowserRuntime:true,
   browserProviders:{chrome:{endpoint:'chrome',protocol:'cdp'}},
   nativeHandler:async(op)=>{
     if(op==='state')return {running:false,windows:[]};
     throw Error('Unexpected driver call');
   }
 });
 const r=await post('/v2/browser/tabs',{browser:'chrome'});
 assert.equal(r.status,200);
 assert.equal(r.data.running,false);
 assert.equal(r.data.launch_available,true);
 assert.equal(r.data.tabs.length,0);
});
test('opening an already running browser is idempotent and never calls macOS open',async()=>{
 const launches=[];
 const {post}=await ready({
   enableBrowserRuntime:true,
   launchBrowserHandler:async name=>launches.push(name)
 });
 const r=await post('/v2/browser/open',{browser:'chrome',reason:'Open Chrome for my app testing'});
 assert.equal(r.status,200);
 assert.equal(r.data.already_running,true);
 assert.equal(r.data.launched,false);
 assert.deepEqual(launches,[]);
});
test('only explicit browser_open launches a whitelisted app and verifies it is running',async()=>{
 const launches=[];
 let running=false;
 const audit=[];
 const {post,calls}=await ready({
   enableBrowserRuntime:true,
   browserAudit:async evt=>audit.push(evt),
   nativeHandler:async(op)=>{
     calls.push({operation:op});
     if(op==='state')return {running,windows:[]};
     throw Error('Unknown action');
   },
   launchBrowserHandler:async name=>{launches.push(name);running=true;}
 });
 const r=await post('/v2/browser/open',{browser:'edge',reason:'Use Edge for the Microsoft administration page'});
 assert.equal(r.status,200);
 assert.equal(r.data.launched,true);
 assert.deepEqual(launches,['edge']);
 assert.deepEqual(audit.map(e=>e.outcome),['intent','launched']);
 assert(calls.some(c=>c.operation==='state'));
});
test('invalid browser_open requests cannot launch an arbitrary executable, URL or script',async()=>{
 const launches=[];
 const {post}=await ready({
   enableBrowserRuntime:true,launchBrowserHandler:async name=>launches.push(name)
 });
 for(const input of [
   {browser:'safari',reason:'Open a third party application'},
   {browser:'chrome',reason:'short'},
   {browser:'edge',reason:'Open a browser safely',url:'https://test.invalid/',shell:'id'}
 ]){
   const r=await post('/v2/browser/open',input);
   assert.equal(r.status,400);
   assert.equal(r.error,'INVALID_RUNTIME_REQUEST');
 }
 assert.deepEqual(launches,[]);
});
test('native fallback is not used to bypass an invalid target request',async()=>{
 const {post,calls}=await ready({
   dynamicTabs:true,enableBrowserRuntime:true,
   browserProviders:{chrome:{endpoint:'chrome',protocol:'cdp'}}
 });
 const r=await post('/v2/browser/tabs',{browser:'chrome',exact:'not_boolean'});
 assert.equal(r.status,400);
 assert.equal(r.error,'INVALID_RUNTIME_REQUEST');
 assert.equal(calls.filter(c=>c.operation==='state').length,0);
});

test('dedicated Chrome auto-start is opt-in and requires the exact dedicated CDP endpoint',async()=>{
  let starts=0;
  const base={browserRouting:'prefer_persistent',enableBrowserRuntime:true,
    browserProviders:{chrome:{endpoint:'http://127.0.0.1:9223',protocol:'cdp'}},
    dedicatedChromeAutoStart:true,
    ensureDedicatedChromeHandler:async()=>{starts++;return {ready:false,started:true};}};
  const {post}=await ready(base);
  const fail=await post('/v2/browser/tabs',{browser:'chrome'});
  assert.equal(fail.status,400);
  assert.equal(fail.error,'DEDICATED_CHROME_ATTACH_FAILED');
  assert.equal(starts,1);
  const {post:without}=await ready({...base,dedicatedChromeAutoStart:false});
  await without('/v2/browser/tabs',{browser:'chrome'});
  assert.equal(starts,1);
  const {post:personal}=await ready({...base,browserProviders:{
    chrome:{endpoint:'chrome',protocol:'cdp'}}});
  await personal('/v2/browser/tabs',{browser:'chrome'});
  assert.equal(starts,1);
});

test('trusted Edge delegation emits an optional 20-second notice without approval modal',async()=>{
  const notices=[],audit=[];
  let modalCalls=0;
  const {post,calls}=await ready({
    trustedSessionNoticeEnabled:true,
    restrictBrowserWrites:true,
    approvalHandler:async()=>{modalCalls++;return false;},
    trustedSessionNoticeHandler:async payload=>{notices.push(payload);},
    auditHandler:async event=>{audit.push(event);}
  });
  const bridgeStatus=await post('/v1/status');
  assert.deepEqual(bridgeStatus.data.trusted_delegation_notice,
    {enabled:true,seconds:20,closable:true,max_minutes:30,max_actions:200,
      unlimited_actions:false,scope:'single_browser'});
  const requested={scope:'edge',duration_minutes:5,max_actions:4,
    purpose:'Reload only the Meridian Edge tab for verified QA'};
  const granted=await post('/v1/session/begin',requested);
  assert.equal(granted.status,200);
  assert.equal(granted.data.approval_mode,'configured_trust');
  assert.equal(granted.data.notice_seconds,20);
  assert.equal(modalCalls,0);
  assert.equal(granted.data.remaining_actions,4);
  assert.equal(granted.data.unlimited_actions,false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(notices,[{scope:'edge',duration_minutes:5,max_actions:4}]);
  assert(audit.some(e=>e.action==='trusted_session_intent'&&e.outcome==='prepared'));
  const action=await post('/v1/action',{
    ...target,session_id:granted.data.session_id,action:'press_key',key:'tab',
    reason:'Read the allowed Microsoft 365 example application'});
  assert.equal(action.status,200);
  assert.equal(action.data.approval_mode,'delegated_session');
  assert.equal(action.data.remaining_session_actions,3);
  assert.equal(modalCalls,0);
  assert.equal(calls.filter(c=>c.operation==='action').length,1);
  const denied=await post('/v1/action',{
    ...target,expected_url:'https://not-allowlisted.example/',
    session_id:granted.data.session_id,
    action:'click',x:20,y:50,reason:'Attempt a destination outside configured origins'});
  assert.equal(denied.status,400);
  assert.equal(calls.filter(c=>c.operation==='action').length,1);
  assert.equal(notices.length,1);
});

test('a failed postgrant audit revokes unlimited trusted delegation before showing notice',async()=>{
  let notices=0;
  const {post}=await ready({
    trustedSessionNoticeEnabled:true,
    restrictBrowserWrites:true,
    trustedSessionNoticeHandler:async()=>{notices++;},
    auditHandler:async event=>{
      if(event.action==='session_begin')throw Error('AUDIT_PERSISTENCE_FAILED');
    }
  });
  const grant=await post('/v1/session/begin',{
    scope:'edge',duration_minutes:30,max_actions:1,
    purpose:'Attempt an operator trusted session while audit persistence is broken'
  });
  assert.equal(grant.status,400);
  assert.equal(grant.error,'AUDIT_UNAVAILABLE');
  assert.equal((await post('/v1/session/status')).data.active,false);
  assert.equal(notices,0);
});

test('trusted delegated mode is off by default and rejects unrestricted auto-approval',async()=>{
  const {post}=await ready({restrictBrowserWrites:true});
  const response=await post('/v1/session/begin',{
    scope:'edge',duration_minutes:5,max_actions:4,
    purpose:'Inspect the Edge tab in an explicitly scoped QA session'});
  assert.equal(response.error,'USER_DENIED_SESSION');
  assert.throws(()=>createBridgeServer({
    token,allowedOrigins,platform:'darwin',
    restrictBrowserWrites:false,trustedSessionNoticeEnabled:true
  }),/TRUSTED_NOTICE_REQUIRES_ALLOWLIST/);
});

test('trusted grants fail closed for both browsers and oversized requests',async()=>{
  const {post}=await ready({
    trustedSessionNoticeEnabled:true,
    restrictBrowserWrites:true,
    approvalHandler:async()=>{throw Error('MODAL_SHOULD_NOT_BE_CALLED');}
  });
  const baseline={scope:'edge',duration_minutes:5,max_actions:4,
    purpose:'Verify a scoped tab without additional dialog'};
  const both=await post('/v1/session/begin',{...baseline,scope:'both'});
  assert.equal(both.status,400);
  assert.equal(both.error,'TRUSTED_SESSION_LIMITS_EXCEEDED');
  const overTime=await post('/v1/session/begin',{...baseline,duration_minutes:31});
  assert.equal(overTime.status,400);
  assert.equal(overTime.error,'INVALID_SESSION_REQUEST');
  assert.equal((await post('/v1/session/status')).data.active,false);
});

test('trusted 30-minute grant uses a finite action budget',async()=>{
  const {post}=await ready({
    trustedSessionNoticeEnabled:true,
    restrictBrowserWrites:true,
    approvalHandler:async()=>{throw Error('NO_MODAL_EXPECTED');}
  });
  const started=await post('/v1/session/begin',{
    scope:'edge',duration_minutes:30,max_actions:200,
    purpose:'Use an allowlisted single Edge browser for authorized application QA'});
  assert.equal(started.status,200);
  assert.equal(started.data.unlimited_actions,false);
  assert.equal(started.data.remaining_actions,200);
  assert.equal((await post('/v1/session/status')).data.unlimited_actions,false);
  assert.equal((await post('/v1/session/status')).data.remaining_actions,200);
  assert.equal(started.data.approval_mode,'configured_trust');
  const ended=await post('/v1/session/end',{session_id:started.data.session_id});
  assert.equal(ended.status,200);
  assert.equal(ended.data.revoked,true);
  assert.equal((await post('/v1/session/status')).data.active,false);
});

test('trusted grant never skips its pre-grant audit',async()=>{
  let notices=0,modalCalls=0;
  const {post}=await ready({
    trustedSessionNoticeEnabled:true,restrictBrowserWrites:true,
    approvalHandler:async()=>{modalCalls++;return true;},
    auditHandler:async event=>{
      if(event.action==='trusted_session_intent')throw Error('DISK_FULL');
    },
    trustedSessionNoticeHandler:async()=>{notices++;}
  });
  const result=await post('/v1/session/begin',{
    scope:'edge',duration_minutes:5,max_actions:4,
    purpose:'Attempt an audited session with unavailable audit storage'});
  assert.equal(result.error,'AUDIT_UNAVAILABLE');
  assert.equal((await post('/v1/session/status')).data.active,false);
  assert.equal(modalCalls,0);
  assert.equal(notices,0);
});

test('operator-added exact LinkedIn origin permits scoped Chrome actions but not lookalike domains',async()=>{
  const addedOrigins=new Set([...allowedOrigins,'https://www.linkedin.com']);
  const {post,calls}=await ready({
    allowedOrigins:addedOrigins,
    dynamicTabs:true,
    restrictBrowserWrites:true,
    trustedSessionNoticeEnabled:true,
    approvalHandler:async()=>{throw Error('TRUSTED_MODE_SHOULD_NOT_PROMPT');}
  });
  const grant=await post('/v1/session/begin',{
    scope:'chrome',duration_minutes:5,max_actions:1,
    purpose:'Verify delegated LinkedIn navigation within the exact permitted origin'
  });
  assert.equal(grant.status,200);
  assert.equal(grant.data.unlimited_actions,false);
  const exact={browser:'chrome',window_index:1,tab_index:2,
    expected_title:'LinkedIn Feed',expected_url:'https://www.linkedin.com/feed/',
    session_id:grant.data.session_id,action:'press_key',key:'tab',
    reason:'Navigate a permitted LinkedIn page without posting content'};
  const allowed=await post('/v1/action',exact);
  assert.equal(allowed.status,200);
  assert.equal(allowed.data.approval_mode,'delegated_session');
  for(const lookalike of [
    'https://linkedin.com/feed/',
    'https://www.linkedin.com.evil.example/feed/',
    'https://business.linkedin.com/feed/'
  ]) {
    const denied=await post('/v1/action',{...exact,expected_url:lookalike});
    assert.equal(denied.status,400);
    assert.equal(denied.error,'MUTATION_ORIGIN_DENIED');
  }
  assert.equal(calls.filter(c=>c.operation==='action').length,1);
  assert.equal((await post('/v1/session/end',{session_id:grant.data.session_id})).data.revoked,true);
});


test('LCH wildcard supports both native Chrome and Edge delegated browser sessions',async()=>{
  const allowlist=new Set([
    'https://www.linkedin.com','https://*.linkedin.com',
    'https://lch-app.cloud',
    'https://*.lch-app.cloud',
    'https://cloud.uipath.com','https://*.cloud.uipath.com',
    'https://atlassian.net','https://*.atlassian.net'
  ]);
  for(const browser of ['chrome','edge']) {
    const {post,calls}=await ready({
      allowedOrigins:allowlist,
      dynamicTabs:true,
      restrictBrowserWrites:true,
      trustedSessionNoticeEnabled:true,
      auditHandler:async()=>{},
      approvalHandler:async()=>{throw Error('TRUSTED_MODE_HAS_NO_MODAL');}
    });
    const status=await post('/v1/status');
    assert.equal(status.status,200);
    assert.equal(status.data.lch_app_cloud_wildcard_enabled,true);
    assert.equal(status.data.allowlisted_origins,8);
    const grant=await post('/v1/session/begin',{
      scope:browser,duration_minutes:10,max_actions:15,
      purpose:'Verify test-only wildcard origin policy for both supported browsers'
    });
    assert.equal(grant.status,200);
    assert.equal(grant.data.unlimited_actions,false);
    for(const url of [
      'https://lch-app.cloud/',
      'https://luma.lch-app.cloud/studio',
      'https://meridian.lch-app.cloud/',
      'https://future.service.lch-app.cloud/',
      'https://www.linkedin.com/feed/','https://business.linkedin.com/jobs/',
      'https://cloud.uipath.com/','https://org.cloud.uipath.com/',
      'https://atlassian.net/','https://customer.atlassian.net/jira'
    ]){
      const data=await post('/v1/action',{
        browser,window_index:1,tab_index:1,
        expected_title:'QA Page',expected_url:url,
        action:'press_key',key:'tab',session_id:grant.data.session_id,
        reason:'Perform one safe keyboard navigation within test allowlist'
      });
      assert.equal(data.status,200,url);
      assert.equal(data.data.approval_mode,'delegated_session');
      assert(data.data.remaining_session_actions>=0 && data.data.remaining_session_actions<15);
    }
    const count=calls.filter(e=>e.operation==='action').length;
    for(const url of [
      'https://lch-app.cloud.evil.example/',
      'https://evil-lch-app.cloud/',
      'https://evillch-app.cloud/',
      'http://luma.lch-app.cloud/',
      'https://foo.lch-app.cloud:8443/',
      'https://linkedin.com/',
      'https://tenant.cloud.uipath.com.evil.example/',
      'https://customer.atlassian.net.evil.example/',
      'https://customer.atlassian.net:4444/'
    ]){
      const denied=await post('/v1/action',{
        browser,window_index:1,tab_index:1,
        expected_title:'QA Page',expected_url:url,
        action:'press_key',key:'tab',session_id:grant.data.session_id,
        reason:'Verify that no event reaches an unapproved origin'
      });
      assert.equal(denied.status,400,url);
      assert.equal(denied.error,'MUTATION_ORIGIN_DENIED');
    }
    assert.equal(calls.filter(e=>e.operation==='action').length,count);
    assert.equal((await post('/v1/session/end',{session_id:grant.data.session_id})).data.revoked,true);
  }
});

test('native tab allowlist honors apex, deep wildcard and domain boundary',()=>{
  const policy=new Set(['https://lch-app.cloud','https://*.lch-app.cloud']);
  for(const url of ['https://lch-app.cloud/','https://luma.lch-app.cloud/studio',
    'https://one.two.lch-app.cloud/'])
    assert.equal(isAllowlistedTabUrl(url,policy),true);
  for(const url of ['https://lch-app.cloud.evil.example/',
    'https://evil-lch-app.cloud/','http://luma.lch-app.cloud/',
    'https://luma.lch-app.cloud:8443/'])
    assert.equal(isAllowlistedTabUrl(url,policy),false);
});

test('ambiguous native Edge tab identity blocks action BEFORE approval or dispatch',async()=>{
  let approvals=0,actions=0;
  const {post}=await ready({
    dynamicTabs:true,
    approvalHandler:async()=>{approvals++;return true;},
    nativeHandler:async(operation)=>{
      if(operation==='inspect')throw Error('AMBIGUOUS_NATIVE_TARGET');
      if(operation==='action')actions++;
      return {performed:true};
    }
  });
  const result=await post('/v1/action',{
    ...target,expected_title:'Microsoft 365',action:'press_key',key:'tab',
    reason:'Navigate the uniquely identified Microsoft 365 tab only'
  });
  assert.equal(result.status,400);
  assert.equal(result.error,'AMBIGUOUS_NATIVE_TARGET');
  assert.equal(approvals,0);
  assert.equal(actions,0);
});

test('screenshot rejects a changed foreground native tab before capture',async()=>{
  let captures=0;
  const {post}=await ready({
    nativeHandler:async operation=>{
      if(operation==='bounds')throw Error('TARGET_CHANGED');
      return {performed:true};
    },
    captureHandler:async()=>{captures++;return {mime_type:'image/png',base64:'iVBORw0KGgo='};}
  });
  const result=await post('/v1/screenshot',target);
  assert.equal(result.status,400);
  assert.equal(result.error,'TARGET_CHANGED');
  assert.equal(captures,0);
});

function retinaFakePng(w,h) {
  const raw=Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(raw,0);
  raw.writeUInt32BE(13,8);raw.write('IHDR',12,'ascii');
  raw.writeUInt32BE(w,16);raw.writeUInt32BE(h,20);raw[24]=8;raw[25]=6;
  return {mime_type:'image/png',base64:raw.toString('base64')};
}
test('Retina screenshot contract converts screenshot_pixels to global screen_points before dispatch',async()=>{
  const dispatch=[];
  const {post}=await ready({
    approvalHandler:async()=>true,
    nativeHandler:async(op,...args)=>{
      if(op==='bounds')return {x:100,y:80,width:600,height:400};
      dispatch.push({op,args});return {performed:true};
    },
    captureHandler:async()=>retinaFakePng(1200,800)
  });
  const shot=await post('/v1/screenshot',{...target,expected_title:'Microsoft 365'});
  assert.equal(shot.status,200);
  assert.equal(shot.data.geometry.scale.x,2);
  assert.equal(shot.data.geometry.image_pixels.width,1200);
  assert.equal(shot.data.geometry.bounds_points.x,100);
  const action=await post('/v1/action',{
    ...target,expected_title:'Microsoft 365',action:'click',
    x:200,y:100,coordinate_space:'screenshot_pixels',
    screenshot_ref:shot.data.geometry.screenshot_ref,reason:'Click the previously photographed safe test control'
  });
  assert.equal(action.status,200);
  const click=dispatch.find(x=>x.op==='action');
  assert.deepEqual(click.args.slice(-3),['click','200','130']);
});
test('stale screenshot after target window move is denied without any click',async()=>{
  let windowY=80;let actions=0;
  const {post}=await ready({
    approvalHandler:async()=>true,
    nativeHandler:async(op)=>{
      if(op==='bounds')return {x:100,y:windowY,width:600,height:400};
      if(op==='action')actions++;
      return {performed:true};
    },
    captureHandler:async()=>retinaFakePng(1200,800)
  });
  const s=await post('/v1/screenshot',{...target,expected_title:'Microsoft 365'});
  windowY=82;
  const act=await post('/v1/action',{...target,expected_title:'Microsoft 365',
    action:'click',x:200,y:100,coordinate_space:'screenshot_pixels',
    screenshot_ref:s.data.geometry.screenshot_ref,reason:'Attempt expired moved screenshot coordinate'});
  assert.equal(act.error,'STALE_SCREENSHOT_GEOMETRY');
  assert.equal(actions,0);
});
test('mismatched browser/title screenshot ref fails closed',async()=>{
  let actions=0;
  const {post}=await ready({
    approvalHandler:async()=>true,
    nativeHandler:async(op)=>{
      if(op==='bounds')return {x:100,y:80,width:600,height:400};
      if(op==='action')actions++;
      return {performed:true};
    },
    captureHandler:async()=>retinaFakePng(1200,800)
  });
  const s=await post('/v1/screenshot',{...target,expected_title:'Microsoft 365'});
  const act=await post('/v1/action',{...target,expected_title:'Other Page',
    action:'click',x:200,y:100,coordinate_space:'screenshot_pixels',
    screenshot_ref:s.data.geometry.screenshot_ref,reason:'Attempt to click a different page'});
  assert.equal(act.error,'SCREENSHOT_TARGET_MISMATCH');
  assert.equal(actions,0);
});
test('legacy global screen_points must fall inside actual frontmost window',async()=>{
  let actions=0;
  const {post}=await ready({
    approvalHandler:async()=>true,
    nativeHandler:async(op)=>{
      if(op==='bounds')return {x:100,y:80,width:600,height:400};
      if(op==='action')actions++;
      return {performed:true};
    }
  });
  const act=await post('/v1/action',{...target,
    action:'click',x:12,y:60,coordinate_space:'screen_points',
    reason:'Unsafe old image-local coordinates misidentified as global'});
  assert.equal(act.error,'COORDINATES_OUTSIDE_TARGET');
  assert.equal(actions,0);
});
test('screenshot ref revoked when delegated task session ends',async()=>{
  const {post}=await ready({
    approvalHandler:async()=>true,
    nativeHandler:async(op)=>{
      if(op==='bounds')return {x:100,y:80,width:600,height:400};
      return {performed:true};
    },
    captureHandler:async()=>retinaFakePng(1200,800)
  });
  const ss=await post('/v1/session/begin',{scope:'edge',duration_minutes:10,max_actions:10,purpose:'Test delegated screenshot reference expiration'});
  assert.equal(ss.status,200);
  const s=await post('/v1/screenshot',{...target,expected_title:'Microsoft 365'});
  await post('/v1/session/end',{session_id:ss.data.session_id});
  const a=await post('/v1/action',{...target,expected_title:'Microsoft 365',
    action:'click',x:30,y:30,coordinate_space:'screenshot_pixels',
    screenshot_ref:s.data.geometry.screenshot_ref,reason:'Test revoked temporary screenshot reference'});
  assert.equal(a.error,'STALE_SCREENSHOT_REF');
});

test('native AX screenshot exposes bounded opaque node refs and presses only verified node',async()=>{
  const pressed=[];
  const rows={provider:'native_ax',revision:'a'.repeat(64),nodes:[
    {path:[2,3],role:'AXButton',name:'Cancel Editing',enabled:true,
     fingerprint:'b'.repeat(64),
     frame_points:{x:120,y:100,width:65,height:25}}
  ]};
  const {post}=await ready({
    approvalHandler:async()=>true,
    captureHandler:async()=>retinaFakePng(1200,800),
    nativeHandler:async op=>{
      if(op==='bounds')return {x:100,y:80,width:600,height:400};
      if(op==='action')throw Error('Native coordinate fallback forbidden');
      return {performed:true};
    },
    axHandler:async(op,args)=>{
      if(op==='snapshot')return rows;
      pressed.push({op,args});
      return {performed:true,provider:'native_ax',action:'press'};
    }
  });
  const t={...target,expected_title:'Microsoft 365'};
  const snapshot=await post('/v1/screenshot',{...t,include_ax:true});
  assert.equal(snapshot.status,200);
  assert.equal(snapshot.data.ax_snapshot.provider,'native_ax');
  assert.equal(snapshot.data.ax_snapshot.nodes[0].name,'Cancel Editing');
  assert.equal(JSON.stringify(snapshot.data.ax_snapshot).includes('fingerprint'),false);
  const act=await post('/v1/action',{...t,action:'ax_press',
    ax_node_ref:snapshot.data.ax_snapshot.nodes[0].node_ref,
    ax_revision:snapshot.data.ax_snapshot.ax_revision,
    reason:'Press the unique authorized Cancel Editing AX button, without saving any data'});
  assert.equal(act.status,200);
  assert.equal(pressed.length,1);
  assert.equal(pressed[0].args.action,'press');
  assert.deepEqual(pressed[0].args.path,[2,3]);
  const replay=await post('/v1/action',{...t,action:'ax_press',
    ax_node_ref:snapshot.data.ax_snapshot.nodes[0].node_ref,
    ax_revision:snapshot.data.ax_snapshot.ax_revision,
    reason:'Attempt to replay the same AX press after dispatch'});
  assert.equal(replay.error,'STALE_AX_NODE');
  assert.equal(pressed.length,1);
});
test('native AX snapshot requires real provider and never silently clicks by coordinates',async()=>{
  let nativeClicks=0;
  const {post}=await ready({
    approvalHandler:async()=>true,
    captureHandler:async()=>retinaFakePng(1200,800),
    nativeHandler:async op=>{
      if(op==='bounds')return {x:100,y:80,width:600,height:400};
      if(op==='action')nativeClicks++;
      return {performed:true};
    },
    axHandler:async()=>{throw Error('NATIVE_AX_UNAVAILABLE');}
  });
  const t={...target,expected_title:'Microsoft 365'};
  const r=await post('/v1/screenshot',{...t,include_ax:true});
  assert.equal(r.error,'NATIVE_AX_UNAVAILABLE');
  const a=await post('/v1/action',{...t,action:'ax_press',
    ax_node_ref:'b'.repeat(64),ax_revision:'a'.repeat(64),
    reason:'Attempt AX action without real snapshot'});
  assert.equal(a.error,'STALE_AX_NODE');
  assert.equal(nativeClicks,0);
});
test('native AX node is invalidated on changed window dimensions before dispatch',async()=>{
  let bounds={x:100,y:80,width:600,height:400},acts=0;
  const t={...target,expected_title:'Microsoft 365'};
  const {post}=await ready({
    approvalHandler:async()=>true,
    captureHandler:async()=>retinaFakePng(1200,800),
    nativeHandler:async op=>{
      if(op==='bounds')return bounds;
      return {performed:true};
    },
    axHandler:async op=>{
      if(op==='snapshot')return {provider:'native_ax',revision:'a'.repeat(64),nodes:[
        {path:[1],role:'AXButton',name:'Open Editor',enabled:true,
         fingerprint:'b'.repeat(64),frame_points:{x:120,y:100,width:60,height:25}}
      ]};
      acts++;return {performed:true};
    }
  });
  const s=await post('/v1/screenshot',{...t,include_ax:true});
  bounds={...bounds,width:601};
  const a=await post('/v1/action',{...t,action:'ax_press',
    ax_node_ref:s.data.ax_snapshot.nodes[0].node_ref,
    ax_revision:s.data.ax_snapshot.ax_revision,
    reason:'Attempt stale AX button after window resize'});
  assert.equal(a.error,'AX_WINDOW_CHANGED');
  assert.equal(acts,0);
});
test('native AX node cannot set protected fields or borrow a different profile',async()=>{
  let acts=0;
  const t={...target,expected_title:'Microsoft 365'};
  const {post}=await ready({
    approvalHandler:async()=>true,
    captureHandler:async()=>retinaFakePng(1200,800),
    nativeHandler:async op=>{
      if(op==='bounds')return {x:100,y:80,width:600,height:400};
      return {performed:true};
    },
    axHandler:async op=>{
      if(op==='snapshot')return {provider:'native_ax',revision:'a'.repeat(64),nodes:[
        {path:[1],role:'AXTextField',name:'Monday hours',enabled:true,
         fingerprint:'b'.repeat(64),frame_points:{x:120,y:100,width:60,height:25}}
      ]};
      acts++;return {performed:true};
    }
  });
  const s=await post('/v1/screenshot',{...t,include_ax:true});
  const other=await post('/v1/action',{...t,browser:'chrome',
    action:'ax_set_value',ax_node_ref:s.data.ax_snapshot.nodes[0].node_ref,
    ax_revision:s.data.ax_snapshot.ax_revision,text:'8',
    reason:'Attempt to act on a field through the wrong browser profile'});
  assert.equal(other.error,'AX_TARGET_MISMATCH');
  assert.equal(acts,0);
  const invalid=await post('/v1/action',{...t,action:'ax_press',
    ax_node_ref:s.data.ax_snapshot.nodes[0].node_ref,
    ax_revision:s.data.ax_snapshot.ax_revision,
    reason:'Attempt to press a text field rather than fill'});
  assert.equal(invalid.error,'AX_ACTION_NOT_SUPPORTED');
  assert.equal(acts,0);
});

test('background_required=true blocks native focus, screenshots and global input before OS dispatch',async()=>{
  let prompts=0;
  const {post,calls}=await ready({approvalHandler:async()=>{prompts++;return true;}});
  const requests=[
    ['/v1/focus',{...target,background_required:true}],
    ['/v1/screenshot',{...target,background_required:true}],
    ['/v1/action',{...target,background_required:true,
      action:'press_key',key:'tab',reason:'Attempt background time entry using global Mac keyboard'}],
    ['/v1/action',{...target,background_required:true,
      action:'click',x:12,y:60,reason:'Attempt background time entry using global Mac cursor'}]
  ];
  for(const [endpoint,body] of requests) {
    const r=await post(endpoint,body);
    assert.equal(r.error,'BACKGROUND_NATIVE_FOREGROUND_REQUIRED');
    assert.equal(r.status,400);
  }
  assert.equal(prompts,0);
  assert.equal(calls.length,0);
});
test('background_required must be a boolean when a native target is requested',async()=>{
  const {post,calls}=await ready();
  const r=await post('/v1/screenshot',{...target,background_required:'false'});
  assert.equal(r.error,'INVALID_BACKGROUND_REQUEST');
  assert.equal(calls.length,0);
});
test('native host status explicitly reports foreground-only capability',async()=>{
  const {post}=await ready();
  const r=await post('/v1/status',{});
  assert.equal(r.data.native_display_behavior,'foreground_only');
  assert.equal(r.data.background_native_actions_supported,false);
});
