#!/usr/bin/env node
import {launchAgentNodePath} from './launchd-runtime.mjs';
/**
 * This SAME Mac only; inspect (read-only), or explicit repair of this
 * application's own user LaunchAgent. Never touch the Browser Bridge,
 * running browsers, Docker, VM settings or unrelated launchd services.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {machineDigest,platformUuidFromIoreg} from './identity.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const label='com.lch.same-mac-ax';
const home=path.join(os.homedir(),'Library/Application Support/LCH/SameMacBackgroundAX');
const plist=path.join(os.homedir(),'Library/LaunchAgents/'+label+'.plist');
const service=path.join(home,'server.mjs');
const logDir=path.join(home,'launchd-logs');
const stdoutPath=path.join(logDir,'stdout.log');
const stderrPath=path.join(logDir,'stderr.log');
const target='gui/'+process.getuid()+'/'+label;
const say=(key,value)=>console.log('[Same Mac AX Doctor] '+key+'='+String(value));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const safeText=s=>String(s).replaceAll(os.homedir(),'~')
  .replace(/Bearer\s+\S+/g,'Bearer [REDACTED]')
  .replace(/([A-Fa-f0-9]{64,})/g,'[REDACTED_DIGEST]')
  .split('').map(c=>{const n=c.charCodeAt(0);return n<32||n===127?' ':c;})
  .join('').slice(0,230);
const exec=(bin,args,opts={})=>spawnSync(bin,args,{
  encoding:'utf8',timeout:opts.timeout??6000,maxBuffer:150000,
  stdio:['ignore','pipe','pipe']});
function privateFile(filename){
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
     (stat.mode&0o077)!==0)throw Error('UNTRUSTED_INSTALLED_FILE');
  return stat;
}
function installedState(){
  for(const file of [plist,path.join(home,'config.json'),path.join(home,'token'),
    service,path.join(home,'identity.mjs')])privateFile(file);
  const cfg=JSON.parse(fs.readFileSync(path.join(home,'config.json'),'utf8'));
  const identity=execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],
    {encoding:'utf8',timeout:5000,maxBuffer:16000});
  if(cfg.machine_digest!==machineDigest(platformUuidFromIoreg(identity)))
    throw Error('SAME_MAC_IDENTITY_MISMATCH');
  const token=fs.readFileSync(path.join(home,'token'),'utf8').trim();
  if(token.length<32)throw Error('INVALID_LOCAL_TOKEN');
  const job=fs.readFileSync(plist,'utf8');
  if(!job.includes('<string>'+label+'</string>')||
     !job.includes(service)||!job.includes('<key>ProgramArguments</key>'))
    throw Error('UNKNOWN_LAUNCH_AGENT_DO_NOT_REPLACE');
  return {cfg,token,job};
}
function originalReleaseIntegrity(){
  const manifest=path.join(root,'manifest.json');
  const content=fs.readFileSync(manifest);
  if(sha(content)!==fs.readFileSync(path.join(root,'manifest.sha256'),'utf8').trim())
    throw Error('RELEASE_MANIFEST_MISMATCH');
  const meta=JSON.parse(content);
  if(meta.schema!=='cloud-sandbox.same-mac-background-ax.review.v1')
    throw Error('UNKNOWN_RELEASE_SCHEMA');
  for(const [name,expected] of Object.entries(meta.files_sha256||{})){
    if(!/^[a-zA-Z0-9._-]+$/.test(name))throw Error('UNSAFE_RELEASE_FILENAME');
    const file=path.join(root,name);
    const info=fs.lstatSync(file);
    if(!info.isFile()||info.isSymbolicLink()||sha(fs.readFileSync(file))!==expected)
      throw Error('RELEASE_DIGEST_MISMATCH:'+name);
  }
  // Only a known installed service may be repaired. No silent update
  // over another agent's customized installed source.
  for(const name of ['server.mjs','identity.mjs']){
    if(sha(fs.readFileSync(path.join(home,name)))!==meta.files_sha256[name])
      throw Error('INSTALLED_SERVICE_CUSTOMIZED_REPAIR_REFUSED');
  }
  return meta;
}
function launchdState(){
  const r=exec('/bin/launchctl',['print',target],{timeout:9000});
  const text=String(r.stdout||'');
  const keys=text.split(/\r?\n/)
    .map(s=>s.trim())
    .filter(s=>/^(state|pid|last exit code|runs|program|throttle interval) = /.test(s))
    .slice(0,12);
  return {loaded:r.status===0,details:keys.map(safeText),
    code:r.status===0?'LOADED':'NOT_LOADED'};
}
function lastErrors(){
  if(!fs.existsSync(stderrPath))return [];
  const data=fs.readFileSync(stderrPath,'utf8').slice(-8000);
  return data.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(-16)
    .map(line=>safeText(line));
}
function commandNode(){
  const r=exec('/usr/libexec/PlistBuddy',['-c','Print :ProgramArguments:0',plist]);
  if(r.status!==0)return null;
  return String(r.stdout).trim();
}
async function probe(token){
  try{
    const response=await fetch('http://127.0.0.1:9779/v1/status',{
      method:'POST',headers:{authorization:'Bearer '+token,
        'content-type':'application/json'},
      body:'{}',signal:AbortSignal.timeout(2000),redirect:'error'
    });
    const json=await response.json();
    if(!response.ok||json.ok!==true){
      return {reachable:false,code:'HTTP_'+response.status};
    }
    const state=json.data;
    if(state?.provider!=='same_mac_background_ax'||
       state?.same_machine_verified!==true)
      return {reachable:false,code:'UNEXPECTED_LISTENER_IDENTITY'};
    return {reachable:true,code:'READY_HTTP',
      axReady:state.ready===true,axPermission:state.ax_permission===true,
      guiSession:state.gui_session===true};
  }catch(error){
    const cause=error?.cause;
    const code=cause?.code||cause?.errors?.[0]?.code||error?.code;
    return {reachable:false,
      code:['ECONNREFUSED','ETIMEDOUT','EADDRINUSE','EACCES','ECONNRESET'].includes(code)?
        code:'HTTP_CONNECT_FAILED'};
  }
}
function report(before,details){
  say('HTTP',before.code);
  if(before.reachable){
    say('AX_READY',before.axReady?'YES':'NO');
    say('AX_PERMISSION',before.axPermission?'YES':'NOT_GRANTED');
    say('AQUA_SESSION',before.guiSession?'YES':'NO');
  }
  say('LAUNCHD',details.code);
  for(const line of details.details)say('LAUNCHD_DETAIL',line);
  const node=commandNode();
  say('INSTALLED_NODE_EXECUTABLE',node?'RECORDED':'NOT_FOUND');
  if(node){
    const check=exec(node,['--version']);
    say('NODE_EXECUTABLE_WORKS',check.status===0?'YES':'NO');
  }
  const syntax=exec(process.execPath,['--check',service]);
  say('INSTALLED_SERVER_SYNTAX',syntax.status===0?'PASS':'FAIL');
  const plistCheck=exec('/usr/bin/plutil',['-lint',plist]);
  say('LAUNCH_AGENT_PLIST',plistCheck.status===0?'PASS':'FAIL');
  for(const line of lastErrors())say('SERVICE_ERROR',line);
}
const xml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function candidatePlist(node){
  const args=[node,service,'--serve'];
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '+
    '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
    '<plist version="1.0"><dict><key>Label</key><string>'+label+'</string>'+
    '<key>ProgramArguments</key><array>'+
    args.map(value=>'<string>'+xml(value)+'</string>').join('')+
    '</array><key>WorkingDirectory</key><string>'+xml(home)+'</string>'+
    '<key>StandardOutPath</key><string>'+xml(stdoutPath)+'</string>'+
    '<key>StandardErrorPath</key><string>'+xml(stderrPath)+'</string>'+
    '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>';
}
function atomic(file,data){
  const staged=path.join(path.dirname(file),'.same-mac-repair-'+crypto.randomUUID());
  try{
    fs.writeFileSync(staged,data,{flag:'wx',mode:0o600});
    fs.renameSync(staged,file);
  }finally{if(fs.existsSync(staged))fs.unlinkSync(staged);}
}
async function waitForHealth(token,ms=16000){
  const end=Date.now()+ms;
  let state;
  do{
    state=await probe(token);
    if(state.reachable)return state;
    await sleep(500);
  }while(Date.now()<end);
  return state;
}
async function waitUnregistered(ms=12000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    if(!launchdState().loaded)return true;
    await sleep(350);
  }
  return false;
}
async function repair({token,job}){
  const current=await probe(token);
  if(current.reachable){
    say('REPAIR','NOT_NEEDED_HTTP_ALREADY_WORKING');
    return current;
  }
  originalReleaseIntegrity();
  const node=launchAgentNodePath();
  const version=exec(node,['--version']);
  if(version.status!==0)throw Error('NODE_RUNTIME_UNAVAILABLE');
  const syntax=exec(node,['--check',service]);
  if(syntax.status!==0)throw Error('INSTALLED_SERVER_SYNTAX_INVALID');
  fs.mkdirSync(logDir,{recursive:true,mode:0o700});
  for(const f of [stdoutPath,stderrPath]){
    if(fs.existsSync(f))privateFile(f);
    else fs.writeFileSync(f,'',{flag:'wx',mode:0o600});
  }
  const next=candidatePlist(node);
  const staging=path.join(home,'launchd-logs','test-'+crypto.randomUUID()+'.plist');
  fs.writeFileSync(staging,next,{flag:'wx',mode:0o600});
  try{
    const lint=exec('/usr/bin/plutil',['-lint',staging]);
    if(lint.status!==0)throw Error('REPAIRED_LAUNCH_AGENT_PLIST_INVALID');
  }finally{fs.unlinkSync(staging);}
  const backupDir=path.join(home,'backups');
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const backup=path.join(backupDir,'launchagent-before-repair-'+Date.now()+'-'+crypto.randomUUID()+'.plist');
  fs.writeFileSync(backup,job,{flag:'wx',mode:0o600});
  say('BACKUP','SAVED_PRIVATE');
  const existing=launchdState();
  if(existing.loaded){
    const result=exec('/bin/launchctl',['bootout',target],{timeout:10000});
    if(result.status!==0)throw Error('OWN_LAUNCH_AGENT_BOOTOUT_FAILED');
    if(!await waitUnregistered())
      throw Error('OWN_LAUNCH_AGENT_NOT_UNREGISTERED');
  }
  atomic(plist,next);
  let loaded=false;
  for(let attempt=0;attempt<14;attempt++){
    const r=exec('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist],
      {timeout:9000});
    if(r.status===0){loaded=true;break;}
    if(launchdState().loaded){loaded=true;break;}
    await sleep(550);
  }
  if(!loaded){
    atomic(plist,job);
    for(let attempt=0;attempt<5;attempt++){
      if(exec('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist]).status===0)break;
      await sleep(500);
    }
    throw Error('OWN_LAUNCH_AGENT_RESTART_FAILED_BASELINE_RESTORED');
  }
  say('OWN_LAUNCH_AGENT_RELOADED','YES');
  const result=await waitForHealth(token);
  say('REPAIR_HTTP_RESULT',result.code);
  if(!result.reachable){
    for(const line of lastErrors())say('SERVICE_ERROR',line);
    throw Error('OWN_LAUNCH_AGENT_STILL_UNREACHABLE_READ_DIAGNOSTICS');
  }
  return result;
}
async function main(){
  if(process.platform!=='darwin')throw Error('MAC_ONLY');
  const mode=process.argv[2];
  if(process.argv.length!==3||!['--inspect','--repair'].includes(mode))
    throw Error('MODE_INSPECT_OR_REPAIR_REQUIRED');
  const {token,job}=installedState();
  const health=await probe(token);
  const launch=launchdState();
  report(health,launch);
  if(mode==='--inspect'){
    say('NO_MUTATIONS','YES');
    say('RESULT',health.reachable?'HTTP_PASS':'HTTP_FAILED');
    if(!health.reachable)process.exitCode=2;
    return;
  }
  const recovered=await repair({token,job});
  say('RESULT',recovered.reachable?
    (recovered.axReady?'HTTP_AND_AX_READY':'HTTP_READY_AX_PERMISSION_PENDING'):
    'HTTP_UNAVAILABLE');
}
main().catch(error=>{
  say('STOP',safeText(error?.message||'UNKNOWN'));
  process.exitCode=2;
});
