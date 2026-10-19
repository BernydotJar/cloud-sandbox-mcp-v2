/* global fetch, AbortSignal */
// Safe, opt-in native UX upgrade for the existing Mac Bridge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {upgradeToastBridgeSource,upgradeToastEnvSource} from './upgrade-toast.mjs';

const release=path.dirname(fileURLToPath(import.meta.url));
const log=(key,value)=>process.stdout.write('[Bridge Glass Toast] '+key+'='+value+'\n');
const hash=contents=>crypto.createHash('sha256').update(contents).digest('hex');
const previousRuntimeShas=new Set([
  'c5f41efcf6807df120e79bca49e48d2f76154edbe1621ede9f8c722cf1a60b4a',
  '00ba4772df315d9ca13b6990c96a902e7765d4e1b22f37258595dc4afac44575'
]);

function command(bin,args,timeout=20000) {
  return execFileSync(bin,args,{
    timeout,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1000000
  }).trim();
}
function safeFile(file,requireOwnership=true) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink() || (requireOwnership && stat.uid!==process.getuid()))
    throw Error('UNSAFE_OR_UNOWNED_FILE');
  return {contents:fs.readFileSync(file),mode:stat.mode&0o777};
}
function atomicWrite(file,contents,mode) {
  const tmp=file+'.toast-'+process.pid+'.tmp';
  fs.writeFileSync(tmp,contents,{flag:'wx',mode});
  try{fs.renameSync(tmp,file);fs.chmodSync(file,mode);}
  finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function envValue(contents,key,optional=false) {
  const lines=contents.toString().split(/\r?\n/).filter(x=>x.startsWith(key+'='));
  if((optional && lines.length===0))return null;
  if(lines.length!==1)throw Error('MISSING_OR_DUPLICATE_'+key);
  let value=lines[0].slice(key.length+1);
  if((value.startsWith('"')&&value.endsWith('"')) ||
     (value.startsWith("'")&&value.endsWith("'")))
    value=value.slice(1,-1);
  return value;
}
async function post(port,token,endpoint) {
  const response=await fetch('http://127.0.0.1:'+port+endpoint,{
    method:'POST',headers:{
      authorization:'Bearer '+token,'content-type':'application/json'
    },body:'{}',signal:AbortSignal.timeout(2500)
  });
  if(!response.ok)throw Error('BRIDGE_HEALTH_'+response.status);
  const data=await response.json();
  if(!data?.ok)throw Error('INVALID_BRIDGE_HEALTH');
  return data.data;
}
async function ready(port,token) {
  for(let i=0;i<20;i++) {
    try {
      const status=await post(port,token,'/v2/browser/status');
      if(status?.enabled && status.providers?.some(p=>p.browser==='chrome'&&p.configured) &&
          (typeof status.browser_routing==='object'
            ? status.browser_routing.chrome==='prefer_persistent'
            :status.browser_routing==='prefer_persistent'))return true;
    }catch{ /* Bridge may be restarting. */ }
    await sleep(600);
  }
  return false;
}
async function main() {
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  const mode=process.argv[2]||'--inspect';
  if(!['--inspect','--activate'].includes(mode))throw Error('INVALID_MODE');
  const info=JSON.parse(command('docker',['inspect','cloud-sandbox-mcp']))[0];
  if(!info?.State?.Running || info.Config?.Labels?.['com.docker.compose.service']!=='mcp')
    throw Error('UNEXPECTED_CONTROLLER');
  const workingDir=info.Config.Labels['com.docker.compose.project.working_dir'];
  if(!workingDir)throw Error('COMPOSE_PATH_MISSING');
  const envFile=path.join(fs.realpathSync(workingDir),'.env');
  const bridgeRoot=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxComputerUse');
  const bridgeFile=path.join(bridgeRoot,'bridge.mjs');
  const binary=path.join(bridgeRoot,'ux','bridge-toast');
  const runtimeFile=path.join(bridgeRoot,'browser-runtime','runtime.mjs');
  const cdpFile=path.join(bridgeRoot,'browser-runtime','cdp-semantic.mjs');
  const original=safeFile(bridgeFile);
  const oldEnv=safeFile(envFile);
  const oldRuntime=safeFile(runtimeFile);
  const runtimeRelease=path.join(release,'runtime.mjs');
  const cdpRelease=path.join(release,'cdp-semantic.mjs');
  const upgradedRuntime=fs.readFileSync(runtimeRelease);
  const cdpSource=fs.readFileSync(cdpRelease);
  if(!previousRuntimeShas.has(hash(oldRuntime.contents)) &&
     hash(oldRuntime.contents)!==hash(upgradedRuntime))
    throw Error('UNKNOWN_MAC_RUNTIME_VERSION_NO_OVERWRITE');
  if(!upgradedRuntime.toString().includes('prepareCdpSemanticAction') ||
     !upgradedRuntime.toString().includes('cdp_ax_fallback'))
    throw Error('INVALID_CDP_RUNTIME_RELEASE');
  const existingCdp=fs.existsSync(cdpFile)?safeFile(cdpFile):null;
  const previousCdpDriverShas=new Set([
    '8aef0cbc753b9f4234b8be76ab599ec2c362054a11f575f5a7694cc9c7308b60'
  ]);
  if(existingCdp && hash(existingCdp.contents)!==hash(cdpSource) &&
     !previousCdpDriverShas.has(hash(existingCdp.contents)))
    throw Error('UNKNOWN_EXISTING_CDP_DRIVER_NO_OVERWRITE');
  const patch=upgradeToastBridgeSource(original.contents.toString('utf8'));
  const nextEnv=upgradeToastEnvSource(oldEnv.contents.toString('utf8'));
  if(envValue(oldEnv.contents,'COMPUTER_USE_ENABLED')!=='true' ||
     envValue(oldEnv.contents,'COMPUTER_USE_BROWSER_V2')!=='true' ||
     envValue(oldEnv.contents,'COMPUTER_USE_DEDICATED_CHROME_AUTO_START')!=='true')
    throw Error('DEDICATED_CHROME_NOT_ENABLED');
  const token=envValue(oldEnv.contents,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)throw Error('BRIDGE_AUTH_MISSING');
  const port=Number(envValue(oldEnv.contents,'COMPUTER_USE_BRIDGE_PORT',true)||9764);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('BRIDGE_PORT_INVALID');

  const label='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
  command('/bin/launchctl',['print',label]);
  execFileSync(process.execPath,['--check','--input-type=module'],{
    input:patch.source,timeout:8000,stdio:['pipe','pipe','pipe']
  });
  log('ROUTING',patch.variant);
  log('PATCH_REQUIRED',patch.applied);
  log('SPLASH_STYLE','AKIRA_GLASS_CORNER');
  log('CDP_SEMANTIC_RUNTIME','PATCH_READY');
  if(mode==='--inspect')return;
  const delegation=await post(port,token,'/v1/session/status');
  if(delegation?.active)throw Error('ACTIVE_DELEGATED_SESSION');

  const source=path.join(release,'bridge-toast.swift');
  const sourceStat=fs.lstatSync(source);
  if(!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size<1000 || sourceStat.size>20000)
    throw Error('INVALID_TOAST_SOURCE');
  const backup=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxBackups/bridge-glass-'+Date.now());
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(backup,'bridge.mjs'),original.contents,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(backup,'controller.env'),oldEnv.contents,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(backup,'runtime.previous.mjs'),oldRuntime.contents,
    {mode:0o600,flag:'wx'});
  if(existingCdp)fs.writeFileSync(path.join(backup,'cdp-semantic.previous.mjs'),
    existingCdp.contents,{mode:0o600,flag:'wx'});
  const previousBinary=fs.existsSync(binary)?safeFile(binary):null;
  if(previousBinary)
    fs.writeFileSync(path.join(backup,'bridge-toast.previous'),
      previousBinary.contents,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(backup,'checksums.txt'),
    'bridge='+hash(original.contents)+'\nenv='+hash(oldEnv.contents)+'\n',
    {mode:0o600,flag:'wx'});

  const compiled=path.join(backup,'bridge-toast.compiled');
  try {
    command('/usr/bin/xcrun',['swiftc','-O',source,
      '-framework','AppKit','-framework','QuartzCore','-o',compiled],120000);
    if(!fs.existsSync(compiled)||!fs.statSync(compiled).size)
      throw Error('COMPILATION_OUTPUT_MISSING');
  }catch(error) {
    // The previous installer obscured the real Swift compile error. Display a
    // bounded diagnostic with source paths redacted; no credentials are read.
    const stderr=String(error?.stderr||error?.message||'').slice(0,2600)
      .replaceAll(os.homedir(),'~').replace(/[\r\n]+/g,' | ');
    log('SWIFT_COMPILER_DIAGNOSTIC',stderr||'NO_COMPILER_OUTPUT');
    throw Error('SWIFT_TOAST_COMPILATION_FAILED_NO_CHANGES');
  }

  try {
    const parent=path.dirname(binary);
    fs.mkdirSync(parent,{recursive:true,mode:0o700});
    const stat=fs.lstatSync(parent);
    if(stat.isSymbolicLink() || !stat.isDirectory() || stat.uid!==process.getuid())
      throw Error('TOAST_DIRECTORY_UNSAFE');
    atomicWrite(binary,fs.readFileSync(compiled),0o700);
    if(hash(oldRuntime.contents)!==hash(upgradedRuntime))
      atomicWrite(runtimeFile,upgradedRuntime,oldRuntime.mode);
    if(!existingCdp || hash(existingCdp.contents)!==hash(cdpSource))
      atomicWrite(cdpFile,cdpSource,existingCdp?.mode||0o600);
    if(original.contents.toString('utf8')!==patch.source)
      atomicWrite(bridgeFile,patch.source,original.mode);
    if(oldEnv.contents.toString('utf8')!==nextEnv)
      atomicWrite(envFile,nextEnv,oldEnv.mode);
    command('/bin/launchctl',['kickstart','-k',label]);
    if(!await ready(port,token))throw Error('BRIDGE_HEALTH_GATE_FAILED');
    const healthy=await post(port,token,'/v2/browser/status');
    if(typeof healthy?.metrics?.inspections_cdp_ax!=='number')
      throw Error('CDP_AX_RUNTIME_HEALTH_GATE_FAILED');
  }catch(error) {
    atomicWrite(bridgeFile,original.contents,original.mode);
    atomicWrite(envFile,oldEnv.contents,oldEnv.mode);
    atomicWrite(runtimeFile,oldRuntime.contents,oldRuntime.mode);
    if(existingCdp)atomicWrite(cdpFile,existingCdp.contents,existingCdp.mode);
    else if(fs.existsSync(cdpFile))fs.unlinkSync(cdpFile);
    if(previousBinary)atomicWrite(binary,previousBinary.contents,previousBinary.mode);
    else if(fs.existsSync(binary))fs.unlinkSync(binary);
    try{command('/bin/launchctl',['kickstart','-k',label]);}
    catch{ /* Recovery copies remain in backup. */ }
    log('ROLLED_BACK','YES');
    log('BACKUP',backup);
    throw Error('INSTALL_ABORTED_'+String(error?.message||error).slice(0,100));
  }
  log('ACTIVATED','PASS');
  log('BRIDGE_HEALTH','PASS');
  log('CDP_AX_ACTION_FALLBACK','READY');
  log('AUTO_DISMISS_MS',5000);
  log('BACKUP',backup);
  // Do not start tabs, move focus or modify a signed-in session to display the splash.
  log('NEXT','Akira splash will appear once on the next successful dedicated Chrome connection');
}
main().catch(error=>{
  log('STOP',String(error?.message||error).slice(0,180));
  process.exitCode=2;
});
