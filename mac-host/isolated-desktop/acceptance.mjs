#!/usr/bin/env node
/**
 * Operator-Mac acceptance against an ALREADY ISOLATED guest over SSH
 * loopback forwarding. Does not operate apps or send input on this Mac.
 * The only mutation is to the disposable fixture inside the guest.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {execFileSync} from 'node:child_process';
import {platformUuidFromIoreg,machineDigest,assertDistinctMachines} from './identity.mjs';

const say=(k,v)=>console.log('[CUA Background Acceptance] '+k+'='+String(v));
const fixture={bundle_id:'com.lch.SandboxAXFixture',
  window_title:'Sandbox AX Fixture'};
function operatorIdentity(){
  const raw=execFileSync('/usr/sbin/ioreg',
    ['-rd1','-c','IOPlatformExpertDevice'],
    {encoding:'utf8',timeout:5000,maxBuffer:18000});
  return machineDigest(platformUuidFromIoreg(raw));
}
function tokenFromFile(){
  const filename=process.env.MAC_CUA_WORKER_TOKEN_FILE||
    path.join(os.homedir(),'Library/Application Support/LCH/IsolatedMacCUA/worker-client-token');
  const st=fs.lstatSync(filename);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
     (st.mode&0o077)!==0)throw Error('WORKER_TOKEN_FILE_UNSAFE');
  const token=fs.readFileSync(filename,'utf8').trim();
  if(token.length<32)throw Error('WORKER_TOKEN_INVALID');
  return token;
}
function baseUrl(){
  const url=new URL(process.env.MAC_CUA_WORKER_URL||'http://127.0.0.1:9777');
  if(url.protocol!=='http:'||url.port!=='9777'||
     url.hostname!=='127.0.0.1'||url.pathname!=='/'||
     url.search||url.hash||url.username||url.password)
    throw Error('SSH_LOOPBACK_FORWARD_REQUIRED');
  return url;
}
async function request(base,token,endpoint,input={}){
  const res=await fetch(new URL(endpoint,base),{
    method:'POST',headers:{authorization:'Bearer '+token,
      'content-type':'application/json'},
    body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  const reply=await res.json();
  if(!res.ok||reply?.ok!==true)
    throw Error(String(reply?.error||'WORKER_REQUEST_FAILED').slice(0,100));
  return reply.data;
}
function unique(nodes,role,name){
  const matches=nodes.filter(n=>n.role===role&&n.name.toLowerCase()===name.toLowerCase()&&n.enabled);
  if(matches.length!==1)throw Error('AX_FIXTURE_TARGET_NOT_UNIQUE');
  return matches[0];
}
async function verifyRun(){
  const token=tokenFromFile();
  const base=baseUrl();
  const operator=operatorIdentity();
  const status=await request(base,token,'/v1/status');
  assertDistinctMachines(operator,status.worker_machine);
  if(!status.ready||!status.gui_session||!status.ax_permission||
     status.background_mode!=='separate_macos_machine')
    throw Error('ISOLATED_WORKER_NOT_READY');
  say('WORKER_SEPARATE_MAC','PASS');
  const start=await request(base,token,'/v1/snapshot',fixture);
  if(start.provider!=='isolated_mac_ax')throw Error('NATIVE_AX_NOT_AVAILABLE');
  const hours=unique(start.nodes,'AXTextField','Hours');
  await request(base,token,'/v1/action',{
    ...fixture,action:'set_value',node_ref:hours.node_ref,
    expected_revision:start.revision,
    request_id:crypto.randomBytes(32).toString('hex'),
    reason:'Set hours only in the isolated disposable fixture',value:'8'
  });
  const updated=await request(base,token,'/v1/snapshot',fixture);
  const observed=unique(updated.nodes,'AXTextField','Hours');
  if(observed.value_observation?.kind!=='hours_numeric'||
     observed.value_observation?.value!=='8')
    throw Error('AX_VALUE_READBACK_FAILED');
  say('AX_TARGETED_EDIT_AND_READBACK','PASS');
  const apply=unique(updated.nodes,'AXButton','Apply');
  await request(base,token,'/v1/action',{
    ...fixture,action:'press',node_ref:apply.node_ref,
    expected_revision:updated.revision,
    request_id:crypto.randomBytes(32).toString('hex'),
    reason:'Persist eight hours only in the disposable guest fixture'
  });
  const persisted=await request(base,token,'/v1/fixture-state');
  if(persisted.persisted!==true||persisted.saved_hours!=='8'||
     persisted.fixture_only!==true)
    throw Error('PERSISTED_FIXTURE_READBACK_FAILED');
  say('GUEST_PERSISTED_READBACK','PASS');
  say('NO_HOST_KEYBOARD_OR_POINTER_API','PASS_BY_ISOLATED_TRANSPORT');
  say('PERSONAL_DESKTOP_FOCUS_EVIDENCE','REQUIRES_OBSERVED_HOST_SENTINEL');
  say('CORPORATE_TIMESHEETS_TOUCHED','NO');
  say('RESULT','FUNCTIONAL_AX_GUEST_PASS_NOT_FULL_P0');
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname){
  if(process.argv[2]==='--inspect'){
    say('REQUIRES','SEPARATE_MAC_GUEST_GUI_AND_SSH_FORWARD');
    say('NO_MAC_CHANGES','YES');
  }else if(process.argv[2]==='--accept'&&process.platform==='darwin'){
    verifyRun().catch(e=>{say('STOP',String(e.message||'UNKNOWN'));process.exitCode=2;});
  }else{say('STOP','MAC_OPERATOR_AND_EXPLICIT_ACCEPT_REQUIRED');process.exitCode=2;}
}
