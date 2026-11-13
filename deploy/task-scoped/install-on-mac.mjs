#!/usr/bin/env node
/* global fetch, AbortSignal */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const root=path.dirname(fileURLToPath(import.meta.url));
const command=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',timeout:30000,maxBuffer:2000000}).trim();
function read(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o022))
  throw Error('UNSAFE_OR_UNOWNED_FILE');
 return fs.readFileSync(file);
}
function atomic(file,bytes){
 const tmp=file+'.task-session-'+process.pid+'.tmp',mode=fs.statSync(file).mode&0o777;
 fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});
 try{fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
export function validatePlan(manifest,actual){
 let pending=false;
 for(const [name,item] of Object.entries(manifest.files)){
  const hash=sha(actual[name]);
  if(hash!==item.before && hash!==item.after)throw Error('LIVE_CODE_DRIFT');
  if(hash!==item.after)pending=true;
 }
 return pending;
}
/** All mutation dependencies are injected so rollback/active-task refusal are exercised without a Mac. */
export async function activate({manifest,actual,payload,status,write,restart,verify}){
 if((await status()).active!==false)throw Error('ACTIVE_TASK_SESSION_DO_NOT_INTERRUPT');
 if(!validatePlan(manifest,actual))return {already_installed:true};
 const touched=[];
 try{
  for(const name of Object.keys(manifest.files)){
   touched.push(name);await write(name,payload[name]);
  }
  await restart();await verify();
  return {installed:true};
 }catch(error){
  for(const name of touched.reverse())await write(name,actual[name]);
  await restart();
  throw Error('ROLLED_BACK_'+error.message);
 }
}
async function main(){
 if(process.platform!=='darwin')throw Error('MACOS_REQUIRED');
 const mode=process.argv[2]||'--inspect';
 if(!['--inspect','--install'].includes(mode)||process.argv.length>3)throw Error('USE_INSPECT_OR_INSTALL');
 const bytes=read(path.join(root,'manifest.json'));
 if(sha(bytes)!==read(path.join(root,'manifest.sha256')).toString().trim())throw Error('MANIFEST_HASH_MISMATCH');
 const manifest=JSON.parse(bytes);
 if(manifest.schema!=='sandbox-v3.task-scoped.v1'||sha(read(fileURLToPath(import.meta.url)))!==manifest.installer_sha256)
  throw Error('INSTALLER_INTEGRITY_FAILED');
 const inspect=JSON.parse(command('docker',['inspect','cloud-sandbox-mcp']))[0];
 if(!inspect.State.Running||inspect.Config.Labels['com.docker.compose.service']!=='mcp')throw Error('CONTROLLER_NOT_READY');
 const mount=inspect.Mounts.filter(m=>m.Destination==='/app/dist');
 if(mount.length!==1||mount[0].Type!=='bind')throw Error('CUSTOM_CONTROLLER_OVERLAY_REQUIRED');
 const host=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse');
 const target=name=>name.startsWith('controller/')?path.join(mount[0].Source,name.slice(11)):path.join(host,name);
 const actual={},payload={};
 for(const [name,item] of Object.entries(manifest.files)){
  if(!/^(bridge.mjs|autonomy-session.mjs|background-browser.mjs|browser-runtime\/(runtime|audit-ledger).mjs|browser-dom\/tabs.mjs|controller\/mcp\/(server|browser-runtime-tools).js)$/.test(name))
   throw Error('UNEXPECTED_RELEASE_FILE');
  actual[name]=read(target(name));payload[name]=read(path.join(root,'payload',name));
  if(sha(payload[name])!==item.after)throw Error('PAYLOAD_INTEGRITY_FAILED');
 }
 const pending=validatePlan(manifest,actual);
 const config=read(path.join(inspect.Config.Labels['com.docker.compose.project.working_dir'],'.env')).toString();
 const env=Object.fromEntries(config.split(/\r?\n/).map(l=>l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^["']|["']$/g,'')]));
 if(env.COMPUTER_USE_TRUSTED_SESSION_NOTICE!=='true')throw Error('OPERATOR_TRUSTED_OPT_IN_REQUIRED');
 const port=Number(env.COMPUTER_USE_BRIDGE_PORT),token=env.COMPUTER_USE_BRIDGE_TOKEN;
 if(!Number.isInteger(port)||port<1024||port>65535||!token||token.length<32)throw Error('BRIDGE_CONFIG_INVALID');
 const post=async route=>{
  const r=await fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(3500)});
  const data=await r.json();if(!r.ok||!data.ok)throw Error('BRIDGE_STATUS_UNAVAILABLE');return data.data;
 };
 if((await post('/v1/session/status')).active!==false)throw Error('ACTIVE_TASK_SESSION_DO_NOT_INTERRUPT');
 // Read only fixed production package metadata. No environment or credentials are returned.
 const deps=JSON.parse(command('docker',['exec','cloud-sandbox-mcp','node','-e',
  'const fs=require("fs");const out={};for(const n of '+JSON.stringify(Object.keys(manifest.dependencies))+
  '){try{out[n]=JSON.parse(fs.readFileSync("/app/node_modules/"+n+"/package.json")).version}catch{out[n]=null}}process.stdout.write(JSON.stringify(out));']));
 const mismatches=Object.keys(manifest.dependencies).filter(n=>deps[n]!==manifest.dependencies[n]);
 process.stdout.write(JSON.stringify({source_commit:manifest.source_commit,patch_required:pending,
  no_active_session:true,dependencies_match:mismatches.length===0,dependency_mismatches:mismatches},null,2)+'\n');
 if(mismatches.length)throw Error('CONTROLLER_DEPENDENCY_UPGRADE_REQUIRED');
 if(!pending){
  const current=await post('/v1/status');
  if(current.task_delegation_version!==1||current.trusted_delegation_notice.max_actions!==200||current.trusted_delegation_notice.unlimited_actions!==false)throw Error('FILES_PATCHED_RUNTIME_NOT_UPDATED');
 }
 if(mode==='--inspect'){process.stdout.write('SAFE_PREFLIGHT=PASS\n');return;}
 const backup=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxBackups','task-scoped-'+Date.now());
 fs.mkdirSync(backup,{recursive:true,mode:0o700});
 for(const [name,data] of Object.entries(actual)){
  const file=path.join(backup,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,data,{mode:0o600,flag:'wx'});
 }
 for(const name of Object.keys(actual))if(sha(read(target(name)))!==sha(actual[name]))throw Error('LIVE_CODE_CHANGED');
 const label='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
 const restart=async()=>{command('/bin/launchctl',['kickstart','-k',label]);command('docker',['restart','cloud-sandbox-mcp']);};
 const verify=async()=>{
  for(const [name,item] of Object.entries(manifest.files))if(sha(read(target(name)))!==item.after)throw Error('POST_INSTALL_HASH_FAILED');
  for(let i=0;i<20;i++){
   await sleep(500);
   try{
    const s=await post('/v1/status');
    if(s.task_delegation_version===1&&s.trusted_delegation_notice.max_actions===200&&s.delegated_session.active===false){
     const health=await fetch('http://127.0.0.1:3000/healthz',{redirect:'error',signal:AbortSignal.timeout(3500)});
     if(health.status===200)return;
    }
   }catch{/* bounded startup polling */}
  }
  throw Error('POST_INSTALL_HEALTH_FAILED');
 };
 const result=await activate({manifest,actual,payload,status:()=>post('/v1/session/status'),
  write:async(name,data)=>atomic(target(name),data),restart,verify});
 for(const [name,item] of Object.entries(manifest.files))if(sha(read(target(name)))!==item.after)throw Error('POST_INSTALL_HASH_FAILED');
 fs.writeFileSync(path.join(backup,'receipt.json'),JSON.stringify({result,source_commit:manifest.source_commit,targets:Object.fromEntries(Object.keys(actual).map(n=>[n,target(n)]))},null,2),{mode:0o600});
 process.stdout.write('TASK_SCOPED_INSTALL=PASS\nBACKUP='+backup+'\nRefresh Sandbox V3 action discovery before browser work.\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{process.stderr.write('SAFETY_STOP='+String(error.message).replace(/[^A-Za-z0-9_ .-]/g,'_').slice(0,180)+'\n');process.exitCode=1;});
