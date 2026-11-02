#!/usr/bin/env node
/**
 * Current operator Mac only, read-only Omnissa Horizon host preflight.
 * No screenshot, remote Windows content, desktop activation or input.
 * No TCC consent prompts, installation, registry edits or VDI policy changes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SOURCE_SHA256='35f1a548038f838bf5f906d457fe1c59eacb8e1d0ebb478f7006ba3b50957062';
const tag=(key,value)=>process.stdout.write('[Omnissa VDI CUA Doctor] '+key+'='+String(value)+'\n');
const fail=(code)=>{throw Error(code);};
const base=path.dirname(fileURLToPath(import.meta.url));

export function classify(result){
  if(result?.schema!=='omnissa.vdi.host-readonly.v1' ||
     typeof result.running!=='boolean' ||
     typeof result.accessibility_trusted!=='boolean' ||
     typeof result.screen_capture_preflight!=='boolean' ||
     typeof result.foreground_unchanged!=='boolean' ||
     typeof result.captured_remote_content!=='boolean' ||
     typeof result.sent_input!=='boolean' ||
     result.captured_remote_content!==false || result.sent_input!==false ||
     !Number.isInteger(result.candidate_count) || result.candidate_count<0 || result.candidate_count>30 ||
     !Number.isInteger(result.window_count) || result.window_count<0 || result.window_count>24 ||
     !Number.isInteger(result.role_count) || result.role_count<0 || result.role_count>360 ||
     !Number.isInteger(result.interactive_role_count) ||
     result.interactive_role_count<0 || result.interactive_role_count>result.role_count ||
     typeof result.bundle_id!=='string' ||
     (result.bundle_id!=='' && !/^[A-Za-z0-9.-]{8,120}$/.test(result.bundle_id)))
    fail('INVALID_NATIVE_INSPECTION');
  if(!result.foreground_unchanged)return 'FOREGROUND_CHANGED_DURING_READ_STOP';
  if(!result.running)return 'OMNISSA_CLIENT_NOT_RUNNING';
  if(result.candidate_count!==1 || !result.bundle_id)
    return 'OMNISSA_APP_IDENTITY_AMBIGUOUS';
  if(!result.accessibility_trusted)return 'HOST_ACCESSIBILITY_PERMISSION_NOT_GRANTED';
  if(result.window_count===0)return 'NO_ACCESSIBLE_HORIZON_WINDOW';
  return 'HOST_AX_VISIBLE_WINDOWS_GUEST_SEMANTICS_UNVERIFIED';
}

function safelyRead(filename,{maxSize=20_000}={}){
  let stat;
  try{stat=fs.lstatSync(filename);}catch(error){
    if(error?.code==='ENOENT')return null;
    throw error;
  }
  if(!stat.isFile() || stat.isSymbolicLink() ||
     stat.uid!==process.getuid() || (stat.mode&0o077)!==0 ||
     stat.size<1 || stat.size>maxSize)
    fail('UNTRUSTED_SAME_MAC_SERVICE_FILE');
  return fs.readFileSync(filename);
}

async function sameMacAxStatus(bundle){
  const home=path.join(os.homedir(),
    'Library/Application Support/LCH/SameMacBackgroundAX');
  const settings=safelyRead(path.join(home,'config.json'));
  const secret=safelyRead(path.join(home,'token'),{maxSize:500});
  if(!settings || !secret)
    return {service:'NOT_INSTALLED_OR_UNAVAILABLE',bundleAuthorized:false};
  let config;
  try{config=JSON.parse(settings.toString('utf8'));}
  catch{return {service:'INVALID_CONFIG',bundleAuthorized:false};}
  if(!Array.isArray(config.allowed_bundles) ||
     config.port!==9779)return {service:'INVALID_CONFIG',bundleAuthorized:false};
  const bundleAuthorized=bundle!=='' && config.allowed_bundles.includes(bundle);
  const token=secret.toString('utf8').trim();
  if(token.length<32)return {service:'INVALID_TOKEN',bundleAuthorized};
  try{
    const response=await fetch('http://127.0.0.1:9779/v1/status',{
      method:'POST',redirect:'error',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:'{}',signal:AbortSignal.timeout(2500)
    });
    if(!response.ok)return {service:'STATUS_UNAVAILABLE',bundleAuthorized};
    const reply=await response.json();
    const data=reply?.data;
    if(!reply?.ok || data?.provider!=='same_mac_background_ax' ||
       data?.same_machine_verified!==true)
      return {service:'IDENTITY_UNVERIFIED',bundleAuthorized};
    return {
      service:data?.ready===true && data?.ax_permission===true &&
        data?.gui_session===true?'READY':'RUNNING_NOT_READY',
      bundleAuthorized
    };
  }catch{return {service:'NOT_RESPONDING',bundleAuthorized};}
}

async function main(){
  if(process.argv.length!==3 || process.argv[2]!=='--inspect')
    fail('USE_INSPECT_ONLY');
  if(process.platform!=='darwin')fail('MACOS_ONLY');
  if(process.getuid()===0)fail('RUN_AS_MAC_OPERATOR_NOT_ROOT');

  const swift=path.join(base,'OmnissaReadOnlyDoctor.swift');
  const stat=fs.lstatSync(swift);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>30_000)
    fail('UNTRUSTED_SWIFT_SOURCE');
  const digest=createHash('sha256').update(fs.readFileSync(swift)).digest('hex');
  if(digest!==SOURCE_SHA256)fail('SOURCE_INTEGRITY_MISMATCH');

  tag('MODE','READ_ONLY');
  tag('WINDOW_ACTIVATION','DISABLED');
  tag('KEYBOARD_MOUSE_INPUT','DISABLED');
  tag('SCREENSHOTS','NOT_CAPTURED');
  tag('VDI_CONTENT','NOT_READ');
  let output;
  try{
    output=execFileSync('/usr/bin/swift',[swift],{
      encoding:'utf8',timeout:90_000,
      maxBuffer:150_000,stdio:['ignore','pipe','pipe']
    });
  }catch{fail('SWIFT_TOOLCHAIN_OR_NATIVE_INSPECTION_FAILED');}
  let result;
  try{result=JSON.parse(output);}
  catch{fail('MALFORMED_NATIVE_INSPECTION');}
  const verdict=classify(result);
  tag('OMNISSA_RUNNING',result.running?'YES':'NO');
  tag('MATCHING_APP_INSTANCES',result.candidate_count);
  if(result.bundle_id)tag('APP_BUNDLE_ID',result.bundle_id);
  tag('TERMINAL_ACCESSIBILITY_GRANTED',result.accessibility_trusted?'YES':'NO');
  tag('SCREEN_RECORDING_PERMISSION',result.screen_capture_preflight?'YES':'NO');
  tag('HOST_AX_WINDOWS',result.window_count);
  tag('HOST_AX_ROLES',result.role_count);
  tag('HOST_AX_INTERACTIVE_ROLES',result.interactive_role_count);
  tag('FOREGROUND_UNCHANGED',result.foreground_unchanged?'YES':'NO');
  const service=await sameMacAxStatus(result.bundle_id);
  tag('EXISTING_SAME_MAC_AX_SERVICE',service.service);
  tag('OMNISSA_ALREADY_ALLOWLISTED_IN_AX',
    service.bundleAuthorized?'YES':'NO');
  tag('WINDOWS_GUEST_DOM_EXPOSED','UNVERIFIED');
  tag('REQUIRES_VDI_SCREEN_VISUAL_TEST','YES');
  tag('VERDICT',verdict);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    tag('STOP',String(error?.message||'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,100));
    process.exitCode=2;
  });
}
