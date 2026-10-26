#!/usr/bin/env node
/**
 * Operator-invoked install on a SECOND Mac or macOS virtual machine only.
 * Never run on the primary Mac. Checks machine identity before mutation.
 * No browser debug ports, profile transfers, password prompts, or remote actions.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import console from 'node:console';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {machineDigest,platformUuidFromIoreg,assertDistinctMachines} from './identity.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const home=path.join(os.homedir(),'Library/Application Support/LCH/IsolatedMacCUA');
const agent=path.join(os.homedir(),'Library/LaunchAgents/com.lch.sandbox.isolatedmac.plist');
const paths=['identity.mjs','guest-server.mjs','GuestAX.swift','AXFixture.swift'];
const log=(key,value)=>console.log('[Mac Guest Install] '+key+'='+String(value));
function command(bin,args,timeout=120000){
  return execFileSync(bin,args,{encoding:'utf8',timeout,maxBuffer:1024*1024,
    stdio:['ignore','pipe','pipe']}).trim();
}
function identity(){
  return machineDigest(platformUuidFromIoreg(
    command('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],5000)));
}
function guimanager(){
  try{return command('/bin/launchctl',['managername'],5000);}
  catch{return 'UNAVAILABLE';}
}
function compile(what,args){
  try{command('/usr/bin/xcrun',args);log(what,'PASS');}
  catch(error){
    log(what,'FAIL');
    const reason=String(error?.stderr||error?.message||'UNKNOWN')
      .replaceAll(os.homedir(),'~').split(/\r?\n/).slice(0,35);
    for(const line of reason){if(line.trim())log('SWIFT_DIAGNOSTIC',line.slice(0,380));}
    throw Error(what+'_FAILED');
  }
}
function writeOwned(file,content,mode=0o600){
  fs.writeFileSync(file,content,{mode,flag:'wx'});
  fs.chmodSync(file,mode);
}
function listExisting(){
  if(!fs.existsSync(home)){log('INSTALLED','NO');return;}
  const status=fs.existsSync(path.join(home,'worker.json'));
  log('INSTALLED',status?'YES':'INCOMPLETE');
  log('GUEST_GUI_SESSION',guimanager());
}
function install(operatorDigest){
  if(!/^[a-f0-9]{64}$/.test(operatorDigest))throw Error('OPERATOR_ID_REQUIRED');
  const worker=identity();
  assertDistinctMachines(operatorDigest,worker);
  if(guimanager()!=='Aqua')throw Error('GUEST_AQUA_GUI_LOGIN_REQUIRED');
  if(fs.existsSync(agent)||fs.existsSync(path.join(home,'worker.json')))
    throw Error('ALREADY_INSTALLED_NO_OVERWRITE');
  const parent=path.dirname(agent);
  if(!fs.existsSync(parent))fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sandbox-isolated-mac-'));
  fs.chmodSync(temp,0o700);
  try{
    const binary=path.join(temp,'GuestAX');
    compile('AX_TYPECHECK',['swiftc','-typecheck',path.join(here,'GuestAX.swift')]);
    compile('AX_BINARY',['swiftc',path.join(here,'GuestAX.swift'),'-o',binary]);
    const fixtureBinary=path.join(temp,'AXFixture');
    compile('FIXTURE_TYPECHECK',['swiftc','-typecheck',path.join(here,'AXFixture.swift')]);
    compile('FIXTURE_BINARY',['swiftc',path.join(here,'AXFixture.swift'),
      '-framework','AppKit','-o',fixtureBinary]);
    fs.mkdirSync(home,{recursive:true,mode:0o700});
    const serviceDir=path.join(home,'bin');
    fs.mkdirSync(serviceDir,{mode:0o700});
    for(const file of paths)writeOwned(path.join(home,file),fs.readFileSync(path.join(here,file)));
    writeOwned(path.join(serviceDir,'GuestAX'),fs.readFileSync(binary),0o700);
    const fixtureDir=path.join(home,'AXFixture.app','Contents');
    fs.mkdirSync(path.join(fixtureDir,'MacOS'),{recursive:true,mode:0o700});
    writeOwned(path.join(fixtureDir,'MacOS','AXFixture'),fs.readFileSync(fixtureBinary),0o700);
    const info={
      CFBundleIdentifier:'com.lch.SandboxAXFixture',
      CFBundleName:'Sandbox AX Fixture',
      CFBundleExecutable:'AXFixture',
      CFBundlePackageType:'APPL',
      NSHighResolutionCapable:true
    };
    const toXml=Object.entries(info).map(([key,value])=>
      '<key>'+key+'</key>'+(value===true?'<true/>':'<string>'+value+'</string>')).join('\n');
    writeOwned(path.join(fixtureDir,'Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'+toXml+'</dict></plist>');
    const tokenFile=path.join(home,'worker-token');
    writeOwned(tokenFile,crypto.randomBytes(48).toString('hex')+'\n');
    const config={operator_machine_digest:operatorDigest,
      token_file:tokenFile,port:9777,allowed_bundles:[
        'com.lch.SandboxAXFixture'
      ],installed_worker_machine_digest:worker};
    writeOwned(path.join(home,'worker.json'),JSON.stringify(config,null,2)+'\n');
    const label='com.lch.sandbox.isolatedmac';
    const commandArgs=[process.execPath,path.join(home,'guest-server.mjs'),'--serve'];
    const plist='<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
      '<plist version="1.0"><dict><key>Label</key><string>'+label+'</string>'+
      '<key>ProgramArguments</key><array>'+commandArgs.map(x=>'<string>'+x+'</string>').join('')+
      '</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>';
    writeOwned(agent,plist);
    try{command('/bin/launchctl',['bootstrap','gui/'+process.getuid(),agent],15000);}
    catch{
      fs.unlinkSync(agent);
      throw Error('GUEST_AGENT_LAUNCH_FAILED');
    }
    log('INSTALLED','PASS');
    log('GUEST_MACHINE_DIGEST',worker);
    log('LISTEN','127.0.0.1:9777');
    log('TOKEN_FILE',tokenFile);
    log('ALLOWLIST','FIXTURE_ONLY');
    log('ACCESSIBILITY_PERMISSION','REQUIRES_MACOS_CONSENT_ON_GUEST');
    log('NO_PRIMARY_MAC_MUTATIONS','YES');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
function stop(){
  if(!fs.existsSync(agent)){log('WORKER','NOT_INSTALLED');return;}
  const st=fs.lstatSync(agent);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid())
    throw Error('UNTRUSTED_LAUNCH_AGENT');
  const content=fs.readFileSync(agent,'utf8');
  if(!content.includes('com.lch.sandbox.isolatedmac')||
     !content.includes(path.join(home,'guest-server.mjs')))
    throw Error('UNKNOWN_LAUNCH_AGENT_NO_STOP');
  command('/bin/launchctl',['bootout','gui/'+process.getuid(),agent],15000);
  log('WORKER','STOPPED');
  log('PERSISTENT_DATA','PRESERVED');
}
function main(){
  if(process.platform!=='darwin')throw Error('MACOS_GUEST_ONLY');
  const mode=process.argv[2];
  if(mode==='--inspect'&&process.argv.length===3){
    log('GUEST_MACHINE_DIGEST',identity());listExisting();return;
  }
  if(mode==='--install'&&process.argv.length===4){
    install(process.argv[3]);return;
  }
  if(mode==='--stop'&&process.argv.length===3){
    stop();return;
  }
  throw Error('USAGE_INSPECT_INSTALL_OR_STOP');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(error){log('STOP',String(error?.message||'UNKNOWN').slice(0,160));process.exitCode=2;}
}
