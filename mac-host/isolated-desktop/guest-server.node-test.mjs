import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createLedger,createWorker,createHttpServer} from './guest-server.mjs';

const fixture={
 revision:'a'.repeat(64),nodes:[
  {path:[0,1],role:'AXTextField',name:'Hours',enabled:true,
   fingerprint:'b'.repeat(64)},
  {path:[0,2],role:'AXButton',name:'Apply',enabled:true,
   fingerprint:'c'.repeat(64)}
 ]};
const id='1'.repeat(64),operator='2'.repeat(64);
const bundle='com.sandbox.AXFixture';
function harness(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isolated-mac-worker-'));
 let dispatches=0;
 const requests=[];
 const ledger=createLedger(path.join(temp,'audit.jsonl'));
 const worker=createWorker({token:'x'.repeat(48),identity:id,
   operatorIdentity:operator,allowedBundles:[bundle],ledger,
   runner:req=>{
     requests.push(req);
     if(req.operation==='snapshot')return fixture;
     dispatches++;
     return {dispatched:true};
   }});
 return {temp,ledger,worker,requests,getDispatches:()=>dispatches,
   dispose:()=>fs.rmSync(temp,{recursive:true,force:true})};
}
test('isolated Mac worker rejects same physical machine',()=>{
 assert.throws(()=>createWorker({token:'x'.repeat(48),identity:id,
   operatorIdentity:id,allowedBundles:[bundle],runner:()=>{},
   ledger:createLedger('/unused',{persist:false})}),/WORKER_IS_OPERATOR_MAC/);
});
test('fresh AX node is required before any action and no typed content in audit',()=>{
 const h=harness();
 try{
  const snap=h.worker.snapshot({bundle_id:bundle,window_title:'Fixture'});
  assert.equal(snap.provider,'isolated_mac_ax');
  assert.equal(snap.nodes.length,2);
  const params={bundle_id:bundle,window_title:'Fixture',
    request_id:'3'.repeat(64),expected_revision:snap.revision,
    node_ref:snap.nodes[0].node_ref,action:'set_value',value:'Secret User Input'};
  assert.deepEqual(h.worker.action(params),{
    dispatched:true,isolated_machine:id,
    business_effect:'UNVERIFIED_REQUIRE_READBACK',receipt:'3'.repeat(64)});
  assert.equal(h.getDispatches(),1);
  assert.throws(()=>h.worker.action(params),/WORKER_REQUEST_REPLAY_BLOCKED/);
  assert.equal(h.getDispatches(),1);
  assert.equal(fs.readFileSync(path.join(h.temp,'audit.jsonl'),'utf8').includes('Secret'),false);
  assert.equal(h.ledger.lookup(params.request_id).status,'complete');
 }finally{h.dispose();}
});
test('stale references, unsupported action-role and app mismatch fail closed',()=>{
 const h=harness();
 try{
  assert.throws(()=>h.worker.snapshot({bundle_id:'com.other.App',window_title:'Fixture'}),/WORKER_TARGET_DENIED/);
  const s=h.worker.snapshot({bundle_id:bundle,window_title:'Fixture'});
  assert.throws(()=>h.worker.action({bundle_id:bundle,window_title:'Fixture',
    request_id:'4'.repeat(64),expected_revision:'f'.repeat(64),
    node_ref:s.nodes[0].node_ref,action:'press'}),/WORKER_AX_STALE_TARGET/);
  assert.throws(()=>h.worker.action({bundle_id:bundle,window_title:'Fixture',
    request_id:'4'.repeat(64),expected_revision:s.revision,
    node_ref:s.nodes[0].node_ref,action:'press'}),/WORKER_ROLE_DENIED/);
  assert.equal(h.getDispatches(),0);
 }finally{h.dispose();}
});
test('intent audit survived restart blocks uncertain replay',()=>{
 const h=harness();
 try{
  const req='8'.repeat(64);
  h.ledger.record({request:req,status:'intent',utc:new Date().toISOString()});
  const durable=createLedger(path.join(h.temp,'audit.jsonl'));
  assert.equal(durable.lookup(req).status,'intent');
  const snap=h.worker.snapshot({bundle_id:bundle,window_title:'Fixture'});
  assert.throws(()=>h.worker.action({bundle_id:bundle,window_title:'Fixture',
    request_id:req,expected_revision:snap.revision,node_ref:snap.nodes[1].node_ref,
    action:'press'}),/WORKER_REQUEST_REPLAY_BLOCKED/);
 }finally{h.dispose();}
});
function post(port,path,urlToken,data){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path,method:'POST',
   headers:{authorization:'Bearer '+urlToken,'content-type':'application/json'}},res=>{
    let out='';res.setEncoding('utf8');res.on('data',x=>out+=x);
    res.on('end',()=>resolve({status:res.statusCode,result:JSON.parse(out)}));
  });
  req.on('error',reject);req.end(JSON.stringify(data));
 });
}
test('loopback HTTP protocol requires bearer token and verified guest readiness',async()=>{
 const h=harness();
 const server=createHttpServer(h.worker,'x'.repeat(48));
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const bad=await post(port,'/v1/status','wrong',{});
  assert.equal(bad.status,401);
  const ok=await post(port,'/v1/status','x'.repeat(48),{});
  assert.equal(ok.status,200);
  assert.equal(ok.result.data.background_mode,'separate_macos_machine');
  assert.equal(ok.result.data.host_input_events,'none');
 }finally{
  await new Promise(resolve=>server.close(resolve));h.dispose();
 }
});
test('guest screenshots are loopback-only and do not capture the operator Mac',async()=>{
 const h=harness();
 const tinyPng=Buffer.from('89504e470d0a1a0a','hex').toString('base64');
 const server=createHttpServer(h.worker,'x'.repeat(48),{
   screenshotHandler:()=>({mime_type:'image/png',base64:tinyPng,
     provider:'isolated_macos_screenshot'})
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const ok=await post(port,'/v1/screenshot','x'.repeat(48),{});
  assert.equal(ok.status,200);
  assert.equal(ok.result.data.provider,'isolated_macos_screenshot');
  const denied=await post(port,'/v1/screenshot','invalid',{});
  assert.equal(denied.status,401);
 }finally{await new Promise(resolve=>server.close(resolve));h.dispose();}
});
