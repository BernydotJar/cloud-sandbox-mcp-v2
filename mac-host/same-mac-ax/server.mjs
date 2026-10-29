import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {machineDigest,platformUuidFromIoreg} from './identity.mjs';

const allowedRole={
  set_value:new Set(['AXTextField','AXTextArea','AXComboBox']),
  press:new Set(['AXButton','AXLink','AXCheckBox','AXRadioButton','AXPopUpButton','AXMenuItem','AXRow'])
};
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const hex=/^[a-f0-9]{64}$/;
const bundleRegex=/^[a-zA-Z0-9.-]{8,120}$/;
const allowedProps=new Set(['kind','value','has_value','length','sha256']);
const noRecord=()=>({provider:'same_mac_background_ax',
  no_global_keystrokes:true,no_pointer_events:true,
  no_activate_calls:true,not_isolated_session:true});
export function validObservation(v,role){
  if(v===undefined)return undefined;
  if(!v||typeof v!=='object'||Array.isArray(v)||
    Object.keys(v).some(k=>!allowedProps.has(k)))
    throw Error('SAME_MAC_AX_INVALID_VALUE');
  if(v.kind==='hours_numeric'&&
    allowedRole.set_value.has(role)&&
    typeof v.value==='string'&&
    /^[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(v.value)&&
    Number(v.value)<=168&&v.has_value===true)
    return {kind:v.kind,value:v.value,has_value:true};
  if(v.kind==='boolean'&&['AXCheckBox','AXRadioButton'].includes(role)&&
    typeof v.value==='boolean'&&v.has_value===undefined)
    return {kind:v.kind,value:v.value};
  if(v.kind==='text_digest'&&typeof v.sha256==='string'&&hex.test(v.sha256)&&Number.isInteger(v.length)&&v.length>0&&v.length<=10000000&&v.has_value===true&&v.value===undefined)
    return {kind:v.kind,length:v.length,sha256:v.sha256,has_value:true};
  if(v.kind==='empty'&&v.value===undefined&&v.has_value===false)
    return {kind:v.kind,has_value:false};
  if(v.kind==='redacted'&&v.value===undefined&&v.has_value===true)
    return {kind:v.kind,has_value:true};
  throw Error('SAME_MAC_AX_INVALID_VALUE');
}
export function createLedger(filename,{persist=true}={}){
  const seen=new Map();
  if(persist&&fs.existsSync(filename)){
    const stat=fs.lstatSync(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||
      stat.uid!==process.getuid()||(stat.mode&0o077)!==0)
      throw Error('SAME_MAC_LEDGER_UNTRUSTED');
    const content=fs.readFileSync(filename,'utf8');
    if(Buffer.byteLength(content)>4_000_000)throw Error('SAME_MAC_LEDGER_LIMIT');
    for(const line of content.split('\n')){
      if(!line.trim())continue;
      const rec=JSON.parse(line);
      if(!hex.test(rec.request_id)||!['intent','dispatched','failed'].includes(rec.state))
        throw Error('SAME_MAC_LEDGER_INVALID');
      seen.set(rec.request_id,rec);
    }
  }
  return {
    get:id=>seen.get(id),
    append:event=>{
      if(!hex.test(event.request_id)||!['intent','dispatched','failed'].includes(event.state))
        throw Error('SAME_MAC_LEDGER_INVALID');
      if(persist){
        const fd=fs.openSync(filename,'a',0o600);
        try{fs.writeSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd);}
        finally{fs.closeSync(fd);}
      }
      seen.set(event.request_id,event);
    }
  };
}
export function readNativeHealth({runner,textRunner,processTextEnabled=false}){
  const ax=runner({operation:'health'}).ax_permission===true;
  let processText=false;
  if(ax&&processTextEnabled){
    try{
      const h=textRunner();
      processText=h.ax_permission===true&&h.post_event_access===true;
    }catch{/* Ordinary AX remains available if only the text helper is unavailable. */}
  }
  return {ax_permission:ax,process_text_ready:processText};
}
export function createSameMacWorker({runner,ledger,allowedBundles,pressBundles=[],
  machineDigest:machineId,expectedMachineDigest:expectedMachineId,
  now=()=>Date.now(),guiSession=true,axPermission=true,processTextEnabled=false,healthProbe=null}){
  if(typeof runner!=='function'||!ledger||
     !hex.test(machineId)||machineId!==expectedMachineId||
     !Array.isArray(allowedBundles)||!allowedBundles.length||
     allowedBundles.some(b=>!bundleRegex.test(b))||
     !Array.isArray(pressBundles)||pressBundles.some(b=>!allowedBundles.includes(b)))
    throw Error('SAME_MAC_CONFIG_INVALID');
  const refs=new Map();
  let currentAxPermission=axPermission;
  let currentProcessTextEnabled=processTextEnabled;
  function ready(){
    if(healthProbe){
      try {
        const health=healthProbe();
        currentAxPermission=health?.ax_permission===true;
        currentProcessTextEnabled=processTextEnabled&&currentAxPermission&&health?.process_text_ready===true;
      }catch{currentAxPermission=false;currentProcessTextEnabled=false;}
    }
    return guiSession===true&&currentAxPermission===true;
  }
  function status(){
    return {...noRecord(),same_machine_verified:true,
      mac_machine_digest:machineId,
      ready:ready(),gui_session:guiSession,ax_permission:currentAxPermission,
      background_scope:currentProcessTextEnabled?'AX_WITH_CERTIFIED_PROCESS_TEXT':'AX_SEMANTIC_ONLY',
      simulated_keyboard:currentProcessTextEnabled,process_scoped_keyboard:currentProcessTextEnabled,
      focus_preservation:'checked_before_after_not_universal_guarantee',
      supported:['status','windows','snapshot','set_value',...(currentProcessTextEnabled?['process_unicode']:[]),
        ...(pressBundles.length?['press_certified']:[])],
      allowed_bundle_count:allowedBundles.length};
  }
  function validateTarget(input){
    if(!input||typeof input!=='object'||
       !allowedBundles.includes(input.bundle_id)||
       typeof input.window_title!=='string'||input.window_title.length<1||
       input.window_title.length>120)
      throw Error('SAME_MAC_TARGET_DENIED');
    return {bundle_id:input.bundle_id,window_title:input.window_title};
  }
  function windows(input){
    if(!ready())throw Error('SAME_MAC_AX_NOT_READY');
    if(!input||!allowedBundles.includes(input.bundle_id))throw Error('SAME_MAC_TARGET_DENIED');
    const raw=runner({operation:'windows',bundle_id:input.bundle_id,window_title:'discovery'});
    if(!raw||!Array.isArray(raw.windows)||raw.windows.length>50||raw.windows.some(t=>typeof t!=='string'||t.length>300)||raw.frontmost_unchanged!==true)throw Error('SAME_MAC_AX_INVALID_WINDOWS');
    return {...noRecord(),windows:raw.windows,frontmost_unchanged:true};
  }
  function snapshot(input){
    if(!ready())throw Error('SAME_MAC_AX_NOT_READY');
    const target=validateTarget(input);
    const raw=runner({operation:'snapshot',...target});
    if(!raw||raw.provider!=='same_mac_background_ax'||
       !hex.test(raw.revision)||!Array.isArray(raw.nodes)||
       raw.nodes.length>350||raw.frontmost_unchanged!==true)
      throw Error('SAME_MAC_AX_INVALID_SNAPSHOT');
    refs.clear();
    const seen=new Set();
    const entries=[];
    for(const node of raw.nodes){
      if(!node||!Array.isArray(node.path)||node.path.length>30||
         node.path.some(i=>!Number.isInteger(i)||i<0||i>=120)||
         !hex.test(node.fingerprint)||typeof node.name!=='string'||
         node.name.length>120||typeof node.role!=='string'||
         node.role.length>50||typeof node.enabled!=='boolean'||
         ['value','AXValue','raw_value'].some(k=>Object.hasOwn(node,k)))
        throw Error('SAME_MAC_AX_INVALID_NODE');
      const key=node.path.join('.');
      if(seen.has(key))throw Error('SAME_MAC_AX_DUPLICATE_NODE');
      seen.add(key);
      const value=validObservation(node.value_observation,node.role);
      const ref=crypto.randomBytes(32).toString('hex');
      refs.set(ref,{target,node,revision:raw.revision,
        expires:now()+30_000,used:false});
      entries.push({node_ref:ref,role:node.role,
        name:node.name,enabled:node.enabled,
        ...(currentProcessTextEnabled&&target.bundle_id==='com.microsoft.edgemac'&&node.role==='AXTextArea'?{fill_backend:'process_unicode'}:{}),
        ...(typeof node.press_available==='boolean'?{press_available:node.press_available}:{}),
        ...(value?{value_observation:value}:{})});
    }
    return {...noRecord(),revision:raw.revision,
      expires_in_ms:30000,nodes:entries,frontmost_unchanged:true};
  }
  function action(input){
    if(!ready())throw Error('SAME_MAC_AX_NOT_READY');
    const target=validateTarget(input);
    if(!hex.test(input.request_id)||!hex.test(input.node_ref)||
       !hex.test(input.expected_revision)||
       !['press','set_value'].includes(input.action))
      throw Error('SAME_MAC_AX_ACTION_INVALID');
    if(ledger.get(input.request_id))throw Error('SAME_MAC_ACTION_REPLAY_BLOCKED');
    const ref=refs.get(input.node_ref);
    if(!ref||ref.used||ref.expires<now()||
       ref.revision!==input.expected_revision||
       ref.target.bundle_id!==target.bundle_id||
       ref.target.window_title!==target.window_title||
       !ref.node.enabled)
      throw Error('SAME_MAC_AX_STALE_TARGET');
    if(!allowedRole[input.action].has(ref.node.role))
      throw Error('SAME_MAC_AX_ACTION_UNSUPPORTED');
    if(input.action==='set_value'&&
       (typeof input.value!=='string'||input.value.length>2000))
      throw Error('SAME_MAC_AX_VALUE_INVALID');
    if(input.action==='press'&&ref.node.role==='AXRow'&&ref.node.press_available!==true)throw Error('SAME_MAC_AX_ACTION_UNSUPPORTED');
    if(input.action==='press'&&!pressBundles.includes(target.bundle_id))
      throw Error('SAME_MAC_AX_PRESS_NOT_CERTIFIED');
    if(input.text_method==='process_unicode'&&(!currentProcessTextEnabled||target.bundle_id!=='com.microsoft.edgemac'||ref.node.role!=='AXTextArea'))throw Error('SAME_MAC_PROCESS_TEXT_NOT_CERTIFIED');
    // Record intent before any action, then mark the one-shot reference used.
    // A crash or ambiguous result is never automatically replayed.
    const base={request_id:input.request_id,
      utc:new Date(now()).toISOString(),action:input.action,
      target_sha256:sha(target.bundle_id+'|'+target.window_title)};
    ledger.append({...base,state:'intent'});
    ref.used=true;
    try{
      const result=runner({operation:input.action,...target,
        expected_revision:ref.revision,path:ref.node.path,
        fingerprint:ref.node.fingerprint,
        ...(input.action==='press'?{allow_press:true}:{value:input.value,...(input.text_method==='process_unicode'?{text_method:'process_unicode',expected_text:ref.node.value_observation}:{}),...(input.text_method==='selected_text'?{text_method:'selected_text'}:{}),...(input.focus_element===true?{focus_element:true}:{})})});
      if(result?.dispatched!==true||result.frontmost_unchanged!==true)
        throw Error('SAME_MAC_AX_DISPATCH_UNCERTAIN');
      ledger.append({...base,state:'dispatched'});
      return {...noRecord(),dispatched:true,
        frontmost_unchanged:true,request_id:input.request_id,
        ...(result.input_backend==='process_unicode'?{input_backend:result.input_backend,global_event_posts:0}:{}),
        persistence:'UNVERIFIED_REQUIRE_READBACK'};
    }catch{
      ledger.append({...base,state:'failed'});
      throw Error('SAME_MAC_AX_ACTION_UNCERTAIN_INSPECT_BEFORE_RETRY');
    }
  }
  return {status,windows,snapshot,action};
}
export function createServer(worker,token){
  if(typeof token!=='string'||token.length<32)throw Error('SAME_MAC_TOKEN_INVALID');
  return http.createServer(async(req,res)=>{
    const send=(status,data)=>{
      res.writeHead(status,{'content-type':'application/json',
        'cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end(JSON.stringify(data));
    };
    if(!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)){
      send(403,{ok:false,error:'SAME_MAC_LOCAL_ONLY'});return;
    }
    const supplied=req.headers.authorization;
    const a=typeof supplied==='string'&&supplied.startsWith('Bearer ')?Buffer.from(supplied.slice(7)) : Buffer.alloc(0);
    const b=Buffer.from(token);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){
      send(401,{ok:false,error:'SAME_MAC_AUTH_REQUIRED'});return;
    }
    if(req.method!=='POST'){
      send(405,{ok:false,error:'SAME_MAC_METHOD_DENIED'});return;
    }
    try{
      let size=0;const chunks=[];
      for await(const chunk of req){
        size+=chunk.length;
        if(size>12000)throw Error('SAME_MAC_BODY_LIMIT');
        chunks.push(chunk);
      }
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
      const actions={
        '/v1/status':()=>worker.status(),
        '/v1/windows':()=>worker.windows(body),
        '/v1/snapshot':()=>worker.snapshot(body),
        '/v1/action':()=>worker.action(body)
      };
      if(!Object.hasOwn(actions,req.url)){
        send(404,{ok:false,error:'SAME_MAC_ROUTE_UNKNOWN'});return;
      }
      send(200,{ok:true,data:actions[req.url]()});
    }catch(error){
      const code=String(error?.message||'SAME_MAC_REQUEST_FAILED');
      const safe=/^SAME_MAC_[A-Z_]{3,65}$/.test(code)?
        code:'SAME_MAC_REQUEST_FAILED';
      send(409,{ok:false,error:safe});
    }
  });
}
function localIdentity(){
  const info=execFileSync('/usr/sbin/ioreg',
    ['-rd1','-c','IOPlatformExpertDevice'],
    {encoding:'utf8',timeout:5000,maxBuffer:12000});
  return machineDigest(platformUuidFromIoreg(info));
}
function main(){
  if(process.platform!=='darwin'||process.argv.length!==3||
     process.argv[2]!=='--serve')
    throw Error('SAME_MAC_SERVICE_DARWIN_ONLY');
  const home=path.join(os.homedir(),
    'Library/Application Support/LCH/SameMacBackgroundAX');
  const filename=path.join(home,'config.json');
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
     (stat.mode&0o077)!==0)throw Error('SAME_MAC_CONFIG_UNTRUSTED');
  const cfg=JSON.parse(fs.readFileSync(filename,'utf8'));
  const tokenPath=path.join(home,'token');
  const tstat=fs.lstatSync(tokenPath);
  if(!tstat.isFile()||tstat.isSymbolicLink()||tstat.uid!==process.getuid()||
     (tstat.mode&0o077)!==0)throw Error('SAME_MAC_TOKEN_UNTRUSTED');
  const token=fs.readFileSync(tokenPath,'utf8').trim();
  const machineId=localIdentity();
  if(cfg.machine_digest!==machineId)throw Error('SAME_MAC_IDENTITY_MISMATCH');
  if(cfg.port!==9779)throw Error('SAME_MAC_INVALID_PORT');
  const binary=path.join(home,'bin','SameMacAX');
  const runBinary=(program,request)=>{
    const output=execFileSync(program,[],{input:JSON.stringify(request),encoding:'utf8',timeout:12000,maxBuffer:150000,stdio:['pipe','pipe','pipe']});
    const response=JSON.parse(output);if(response.ok!==true)throw Error('SAME_MAC_AX_NATIVE_FAILED');return response.data;
  };
  const runner=request=>{
    if(request.text_method==='process_unicode') {
      if(cfg.process_text_enabled!==true)throw Error('SAME_MAC_PROCESS_TEXT_NOT_CERTIFIED');
      runBinary(binary,{...request,operation:'validate_text'});
      return runBinary(path.join(home,'bin','BackgroundProcessText'),request);
    }
    let output;
    try { output=execFileSync(binary,[],{input:JSON.stringify(request),encoding:'utf8',timeout:12000,maxBuffer:150000,stdio:['pipe','pipe','pipe']}); }
    catch(error) {
      let code='FAILED';
      try { const reply=JSON.parse(String(error.stdout||'')); if(/^[A-Z_]{3,70}$/.test(reply.error))code=reply.error; } catch { /* Keep diagnostics content-free. */ }
      throw Error('SAME_MAC_NATIVE_'+code);
    }
    const response=JSON.parse(output);
    if(response.ok!==true)throw Error('SAME_MAC_AX_NATIVE_FAILED');
    return response.data;
  };
  // TCC and the responsible Node binary can change after startup (e.g. brew
  // cleanup removes a running Cellar executable). Never cache permission as ready.
  const healthProbe=()=>readNativeHealth({runner,
    textRunner:()=>runBinary(path.join(home,'bin','BackgroundProcessText'),{operation:'health'}),
    processTextEnabled:cfg.process_text_enabled===true});
  let aqua=false;
  try{
    aqua=execFileSync('/bin/launchctl',['managername'],
      {encoding:'utf8',timeout:4000}).trim()==='Aqua';
  }catch{/* fail closed */}
  const worker=createSameMacWorker({
    runner,ledger:createLedger(path.join(home,'audit.jsonl')),
    allowedBundles:cfg.allowed_bundles,
    pressBundles:cfg.press_certified_bundles||[],
    machineDigest:machineId,expectedMachineDigest:cfg.machine_digest,
    guiSession:aqua,axPermission:false,processTextEnabled:cfg.process_text_enabled===true,healthProbe
  });
  createServer(worker,token).listen(9779,'127.0.0.1',()=>{
    process.stdout.write('[Same Mac AX] LOOPBACK_READY=YES\n');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(error){
    process.stderr.write('[Same Mac AX] STOP='+String(error?.message||'UNKNOWN')+'\n');
    process.exitCode=2;
  }
}
