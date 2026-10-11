/* global fetch, AbortSignal, setTimeout */
import process from 'node:process';
/**
 * Channel-based browser provider bootstrap.
 * Uses Playwright's attach-to-running Chrome/Edge channels, never launches a
 * browser or copies a profile, and never publishes a DevTools debugging port.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {
  CHANNELS,inspectDebugMarker,reconcileProviderEnv,matchingTabs,registeredProviders
} from './provider-config.mjs';

const mode=process.argv[2]??'--inspect';
if(!['--inspect','--activate'].includes(mode))throw Error('USE_INSPECT_OR_ACTIVATE');
if(process.platform!=='darwin')throw Error('MAC_OPERATOR_ONLY');
const release=path.dirname(fileURLToPath(import.meta.url));
const home=os.homedir();
const host=path.join(home,'Library','Application Support','LCH','CloudSandboxComputerUse');
const backupRoot=path.join(home,'Library','Application Support','LCH','CloudSandboxBackups');
const connFile=path.join(host,'browser-runtime','connection-pool.mjs');
const stagedFile=path.join(release,'connection-pool.mjs');
const agent='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
const expectedOriginal='d575adac318e4552199a29dad6b07b898033f22cb1a6bb85883d6b7ed86c924e';
const expectedPatched='164a4d0812a63a46ac8e731896a801c51d0a8f84091104b1f7d51fd21a179563';
const requiredPlaywright='1.64.0';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const say=s=>process.stdout.write('[Browser channels] '+s+'\n');
function run(command,args,timeout=25000) {
  try{return execFileSync(command,args,{
    encoding:'utf8',timeout,maxBuffer:5_000_000,stdio:['ignore','pipe','pipe']
  }).trim();}
  catch(error){
    throw Error(error?.code==='ETIMEDOUT'?'OPERATOR_COMMAND_TIMEOUT':'OPERATOR_COMMAND_FAILED');
  }
}
function fileMode(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink())throw Error('UNSAFE_FILE_TYPE');
  return st.mode&0o777;
}
function fileHash(file){
  fileMode(file);
  return sha(fs.readFileSync(file));
}
function atomic(file,content,permissions){
  const target=file+'.browser-channels-'+process.pid+'.tmp';
  fs.writeFileSync(target,content,{flag:'wx',mode:permissions});
  fs.renameSync(target,file);
  fs.chmodSync(file,permissions);
}
function browserMarker(name){
  return name==='chrome'
    ?path.join(home,'Library','Application Support','Google','Chrome','DevToolsActivePort')
    :path.join(home,'Library','Application Support','Microsoft Edge','DevToolsActivePort');
}
function markerState(name){
  const file=browserMarker(name);
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256)throw Error('UNSAFE_CHANNEL_MARKER');
    const data=inspectDebugMarker(fs.readFileSync(file));
    return {browser:name,ready:true,port:data.port};
  }catch(error){
    if(error?.code==='ENOENT')return {browser:name,ready:false,reason:'REMOTE_DEBUGGING_NOT_ENABLED'};
    return {browser:name,ready:false,reason:'INVALID_OR_STALE_CHANNEL_MARKER'};
  }
}
async function post(token,endpoint,input={},timeMs=10000){
  let response;
  try{
    response=await fetch('http://127.0.0.1:9764'+endpoint,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(timeMs),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify(input)
    });
  }catch{throw Error('MAC_BRIDGE_UNREACHABLE');}
  const text=await response.text();
  if(text.length>4_000_000)throw Error('BRIDGE_REPLY_TOO_LARGE');
  let result;
  try{result=JSON.parse(text);}catch{throw Error('MALFORMED_MAC_BRIDGE_REPLY');}
  if(!response.ok||!result?.ok)throw Error('BRIDGE_OPERATION_FAILED');
  return result.data;
}
async function verifyAttaches(token){
  const packageFile=path.join(host,'node_modules','playwright-core','package.json');
  fileMode(packageFile);
  const pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));
  if(pkg.version!==requiredPlaywright)throw Error('UNSUPPORTED_PLAYWRIGHT_VERSION');
  const {chromium}=await import(pathToFileURL(path.join(host,'node_modules','playwright-core','index.mjs')).href);
  for(const [browser,channel] of Object.entries(CHANNELS)){
    const live=await post(token,'/v1/state',{browser});
    const entries=live?.browsers?.find(item=>item.browser===browser);
    if(!entries?.running)throw Error('ORIGINAL_BROWSER_NOT_RUNNING');
    const native=entries.windows.flatMap(w=>w.tabs.map(t=>t.url));
    let attached;
    try{
      // This uses the default user profile already opened on the Mac.
      // noDefaults avoids Playwright's launch-specific media/focus overrides.
      attached=await chromium.connectOverCDP(channel,{timeout:16000,noDefaults:true});
      const connected=attached.contexts().flatMap(c=>c.pages().map(p=>p.url()));
      const identity=matchingTabs(connected,native);
      if(!identity.verified)throw Error('AUTHENTICATED_PROFILE_IDENTITY_MISMATCH');
      say(browser.toUpperCase()+'_EXISTING_PROFILE_VERIFIED: matched '+
        identity.matched_pages+' tabs (URLs and titles not displayed).');
    }catch(error){
      if(error?.message==='AUTHENTICATED_PROFILE_IDENTITY_MISMATCH')throw error;
      throw Error('CHANNEL_ATTACH_FAILED_'+browser.toUpperCase());
    }finally{
      if(attached)await attached.close().catch(()=>{});
    }
  }
}
async function main(){
  // The current controller's Compose metadata locates the exact existing .env
  // without guessing paths, touching workstations, or creating any container.
  const containers=JSON.parse(run('docker',['inspect','cloud-sandbox-mcp'],60000));
  if(!Array.isArray(containers)||containers.length!==1||!containers[0].State?.Running)
    throw Error('MCP_CONTROLLER_NOT_RUNNING');
  const labels=containers[0].Config.Labels||{};
  if(labels['com.docker.compose.service']!=='mcp')
    throw Error('CONTROLLER_SERVICE_IDENTITY_DRIFT');
  const working=fs.realpathSync(labels['com.docker.compose.project.working_dir']||'');
  const envFile=path.join(working,'.env');
  const envMode=fileMode(envFile);
  if((envMode&0o077)!==0)throw Error('INSECURE_CONTROLLER_ENV_PERMISSIONS');
  const originalEnv=fs.readFileSync(envFile,'utf8');
  const line=name=>{
    const matches=originalEnv.split(/\r?\n/).filter(item=>item.startsWith(name+'='));
    if(matches.length!==1)throw Error('ENV_SETTING_MISSING_OR_DUPLICATE');
    return matches[0].slice(name.length+1).replace(/^["']|["']$/g,'').trim();
  };
  if(line('COMPUTER_USE_ENABLED')!=='true'||line('COMPUTER_USE_BROWSER_V2')!=='true')
    throw Error('BROWSER_RUNTIME_V2_NOT_ENABLED');
  const token=line('COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)throw Error('BRIDGE_AUTHENTICATION_MISSING');
  const runtime=await post(token,'/v2/browser/status');
  const nativeStatus=await post(token,'/v1/status');
  if(nativeStatus?.delegated_session?.active)throw Error('ACTIVE_COMPUTER_USE_SESSION_STOP_FIRST');
  if(!runtime || runtime.enabled!==true || runtime.version!=='2.0.0')
    throw Error('UNSUPPORTED_BROWSER_RUNTIME');
  const changedEnv=reconcileProviderEnv(originalEnv);
  const newHash=fileHash(stagedFile);
  if(newHash!==expectedPatched)throw Error('CHANNEL_RELEASE_SOURCE_HASH_MISMATCH');
  const actualHash=fileHash(connFile);
  if(![expectedOriginal,newHash].includes(actualHash))throw Error('LIVE_BROWSER_ADAPTER_CODE_DRIFT');
  const markers=Object.keys(CHANNELS).map(markerState);
  for(const marker of markers){
    say(marker.browser.toUpperCase()+'_CHANNEL='+
      (marker.ready?'READY':'NOT_READY_'+marker.reason));
  }
  say('No browser launches, profile migration, new public ports or domain lists.');
  if(mode==='--inspect'){
    say(markers.every(v=>v.ready)?'PREFLIGHT_READY_TO_ATTACH':
      'PREFLIGHT_HOLD: enable remote debugging in the existing Chrome and Edge instances.');
    return;
  }
  if(!markers.every(v=>v.ready))throw Error('BROWSER_REMOTE_DEBUGGING_NOT_READY');
  if(actualHash===newHash && changedEnv===originalEnv &&
      registeredProviders(runtime)){
    say('CHANNELS_ALREADY_CONFIGURED: no changes.');
    return;
  }

  run('/bin/launchctl',['print',agent],15000);
  await verifyAttaches(token);
  // Do not interrupt a task that began during the two browser preflights.
  if((await post(token,'/v1/status'))?.delegated_session?.active)
    throw Error('COMPUTER_USE_SESSION_STARTED_DURING_PREFLIGHT');
  // The explicit --activate invocation is the operator deployment consent.
  // No per-click approvals or arbitrary browser/debug settings are changed.
  const backup=path.join(backupRoot,'browser-channels-'+Date.now()+'-'+process.pid);
  await fsp.mkdir(backup,{recursive:true,mode:0o700});
  await fsp.chmod(backup,0o700);
  await fsp.writeFile(path.join(backup,'controller.env'),originalEnv,{mode:0o600,flag:'wx'});
  await fsp.writeFile(path.join(backup,'connection-pool.mjs'),
    fs.readFileSync(connFile),{mode:0o600,flag:'wx'});
  await fsp.writeFile(path.join(backup,'receipt.json'),JSON.stringify({
    operation:'browser-channel-provider-activation',
    browsers:Object.keys(CHANNELS),previous_connections:runtime.providers?.length||0,
    deployed_at:new Date().toISOString(),bridge_code_before_hash:actualHash,
    bridge_code_after_hash:newHash
  },null,2),{mode:0o600,flag:'wx'});
  let attempted=false;
  try{
    attempted=true;
    if(actualHash!==newHash)atomic(connFile,fs.readFileSync(stagedFile),0o600);
    if(changedEnv!==originalEnv)atomic(envFile,changedEnv,envMode);
    run('/bin/launchctl',['kickstart','-k',agent],30000);
    let configured;
    for(let n=0;n<32;n++){
      try{
        configured=await post(token,'/v2/browser/status');
        if(registeredProviders(configured))break;
      }catch{ /* Mac bridge may still be restarting. */ }
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!registeredProviders(configured))throw Error('RESTARTED_BRIDGE_DID_NOT_ENABLE_BOTH_PROVIDERS');
    for(const browser of Object.keys(CHANNELS)){
      const result=await post(token,'/v2/browser/tabs',{browser},30000);
      if(!Array.isArray(result?.tabs)||result.tabs.length<1)
        throw Error('PERSISTENT_TABS_UNAVAILABLE_'+browser.toUpperCase());
      say(browser.toUpperCase()+'_PERSISTENT_TABS_PASS: '+result.tabs.length+' available.');
    }
    say('BROWSER_CHANNEL_PROVIDERS_ACTIVE: Chrome and Edge attached by channel.');
    say('PRIVATE_BACKUP='+backup);
  }catch(error){
    say('VALIDATION_FAILED: restoring previous Mac bridge and .env.');
    try{
      if(attempted){
        atomic(connFile,fs.readFileSync(path.join(backup,'connection-pool.mjs')),0o600);
        atomic(envFile,originalEnv,envMode);
        run('/bin/launchctl',['kickstart','-k',agent],30000);
        await post(token,'/v1/status');
      }
      say('ROLLBACK_COMPLETE: original configuration restored.');
    }catch{
      say('ROLLBACK_REQUIRES_OPERATOR: preserve backup at '+backup);
    }
    throw error;
  }
}
try{await main();}
catch(error){
  say('STOP: '+String(error?.message||'UNKNOWN').replace(/[^\x20-\x7e]/g,'').slice(0,150));
  process.exitCode=2;
}
