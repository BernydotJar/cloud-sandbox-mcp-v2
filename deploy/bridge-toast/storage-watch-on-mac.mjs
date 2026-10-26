#!/usr/bin/env node
/**
 * Optional per-user Mac LaunchAgent. Zero deletions or Docker mutations.
 * Reads actual Linux /workspace capacity via Docker exec ... df -Pk /workspace,
 * then shows the installed native Akira splash only for meaningful changes.
 * Never enables browser debugging or restarts the Bridge.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import console from 'node:console';
import process from 'node:process';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const entry=fileURLToPath(import.meta.url);
const log=(key,value)=>console.log('[Akira Storage Watch] '+key+'='+String(value));
const appRoot=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse');
const binary=path.join(appRoot,'ux','bridge-toast');
const stateFile=path.join(appRoot,'ux','akira-storage-watch.json');
const plist=path.join(os.homedir(),'Library/LaunchAgents/com.lch.sandbox-akira-storage-watch.plist');
const label='com.lch.sandbox-akira-storage-watch';
const env={...process.env,
  PATH:'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'};
function command(bin,args,timeout=15000){
  return execFileSync(bin,args,{encoding:'utf8',timeout,maxBuffer:8192,
    stdio:['ignore','pipe','pipe'],env}).trim();
}
export function capacityLevel(availableGiB,usedPercent){
  if(!Number.isFinite(availableGiB)||!Number.isFinite(usedPercent)||
     availableGiB<0||usedPercent<0||usedPercent>100)throw Error('INVALID_CAPACITY');
  if(availableGiB<30||usedPercent>=95)return 'CRITICAL';
  if(availableGiB<80||usedPercent>=90)return 'WARNING';
  return 'OK';
}
export function alertDecision(current,previous){
  const level=capacityLevel(current.availableGiB,current.usedPercent);
  if(level==='OK')return {level,notify:false,reason:'HEALTHY'};
  if(!previous || previous.level!==level)
    return {level,notify:true,reason:'NEW_OR_CHANGED_SEVERITY'};
  if(previous.availableGiB-current.availableGiB>=5)
    return {level,notify:true,reason:'FIVE_GIB_DEGRADATION'};
  return {level,notify:false,reason:'STABLE_SUPPRESS_REPEAT'};
}
export function parseDf(output){
  const row=String(output).trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/);
  if(!row||row.length<5||!/^\d+$/.test(row[3])||!/^\d+%$/.test(row[4]))
    throw Error('INVALID_DF_RESULT');
  return {availableGiB:Number((Number(row[3])/1048576).toFixed(2)),
    usedPercent:Number(row[4].slice(0,-1))};
}
function safeRegular(file,maxBytes=500000){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
     st.size<1||st.size>maxBytes)throw Error('UNSAFE_LOCAL_FILE');
  return fs.readFileSync(file);
}
function writeOwned(file,contents){
  const tmp=file+'.'+crypto.randomUUID().slice(0,12);
  fs.writeFileSync(tmp,contents,{flag:'wx',mode:0o600});
  try{fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function loadState(){
  try{
    const value=JSON.parse(safeRegular(stateFile,10000).toString());
    if(!value||!['OK','WARNING','CRITICAL'].includes(value.level)||
       !Number.isFinite(value.availableGiB))return null;
    return value;
  }catch(error){
    if(error.code==='ENOENT')return null;
    throw error;
  }
}
function readWorkspaceCapacity(){
  const output=command('/usr/bin/env',
    ['docker','exec','cloud-sandbox-dev-main','df','-Pk','/workspace']);
  return parseDf(output);
}
function check({alert=false}={}){
  const measurement=readWorkspaceCapacity();
  const previous=loadState();
  const result=alertDecision(measurement,previous);
  log('WORKSPACE_FREE_GIB',measurement.availableGiB);
  log('WORKSPACE_USED_PERCENT',measurement.usedPercent);
  log('STATUS',result.level);
  log('DECISION',result.reason);
  if(!alert){log('DISPLAY','NOT_REQUESTED');return;}
  if(result.level==='OK'){
    writeOwned(stateFile,JSON.stringify({level:'OK',availableGiB:measurement.availableGiB}));
    log('DISPLAY','HEALTHY_NO_ALERT');return;
  }
  if(!result.notify){log('DISPLAY','SUPPRESSED_REPEAT');return;}
  safeRegular(binary,20000000);
  const child=spawn(binary,['--status-alert',
    result.level==='CRITICAL'?'storage':'storage-warning'],{
    stdio:'ignore',detached:true
  });
  child.on('error',()=>{/* Subsequent scheduled checks can retry. */});
  if(!child.pid)throw Error('NATIVE_ALERT_SPAWN_FAILED');
  child.unref();
  writeOwned(stateFile,JSON.stringify({
    level:result.level,availableGiB:measurement.availableGiB,
    notifiedAt:new Date().toISOString()
  }));
  log('DISPLAY','NATIVE_SPLASH_SCHEDULED');
}
function xml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function launchAgentContents(){
  const args=[process.execPath,entry,'--once'];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<key>Label</key><string>'+label+'</string>',
    '<key>ProgramArguments</key><array>',
    ...args.map(s=>'<string>'+xml(s)+'</string>'),
    '</array><key>StartInterval</key><integer>21600</integer>',
    '<key>RunAtLoad</key><true/>',
    '</dict></plist>'
  ].join('\n')+'\n';
}
function enable(){
  safeRegular(binary,20000000);
  const folder=path.dirname(plist);
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const st=fs.lstatSync(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())
    throw Error('UNSAFE_LAUNCHAGENTS_DIRECTORY');
  const expected=launchAgentContents();
  if(fs.existsSync(plist)){
    const before=safeRegular(plist,20000).toString();
    if(before!==expected)throw Error('EXISTING_AGENT_CONFLICT');
    log('WATCH','ALREADY_INSTALLED');
    return;
  }
  fs.writeFileSync(plist,expected,{flag:'wx',mode:0o600});
  try{
    command('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist],12000);
  }catch(error){
    fs.unlinkSync(plist);
    throw Error('LAUNCH_AGENT_BOOTSTRAP_FAILED:'+String(error.code||'UNKNOWN'));
  }
  log('WATCH','ENABLED_EVERY_6_HOURS');
}
function disable(){
  if(!fs.existsSync(plist)){log('WATCH','NOT_INSTALLED');return;}
  const current=safeRegular(plist,20000).toString();
  if(current!==launchAgentContents())throw Error('EXISTING_AGENT_CONFLICT');
  try{command('/bin/launchctl',['bootout','gui/'+process.getuid(),plist],12000);}
  catch{ /* If not loaded, removing this exact owned file is still safe. */ }
  fs.unlinkSync(plist);
  log('WATCH','DISABLED');
}
function main(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  const mode=process.argv[2];
  if(process.argv.length!==3||
     !['--status','--once','--enable','--disable'].includes(mode))
    throw Error('INVALID_MODE');
  if(mode==='--status')check();
  if(mode==='--once')check({alert:true});
  if(mode==='--enable')enable();
  if(mode==='--disable')disable();
}
if(process.argv[1]&&path.resolve(process.argv[1])===entry){
  try{main();}
  catch(error){
    log('STOP',String(error.message||error.code||'UNKNOWN').slice(0,170));
    process.exitCode=2;
  }
}
