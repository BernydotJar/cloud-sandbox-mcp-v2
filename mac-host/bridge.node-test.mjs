import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeServer,safeUrl,allowedPeer} from './bridge.mjs';

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
  assert.deepEqual(calls.map(x=>x.operation),['inspect','action']);
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
test('legacy mode defaults to existing allowlist policy',async()=>{
  const {post}=await ready();
  const response=await post('/v1/status');
  assert.equal(response.data.discovery_mode,'allowlist');
});
