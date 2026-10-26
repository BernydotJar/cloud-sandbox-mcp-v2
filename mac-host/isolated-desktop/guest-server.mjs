import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {machineDigest,platformUuidFromIoreg,assertDistinctMachines} from './identity.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const validHex=/^[a-f0-9]{64}$/;
const validBundle=/^[a-zA-Z0-9.-]{8,120}$/;
const listenHost='127.0.0.1';
const allowedAction=new Set(['press','set_value']);
function reply(res,status,body){
  res.writeHead(status,{'content-type':'application/json',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(body));
}
function validToken(value,secret){
  if(typeof value!=='string'||!value.startsWith('Bearer '))return false;
  const a=Buffer.from(value.slice(7));
  const b=Buffer.from(secret);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export function createLedger(filename,{persist=true}={}){
  const events=[],byRequest=new Map();
  if(persist&&fs.existsSync(filename)){
    for(const line of fs.readFileSync(filename,'utf8').split('\n')){
      if(!line.trim())continue;
      const event=JSON.parse(line);
      if(!validHex.test(event.request)||!['intent','complete','failed'].includes(event.status))
        throw Error('WORKER_AUDIT_INVALID');
      byRequest.set(event.request,event);
      events.push(event);
    }
  }
  function record(event){
    if(persist){
      const fd=fs.openSync(filename,'a',0o600);
      try{fs.writeSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd);}
      finally{fs.closeSync(fd);}
    }
    events.push(event);byRequest.set(event.request,event);
  }
  return {events,lookup:id=>byRequest.get(id),record};
}
export function createWorker({token,identity,operatorIdentity,allowedBundles,
  runner,ledger,now=()=>Date.now(),guiSession=true,axPermission=true}){
  if(!validHex.test(identity)||!validHex.test(operatorIdentity)||
    !assertDistinctMachines(identity,operatorIdentity)||
    typeof token!=='string'||token.length<32||!Array.isArray(allowedBundles)||
    allowedBundles.some(b=>!validBundle.test(b))||!runner||!ledger)
    throw Error('WORKER_CONFIG_INVALID');
  const references=new Map();
  function snapshot(input){
    if(!input||!allowedBundles.includes(input.bundle_id)||
       typeof input.window_title!=='string'||input.window_title.length<1||
       input.window_title.length>120)throw Error('WORKER_TARGET_DENIED');
    const raw=runner({operation:'snapshot',bundle_id:input.bundle_id,
      window_title:input.window_title});
    if(!raw||!validHex.test(raw.revision)||!Array.isArray(raw.nodes)||
       raw.nodes.length>360)throw Error('WORKER_AX_INVALID');
    references.clear();
    const nodes=raw.nodes.map(node=>{
      if(!node||!Array.isArray(node.path)||node.path.length>10||
         node.path.some(n=>!Number.isInteger(n)||n<0||n>=100)||
         typeof node.role!=='string'||typeof node.name!=='string'||
         typeof node.enabled!=='boolean'||!validHex.test(node.fingerprint))
        throw Error('WORKER_AX_INVALID');
      const ref=crypto.randomBytes(32).toString('hex');
      references.set(ref,{created:now(),input:{...input},node,revision:raw.revision,
        consumed:false});
      const observed=node.value_observation;
      if(observed!==undefined) {
        if(!observed||typeof observed!=='object'||Array.isArray(observed)||
          Object.keys(observed).some(k=>!['kind','value','has_value'].includes(k)))
          throw Error('WORKER_AX_INVALID');
        const valid=(observed.kind==='hours_numeric' &&
          ['AXTextField','AXTextArea','AXComboBox'].includes(node.role) &&
          typeof observed.value==='string' &&
          /^[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(observed.value) &&
          Number(observed.value)<=168 && observed.has_value===true) ||
          (observed.kind==='boolean' &&
            ['AXCheckBox','AXRadioButton'].includes(node.role) &&
            typeof observed.value==='boolean' && observed.has_value===undefined) ||
          (observed.kind==='empty' && observed.value===undefined &&
            observed.has_value===false) ||
          (observed.kind==='redacted' && observed.value===undefined &&
            observed.has_value===true);
        if(!valid)throw Error('WORKER_AX_INVALID');
      }
      return {node_ref:ref,role:node.role,name:node.name,enabled:node.enabled,
        ...(observed?{value_observation:observed}:{})};
    });
    return {provider:'isolated_mac_ax',revision:raw.revision,
      expires_in_ms:30000,nodes,isolated_machine:identity};
  }
  function action(input){
    if(!input||!validHex.test(input.request_id)||!validHex.test(input.node_ref)||
       !validHex.test(input.expected_revision)||!allowedAction.has(input.action)||
       !allowedBundles.includes(input.bundle_id)||
       typeof input.window_title!=='string'||input.window_title.length<1||
       input.window_title.length>120)throw Error('WORKER_ACTION_INVALID');
    const previous=ledger.lookup(input.request_id);
    if(previous)throw Error('WORKER_REQUEST_REPLAY_BLOCKED');
    const ref=references.get(input.node_ref);
    if(!ref||ref.consumed||now()-ref.created>30000||
       ref.revision!==input.expected_revision||
       ref.input.bundle_id!==input.bundle_id||
       ref.input.window_title!==input.window_title||
       !ref.node.enabled)throw Error('WORKER_AX_STALE_TARGET');
    if(input.action==='press'&&
       !['AXButton','AXLink','AXCheckBox','AXRadioButton','AXPopUpButton','AXMenuItem']
         .includes(ref.node.role))throw Error('WORKER_ROLE_DENIED');
    if(input.action==='set_value'&&
       (!['AXTextField','AXTextArea','AXComboBox'].includes(ref.node.role)||
         typeof input.value!=='string'||input.value.length<1||
         input.value.length>2000))throw Error('WORKER_VALUE_INVALID');
    // No input text is ever written to the ledger.
    const event={request:input.request_id,status:'intent',utc:new Date(now()).toISOString(),
      target_sha256:sha(input.bundle_id+'|'+input.window_title),
      action:input.action};
    ledger.record(event);
    ref.consumed=true;
    try{
      const result=runner({operation:input.action,bundle_id:input.bundle_id,
        window_title:input.window_title,expected_revision:ref.revision,
        path:ref.node.path,fingerprint:ref.node.fingerprint,
        ...(input.action==='set_value'?{value:input.value}:{})});
      if(result?.dispatched!==true)throw Error('WORKER_ACTION_UNVERIFIED');
      ledger.record({...event,status:'complete'});
      return {dispatched:true,isolated_machine:identity,
        business_effect:'UNVERIFIED_REQUIRE_READBACK',receipt:input.request_id};
    }catch{
      ledger.record({...event,status:'failed'});
      throw Error('WORKER_ACTION_FAILED_INSPECT_BEFORE_RETRY');
    }
  }
  function status(){
    return {provider:'isolated_mac_ax',worker_machine:identity,
      operator_machine_distinct:true,gui_session:guiSession,
      ax_permission:axPermission,ready:guiSession&&axPermission,
      background_mode:'separate_macos_machine',
      supported:['snapshot','press','set_value'],
      host_input_events:'none'};
  }
  return {status,snapshot,action};
}
function captureGuestDesktop(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isolated-mac-capture-'));
  const file=path.join(dir,'guest.png');
  try{
    execFileSync('/usr/sbin/screencapture',['-x','-t','png',file],{
      timeout:15000,maxBuffer:2000,stdio:['ignore','pipe','ignore']});
    const data=fs.readFileSync(file);
    if(data.length<8||data.length>8000000||
       data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')
      throw Error('GUEST_SCREENSHOT_UNAVAILABLE');
    return {mime_type:'image/png',base64:data.toString('base64'),
      provider:'isolated_macos_screenshot'};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export function createHttpServer(worker,token,{fixtureReader,screenshotHandler}={}){
  const capture=screenshotHandler||captureGuestDesktop;
  const readFixture=fixtureReader||(()=>{
    const file=path.join(os.homedir(),
      'Library/Application Support/LCH/IsolatedMacCUA/fixture-hours.txt');
    const saved=fs.readFileSync(file,'utf8').trim();
    if(!/^[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(saved)||
      Number(saved)>168)throw Error('FIXTURE_PERSISTENCE_UNAVAILABLE');
    return {saved_hours:saved,persisted:true,fixture_only:true};
  });
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.socket.remoteAddress!=='127.0.0.1'&&
         req.socket.remoteAddress!=='::ffff:127.0.0.1'){
        reply(res,403,{error:'LOCAL_ONLY'});return;
      }
      if(req.method!=='POST'||!validToken(req.headers.authorization,token)){
        reply(res,401,{error:'WORKER_AUTH_REQUIRED'});return;
      }
      let total=0;const chunks=[];
      for await(const chunk of req){
        total+=chunk.length;
        if(total>12000){reply(res,413,{error:'WORKER_INPUT_LIMIT'});return;}
        chunks.push(chunk);
      }
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
      const handlers={'/v1/status':()=>worker.status(),
        '/v1/snapshot':()=>worker.snapshot(body),
        '/v1/action':()=>worker.action(body),
        '/v1/fixture-state':()=>readFixture(),
        '/v1/screenshot':()=>capture()};
      const handler=handlers[req.url];
      if(!handler){reply(res,404,{error:'UNKNOWN_WORKER_METHOD'});return;}
      const state=worker.status();
      if(!state.ready&&req.url!=='/v1/status')
        throw Error('WORKER_GUI_NOT_READY');
      reply(res,200,{ok:true,data:handler()});
    }catch(e){
      const allowed=new Set(['WORKER_TARGET_DENIED','WORKER_AX_INVALID',
        'WORKER_REQUEST_REPLAY_BLOCKED','WORKER_AX_STALE_TARGET',
        'WORKER_ROLE_DENIED','WORKER_VALUE_INVALID','WORKER_ACTION_INVALID',
        'WORKER_ACTION_FAILED_INSPECT_BEFORE_RETRY','WORKER_GUI_NOT_READY',
        'FIXTURE_PERSISTENCE_UNAVAILABLE','GUEST_SCREENSHOT_UNAVAILABLE']);
      reply(res,409,{ok:false,error:allowed.has(e.message)?e.message:'WORKER_FAILED'});
    }
  });
  return server;
}
function localIdentity(){
  const raw=execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],
    {encoding:'utf8',timeout:5000,maxBuffer:12000});
  return machineDigest(platformUuidFromIoreg(raw));
}
function main(){
  if(process.platform!=='darwin'||process.argv[2]!=='--serve')
    throw Error('MAC_GUI_GUEST_ONLY');
  const configPath=path.join(os.homedir(),
    'Library/Application Support/LCH/IsolatedMacCUA/worker.json');
  const state=fs.lstatSync(configPath);
  if(!state.isFile()||state.isSymbolicLink()||state.uid!==process.getuid()||
     (state.mode&0o077)!==0)throw Error('WORKER_CONFIG_UNSAFE');
  const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
  const tokenMeta=fs.lstatSync(cfg.token_file);
  if(!tokenMeta.isFile()||tokenMeta.isSymbolicLink()||
     tokenMeta.uid!==process.getuid()||(tokenMeta.mode&0o077)!==0)
    throw Error('WORKER_TOKEN_UNSAFE');
  const secret=fs.readFileSync(cfg.token_file,'utf8').trim();
  const local=localIdentity();
  assertDistinctMachines(cfg.operator_machine_digest,local);
  if(cfg.port!==9777)throw Error('WORKER_PORT_NOT_APPROVED');
  // Aqua GUI session must be available for AX permissions and app windows.
  const manager=execFileSync('/bin/launchctl',['managername'],
    {encoding:'utf8',timeout:5000}).trim();
  const guiSession=manager==='Aqua';
  const helper=path.join(here,'bin','GuestAX');
  const runner=req=>{
    const result=execFileSync(helper,[],{input:JSON.stringify(req),encoding:'utf8',
      timeout:10000,maxBuffer:160000,stdio:['pipe','pipe','ignore']});
    const parsed=JSON.parse(result);
    if(parsed.ok!==true)throw Error('WORKER_AX_FAILED');
    return parsed.data;
  };
  // Independent AX permission probe. The Swift helper checks TCC before
  // looking for a window. A missing disposable fixture is not permission
  // failure, but an AX TCC denial blocks the worker as not ready.
  let axPermission=false;
  try {
    execFileSync(helper,[],{input:JSON.stringify({
      operation:'snapshot',bundle_id:'com.lch.SandboxAXFixture',
      window_title:'Sandbox AX Fixture'
    }),encoding:'utf8',timeout:5000,maxBuffer:5000,stdio:['pipe','pipe','ignore']});
    axPermission=true;
  }catch(error){
    try{
      const result=JSON.parse(String(error.stdout||''));
      axPermission=result.error==='WORKER_APP_NOT_UNIQUE' ||
        result.error==='WORKER_WINDOW_NOT_UNIQUE';
    }catch{axPermission=false;}
  }
  const folder=path.dirname(configPath);
  const ledger=createLedger(path.join(folder,'worker-audit.jsonl'));
  const worker=createWorker({token:secret,identity:local,
    operatorIdentity:cfg.operator_machine_digest,
    allowedBundles:cfg.allowed_bundles,ledger,runner,
    guiSession,axPermission});
  createHttpServer(worker,secret).listen(9777,listenHost,()=>{
    process.stdout.write('[Isolated Mac CUA] LOOPBACK_READY=YES\n');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(e){
    process.stderr.write('[Isolated Mac CUA] STOP='+String(e.message||'UNKNOWN')+'\n');
    process.exitCode=2;
  }
}
