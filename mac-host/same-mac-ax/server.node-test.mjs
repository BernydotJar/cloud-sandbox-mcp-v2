import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createSameMacWorker,createLedger,createServer} from './server.mjs';

const machine='a'.repeat(64),bundle='com.lch.SameMacAXFixture';
const raw={provider:'same_mac_background_ax',revision:'b'.repeat(64),
  frontmost_unchanged:true,nodes:[
    {path:[0,1],role:'AXTextField',name:'Hours',enabled:true,
      fingerprint:'c'.repeat(64),value_observation:{kind:'hours_numeric',value:'0',has_value:true}},
    {path:[0,2],role:'AXButton',name:'Apply',enabled:true,
      fingerprint:'d'.repeat(64)}
  ]};
function harness({press=[],foregroundChanged=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'same-mac-ax-test-'));
  const ledger=createLedger(path.join(dir,'events.jsonl'));
  const runs=[];
  const worker=createSameMacWorker({ledger,allowedBundles:[bundle],
    pressBundles:press,guiSession:true,axPermission:true,
    machineDigest:machine,expectedMachineDigest:machine,
    runner:input=>{
      runs.push(input);
      if(input.operation==='snapshot')return raw;
      return {dispatched:true,frontmost_unchanged:!foregroundChanged};
    }});
  return {worker,ledger,runs,dir,
    clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('worker runs on the same physical Mac and never represents a separate desktop',()=>{
  const h=harness();
  try{
    const status=h.worker.status();
    assert.equal(status.same_machine_verified,true);
    assert.equal(status.not_isolated_session,true);
    assert.equal(status.no_global_keystrokes,true);
    assert.equal(status.no_activate_calls,true);
    assert.equal(status.ready,true);
    assert.throws(()=>createSameMacWorker({
      runner:()=>{},ledger:h.ledger,
      allowedBundles:[bundle],machineDigest:machine,
      expectedMachineDigest:'f'.repeat(64)
    }),/SAME_MAC_CONFIG_INVALID/);
  }finally{h.clean();}
});
test('background AX snapshot returns opaque refs, labels, safe hours and hides arbitrary values',()=>{
  const h=harness();
  try{
    const snap=h.worker.snapshot({bundle_id:bundle,window_title:'Same Mac AX Fixture'});
    assert.equal(snap.nodes[0].name,'Hours');
    assert.equal(snap.nodes[0].value_observation.value,'0');
    assert.equal(snap.frontmost_unchanged,true);
    assert.equal(snap.nodes[0].node_ref.length,64);
    assert(!JSON.stringify(snap).includes('path'));
  }finally{h.clean();}
});
test('one-shot direct AX value change succeeds without global keyboard and is not replayable',()=>{
  const h=harness();
  try{
    const target={bundle_id:bundle,window_title:'Same Mac AX Fixture'};
    const snap=h.worker.snapshot(target);
    const action={...target,action:'set_value',request_id:'e'.repeat(64),
      node_ref:snap.nodes[0].node_ref,expected_revision:snap.revision,value:'8'};
    const done=h.worker.action(action);
    assert.equal(done.frontmost_unchanged,true);
    assert.equal(done.persistence,'UNVERIFIED_REQUIRE_READBACK');
    assert.equal(h.runs[1].operation,'set_value');
    assert(!('key' in h.runs[1]));
    assert.throws(()=>h.worker.action(action),/SAME_MAC_ACTION_REPLAY_BLOCKED/);
    assert(!fs.readFileSync(path.join(h.dir,'events.jsonl'),'utf8').includes('"8"'));
  }finally{h.clean();}
});
test('uncertain foreground change is reported, never retried automatically',()=>{
  const h=harness({foregroundChanged:true});
  try{
    const target={bundle_id:bundle,window_title:'Same Mac AX Fixture'};
    const snap=h.worker.snapshot(target);
    const action={...target,action:'set_value',request_id:'e'.repeat(64),
      node_ref:snap.nodes[0].node_ref,expected_revision:snap.revision,value:'8'};
    assert.throws(()=>h.worker.action(action),
      /SAME_MAC_AX_ACTION_UNCERTAIN_INSPECT_BEFORE_RETRY/);
    assert.equal(h.ledger.get(action.request_id).state,'failed');
    assert.throws(()=>h.worker.action(action),/SAME_MAC_ACTION_REPLAY_BLOCKED/);
  }finally{h.clean();}
});
test('background AXPress remains disabled until explicitly certified for that application',()=>{
  const h=harness();
  try{
    const target={bundle_id:bundle,window_title:'Same Mac AX Fixture'};
    const snap=h.worker.snapshot(target);
    assert.throws(()=>h.worker.action({...target,action:'press',
      request_id:'e'.repeat(64),node_ref:snap.nodes[1].node_ref,
      expected_revision:snap.revision}),/SAME_MAC_AX_PRESS_NOT_CERTIFIED/);
    assert.equal(h.runs.length,1);
  }finally{h.clean();}
  const permitted=harness({press:[bundle]});
  try{
    const target={bundle_id:bundle,window_title:'Same Mac AX Fixture'};
    const snap=permitted.worker.snapshot(target);
    const action={...target,action:'press',request_id:'e'.repeat(64),
      node_ref:snap.nodes[1].node_ref,expected_revision:snap.revision};
    assert.equal(permitted.worker.action(action).dispatched,true);
  }finally{permitted.clean();}
});
test('untrusted raw AX values are rejected',()=>{
  const h=harness();
  try{
    raw.nodes[0].AXValue='secret';
    assert.throws(()=>h.worker.snapshot({bundle_id:bundle,
      window_title:'Same Mac AX Fixture'}),/SAME_MAC_AX_INVALID_NODE/);
  }finally{delete raw.nodes[0].AXValue;h.clean();}
});
function post(port,route,token,body={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:route,
    method:'POST',headers:{authorization:'Bearer '+token,
      'content-type':'application/json'}},res=>{
    let out='';res.on('data',x=>out+=x);
    res.on('end',()=>resolve({status:res.statusCode,result:JSON.parse(out)}));
  });req.on('error',reject);req.end(JSON.stringify(body));
 });
}
test('authenticated local HTTP refuses missing token and accepts same-Mac status',async()=>{
  const h=harness();
  const server=createServer(h.worker,'k'.repeat(48));
  try{
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const port=server.address().port;
    assert.equal((await post(port,'/v1/status','bad')).status,401);
    const value=await post(port,'/v1/status','k'.repeat(48));
    assert.equal(value.status,200);
    assert.equal(value.result.data.background_scope,'AX_SEMANTIC_ONLY');
  }finally{await new Promise(done=>server.close(done));h.clean();}
});
test('browser identity strips no security checks and does not invalidate snapshot node references',()=>{
 const machine='a'.repeat(64),browser='com.microsoft.edgemac',title='Test - Microsoft Edge';
 const worker=createSameMacWorker({ledger:{get:()=>undefined,append:()=>{}},allowedBundles:[browser],machineDigest:machine,expectedMachineDigest:machine,
  runner:r=>r.operation==='identity'?{browser_url:'https://example.test/',window_title:title,frontmost_unchanged:true}:raw});
 assert.equal(worker.identity({bundle_id:browser,window_title:title}).browser_url,'https://example.test/');
 const bad=createSameMacWorker({ledger:{get:()=>undefined,append:()=>{}},allowedBundles:[browser],machineDigest:machine,expectedMachineDigest:machine,
  runner:()=>({browser_url:'https://user:secret@example.test/?token=x',window_title:title,frontmost_unchanged:true})});
 assert.throws(()=>bad.identity({bundle_id:browser,window_title:title}),/INVALID_IDENTITY/);
});
test('writable textarea metadata does not certify actual Teams editor commits',()=>{
 const machine='a'.repeat(64);const worker=createSameMacWorker({ledger:{get:()=>undefined,append:()=>{}},allowedBundles:['com.microsoft.edgemac'],machineDigest:machine,expectedMachineDigest:machine,processTextEnabled:true,
  runner:()=>({...raw,nodes:[{...raw.nodes[0],role:'AXTextArea',value_settable:true}]})});
 const snapshot=worker.snapshot({bundle_id:'com.microsoft.edgemac',window_title:'Own chat'});
 assert.equal(snapshot.nodes[0].fill_backend,'process_unicode');
});
