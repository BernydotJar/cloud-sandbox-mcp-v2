#!/usr/bin/env node
/**
 * Same-Mac live E2E acceptance: background AX on a disposable application.
 * Does not operate corporate apps, mutate browsers, move cursor, send keys,
 * or activate the fixture. Reads the saved fixture file after AXPress.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {waitForLocalAXStatus} from './startup-probe.mjs';

const root=path.join(os.homedir(),'Library/Application Support/LCH/SameMacBackgroundAX');
const target={bundle_id:'com.lch.SameMacAXFixture',
  window_title:'Same Mac AX Fixture'};
const log=(key,value)=>console.log('[Same Mac AX Acceptance] '+key+'='+String(value));
const post=async(endpoint,body={},token)=>{
  const res=await fetch('http://127.0.0.1:9779'+endpoint,{
    method:'POST',headers:{
      authorization:'Bearer '+token,'content-type':'application/json'
    },body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
  });
  const json=await res.json();
  if(!res.ok||json.ok!==true)
    throw Error(String(json.error||'AX_REQUEST_FAILED').slice(0,100));
  return json.data;
};
function safeToken(){
  const filename=path.join(root,'token');
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||
     stat.uid!==process.getuid()||(stat.mode&0o077)!==0)
    throw Error('AX_TOKEN_FILE_UNTRUSTED');
  const token=fs.readFileSync(filename,'utf8').trim();
  if(token.length<32)throw Error('AX_TOKEN_INVALID');
  return token;
}
function unique(nodes,role,name){
  const matching=nodes.filter(v=>v.role===role&&v.name===name&&v.enabled);
  if(matching.length!==1)throw Error('AX_SEMANTIC_TARGET_NOT_UNIQUE');
  return matching[0];
}
function store(report){
  const file=path.join(root,'acceptance-last.json');
  const temp=path.join(root,'.acceptance-'+crypto.randomUUID());
  try{
    fs.writeFileSync(temp,JSON.stringify(report,null,2)+'\n',
      {flag:'wx',mode:0o600});
    fs.renameSync(temp,file);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  log('EVIDENCE_FILE',file.replace(os.homedir(),'~'));
  const shared=path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    'mac-host-evidence');
  try {
    fs.mkdirSync(shared,{recursive:true,mode:0o700});
    const record=path.join(shared,'same-mac-background-last.json');
    const temporary=record+'.'+crypto.randomUUID();
    fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n',
      {flag:'wx',mode:0o600});
    fs.renameSync(temporary,record);
    log('SHARED_EVIDENCE','AVAILABLE_TO_SANDBOX_V3');
  }catch {
    log('SHARED_EVIDENCE','LOCAL_EVIDENCE_RETAINED');
  }
}
async function main(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  if(process.argv.length!==3||process.argv[2]!=='--run')
    throw Error('EXPLICIT_RUN_REQUIRED');
  const token=safeToken();
  const info=await waitForLocalAXStatus(token);
  if(info.provider!=='same_mac_background_ax'||
     info.same_machine_verified!==true)throw Error('SAME_MAC_PROVIDER_IDENTITY_MISMATCH');
  if(info.gui_session!==true)throw Error('SAME_MAC_AQUA_SESSION_NOT_READY');
  if(info.ax_permission!==true) {
    log('ACCESSIBILITY','ONE_TIME_PERMISSION_REQUIRED_FOR_BIN_SameMacAX');
    throw Error('SAME_MAC_ACCESSIBILITY_PERMISSION_REQUIRED');
  }
  if(info.ready!==true)throw Error('SAME_MAC_AX_NOT_READY');
  log('LOCAL_AX_READY','PASS');
  const fixture=path.join(root,'SameMacAXFixture.app');
  if(!fs.existsSync(fixture))throw Error('FIXTURE_MISSING');
  // -g asks LaunchServices not to bring the new app to foreground.
  // The app itself only orderBack()s its window, with accessory policy.
  execFileSync('/usr/bin/open',['-g','-a',fixture],{timeout:15000});
  let first;
  for(let n=0;n<20;n++){
    try{
      first=await post('/v1/snapshot',target,token);
      break;
    }catch(error){
      if(n===19)throw error;
      await sleep(250);
    }
  }
  const hours=unique(first.nodes,'AXTextField','Hours');
  const set=await post('/v1/action',{
    ...target,action:'set_value',node_ref:hours.node_ref,
    expected_revision:first.revision,request_id:crypto.randomBytes(32).toString('hex'),
    value:'8'
  },token);
  if(set.dispatched!==true||set.frontmost_unchanged!==true)
    throw Error('AX_BACKGROUND_CHANGE_UNVERIFIED');
  const after=await post('/v1/snapshot',target,token);
  const revised=unique(after.nodes,'AXTextField','Hours');
  if(revised.value_observation?.kind!=='hours_numeric'||
     revised.value_observation?.value!=='8')
    throw Error('AX_BACKGROUND_READBACK_FAILED');
  log('AX_VALUE_CHANGED_WITHOUT_FOCUS','PASS');
  const apply=unique(after.nodes,'AXButton','Apply');
  const press=await post('/v1/action',{
    ...target,action:'press',node_ref:apply.node_ref,
    expected_revision:after.revision,
    request_id:crypto.randomBytes(32).toString('hex')
  },token);
  if(press.dispatched!==true||press.frontmost_unchanged!==true)
    throw Error('AX_BACKGROUND_PRESS_UNVERIFIED');
  const file=path.join(root,'fixture-hours.txt');
  const saved=fs.readFileSync(file,'utf8').trim();
  if(saved!=='8')throw Error('AX_BACKGROUND_PERSISTENCE_FAILED');
  log('PERSISTED_READBACK','PASS');
  log('OS_KEYSTROKES_SENT','NONE');
  log('OS_MOUSE_EVENTS_SENT','NONE');
  log('VM_USED','NO');
  const result={status:'PASS_SAME_MAC_FIXTURE',
    completed_at:new Date().toISOString(),native_ax:true,
    ax_value_readback:true,ax_press_without_focus:true,
    stored_fixture_hours:8,operator_focus_not_taken:true,
    corporate_apps_touched:false,vm_used:false,
    limitation:'Other apps require their own AX compatibility validation'};
  store(result);
  log('RESULT','PASS_SAME_MAC_FIXTURE');
}
main().catch(error=>{
  log('STOP',String(error?.message||'UNKNOWN').slice(0,190));
  process.exitCode=2;
});
