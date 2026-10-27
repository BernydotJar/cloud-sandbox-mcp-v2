#!/usr/bin/env node
/**
 * Install a native background AX agent on THIS SAME Mac only.
 * Uses a private per-user LaunchAgent; never restarts browsers/Bridge,
 * enables Remote Debugging, creates a VM or changes the active window.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {machineDigest,platformUuidFromIoreg} from './identity.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const home=path.join(os.homedir(),'Library/Application Support/LCH/SameMacBackgroundAX');
const agent=path.join(os.homedir(),'Library/LaunchAgents/com.lch.same-mac-ax.plist');
const bundle='com.lch.SameMacAXFixture';
const required=['SameMacAX.swift','SameMacAXFixture.swift','server.mjs','identity.mjs'];
const log=(k,v)=>console.log('[Same Mac Background AX] '+k+'='+String(v));
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const machine=()=>machineDigest(platformUuidFromIoreg(
  run('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],5000)));
function run(cmd,args,timeout=120000){
  return execFileSync(cmd,args,{encoding:'utf8',timeout,maxBuffer:1500000,
    stdio:['ignore','pipe','pipe']}).trim();
}
function verifyManifest(){
  const manifest=path.join(root,'manifest.json');
  if(!fs.existsSync(manifest))throw Error('RELEASE_MANIFEST_REQUIRED');
  const meta=JSON.parse(fs.readFileSync(manifest,'utf8'));
  const actual=fs.readFileSync(manifest);
  if(sha(actual)!==fs.readFileSync(path.join(root,'manifest.sha256'),'utf8').trim())
    throw Error('RELEASE_MANIFEST_SHA_MISMATCH');
  for(const name of Object.keys(meta.files_sha256||{})){
    const file=path.join(root,name);
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||
       sha(fs.readFileSync(file))!==meta.files_sha256?.[name])
      throw Error('RELEASE_FILE_SHA_MISMATCH:'+name);
  }
  if(required.some(name=>!Object.hasOwn(meta.files_sha256,name)))
    throw Error('RELEASE_REQUIRED_FILE_MISSING');
  return meta;
}
function compile(stage,source,output){
  try{
    run('/usr/bin/xcrun',['swiftc','-typecheck',path.join(root,source)]);
    log('SWIFT_TYPECHECK_'+source,'PASS');
    if(output){
      run('/usr/bin/xcrun',['swiftc',path.join(root,source),
        '-framework','AppKit','-o',path.join(stage,output)]);
      log('SWIFT_BUILD_'+source,'PASS');
    }
  }catch(error){
    const raw=String(error.stderr||error.stdout||error.message||'UNKNOWN')
      .replaceAll(os.homedir(),'~').replaceAll(root,'[SOURCE]');
    for(const line of raw.split(/\r?\n/).filter(Boolean).slice(0,42))
      log('SWIFT_DIAGNOSTIC',line.slice(0,380));
    throw Error('SWIFT_COMPILE_FAILED_'+source);
  }
}
function secureFile(file){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
     (stat.mode&0o077)!==0)throw Error('UNSAFE_INSTALLED_FILE');
}
function inspected(){
  const meta=verifyManifest();
  log('RELEASE_SHA256','PASS');
  log('SOURCE_COMMIT',meta.source_git_sha);
  if(process.platform!=='darwin'){
    log('PLATFORM','MAC_REQUIRED');return;
  }
  log('CURRENT_MACHINE_DIGEST',machine());
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'same-mac-ax-inspect-'));
  try{
    compile(stage,'SameMacAX.swift');
    compile(stage,'SameMacAXFixture.swift');
    log('NATIVE_SWIFT_SOURCE','TYPECHECK_PASS');
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
  log('INSTALLED',fs.existsSync(path.join(home,'config.json'))?'YES':'NO');
  log('BROWSER_DEBUGGING_CHANGED','NO');
  log('FOCUS_CHANGED','NO');
}
function install(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  verifyManifest();
  const manager=run('/bin/launchctl',['managername'],5000);
  if(manager!=='Aqua')throw Error('LOGGED_IN_AQUA_SESSION_REQUIRED');
  if(fs.existsSync(path.join(home,'config.json'))||fs.existsSync(agent))
    throw Error('ALREADY_INSTALLED_USE_STOP_AND_REVIEW');
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'same-mac-ax-build-'));
  fs.chmodSync(stage,0o700);
  try{
    compile(stage,'SameMacAX.swift','SameMacAX');
    compile(stage,'SameMacAXFixture.swift','SameMacAXFixture');
    fs.mkdirSync(home,{recursive:true,mode:0o700});
    const bin=path.join(home,'bin');
    fs.mkdirSync(bin,{mode:0o700});
    const machineId=machine();
    for(const file of ['server.mjs','identity.mjs']){
      fs.writeFileSync(path.join(home,file),fs.readFileSync(path.join(root,file)),
        {flag:'wx',mode:0o600});
    }
    fs.writeFileSync(path.join(bin,'SameMacAX'),
      fs.readFileSync(path.join(stage,'SameMacAX')),{flag:'wx',mode:0o700});
    const fixture=path.join(home,'SameMacAXFixture.app','Contents');
    fs.mkdirSync(path.join(fixture,'MacOS'),{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(fixture,'MacOS','SameMacAXFixture'),
      fs.readFileSync(path.join(stage,'SameMacAXFixture')),{flag:'wx',mode:0o700});
    const info='<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
      '<plist version="1.0"><dict>'+
      '<key>CFBundleIdentifier</key><string>'+bundle+'</string>'+
      '<key>CFBundleName</key><string>Same Mac AX Fixture</string>'+
      '<key>CFBundlePackageType</key><string>APPL</string>'+
      '<key>CFBundleExecutable</key><string>SameMacAXFixture</string>'+
      '<key>LSUIElement</key><true/></dict></plist>';
    fs.writeFileSync(path.join(fixture,'Info.plist'),info,{flag:'wx',mode:0o600});
    const config={machine_digest:machineId,port:9779,
      allowed_bundles:[bundle],press_certified_bundles:[bundle]};
    fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config,null,2)+'\n',
      {flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(home,'token'),
      crypto.randomBytes(48).toString('hex')+'\n',{flag:'wx',mode:0o600});
    const launchDir=path.dirname(agent);
    fs.mkdirSync(launchDir,{recursive:true,mode:0o700});
    const program=[process.execPath,path.join(home,'server.mjs'),'--serve'];
    const xmlValue=v=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const plist='<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
      '<plist version="1.0"><dict><key>Label</key><string>com.lch.same-mac-ax</string>'+
      '<key>ProgramArguments</key><array>'+
      program.map(value=>'<string>'+xmlValue(value)+'</string>').join('')+
      '</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>';
    fs.writeFileSync(agent,plist,{flag:'wx',mode:0o600});
    try{run('/bin/launchctl',['bootstrap','gui/'+process.getuid(),agent],15000);}
    catch{
      fs.unlinkSync(agent);
      throw Error('SAME_MAC_LAUNCH_AGENT_FAILED');
    }
    log('INSTALL','PASS');
    log('SERVICE','127.0.0.1:9779');
    log('MAC_IDENTITY',machineId);
    log('ACCESSIBILITY','GRANT_ONCE_TO_STABLE_HELPER_IF_NEEDED');
    log('BROWSERS_RESTARTED','NO');
    log('TERMINAL_FOCUSED','UNCHANGED_BY_INSTALLER');
    log('VM_CREATED','NO');
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
function start(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  secureFile(agent);
  const content=fs.readFileSync(agent,'utf8');
  if(!content.includes('com.lch.same-mac-ax')||
     !content.includes(path.join(home,'server.mjs')))
    throw Error('UNTRUSTED_LAUNCH_AGENT_NO_START');
  run('/bin/launchctl',['bootstrap','gui/'+process.getuid(),agent],15000);
  log('SERVICE','STARTED');
  log('MAC_BROWSER_BRIDGE','UNCHANGED');
}
function stop(){
  if(!fs.existsSync(agent)){log('SERVICE','NOT_INSTALLED');return;}
  secureFile(agent);
  const current=fs.readFileSync(agent,'utf8');
  if(!current.includes('com.lch.same-mac-ax')||
     !current.includes(path.join(home,'server.mjs')))
    throw Error('UNTRUSTED_LAUNCH_AGENT_NO_STOP');
  run('/bin/launchctl',['bootout','gui/'+process.getuid(),agent],15000);
  log('SERVICE','STOPPED');
  log('FILES_AND_AUDIT','PRESERVED');
}
function ensureInstalled(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  secureFile(agent);
  const configFile=path.join(home,'config.json');
  secureFile(configFile);
  const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(cfg.machine_digest!==machine())throw Error('WRONG_MAC_INSTANCE');
  if(!Array.isArray(cfg.allowed_bundles)||
     !Array.isArray(cfg.press_certified_bundles))
    throw Error('UNEXPECTED_LOCAL_CONFIG');
  return {configFile,cfg};
}
function restartService(){
  run('/bin/launchctl',['kickstart','-k',
    'gui/'+process.getuid()+'/com.lch.same-mac-ax'],15000);
  log('ONLY_SAME_MAC_AX_SERVICE','RESTARTED');
  log('BROWSER_BRIDGE_CHANGED','NO');
}
function configure(mode,bundleName){
  if(!/^[a-zA-Z0-9.-]{8,120}$/.test(bundleName))
    throw Error('INVALID_BUNDLE_ID');
  const {configFile,cfg}=ensureInstalled();
  if(mode==='--allow-app'){
    if(!cfg.allowed_bundles.includes(bundleName))
      cfg.allowed_bundles.push(bundleName);
  }else{
    if(!cfg.allowed_bundles.includes(bundleName))
      throw Error('ALLOW_APP_BEFORE_PRESS');
    if(!cfg.press_certified_bundles.includes(bundleName))
      cfg.press_certified_bundles.push(bundleName);
  }
  const newData=JSON.stringify(cfg,null,2)+'\n';
  const temp=configFile+'.'+crypto.randomUUID();
  try{
    fs.writeFileSync(temp,newData,{flag:'wx',mode:0o600});
    fs.renameSync(temp,configFile);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  restartService();
  log('APP_CAPABILITY_UPDATED',mode==='--allow-app'?'AX_OBSERVE_AND_SET':'AX_PRESS_CERTIFIED');
  log('APP_BUNDLE',bundleName);
}
function main(){
  const mode=process.argv[2];
  if((mode==='--allow-app'||mode==='--certify-press') &&
     process.argv.length===4){
    configure(mode,process.argv[3]);return;
  }
  if(mode==='--restart'&&process.argv.length===3){
    ensureInstalled();restartService();return;
  }
  if(process.argv.length!==3||!['--inspect','--install','--stop','--start'].includes(mode))
    throw Error('MODE_REQUIRED');
  if(mode==='--inspect')inspected();
  if(mode==='--install')install();
  if(mode==='--stop')stop();
  if(mode==='--start')start();
}
try{main();}
catch(error){
  log('STOP',String(error?.message||'UNKNOWN').slice(0,180));
  process.exitCode=2;
}
