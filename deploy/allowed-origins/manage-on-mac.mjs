#!/usr/bin/env node
/* global fetch, AbortSignal */
/**
 * Operator-owned, exact HTTPS origin self-service manager.
 * Mac-only: no code release, CDP attachment, browser/profile manipulation,
 * Docker restart, arbitrary shell command or policy relaxation.
 *
 * add <URL>     Add one HTTPS origin and verify a guarded Mac Bridge reload
 * check <URL>   Read-only effective allowlist/config count comparison
 * remove <URL>  Revoke one exact origin (wildcard coverage refuses false revoke)
 * list          Read-only exact and previously approved wildcard entries
 * install-cli   Register the optional sandbox-origins Mac Terminal shortcut
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {TextDecoder} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {changeExactOrigin,parseOriginSettings,SHORTCUT_SCRIPT,SHORTCUT_VERSION} from './origin-manager-config.mjs';

const prefix='[Sandbox V3 Origins] ';
const log=(name,value)=>process.stdout.write(prefix+name+'='+String(value)+'\n');
const fail=code=>{throw Error(code);};
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const launchLabel='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';

function usage() {
  process.stdout.write('Usage:\n'+
    '  node manage-on-mac.mjs add https://admin.powerplatform.microsoft.com\n'+
    '  node manage-on-mac.mjs check https://admin.powerplatform.microsoft.com\n'+
    '  node manage-on-mac.mjs remove https://admin.powerplatform.microsoft.com\n'+
    '  node manage-on-mac.mjs list\n'+
    '  node manage-on-mac.mjs install-cli\n'+
    'Accepts an HTTPS page URL, but grants ONLY its exact origin.\n');
}
function command(file,args,timeout=16000) {
  try{
    return execFileSync(file,args,{encoding:'utf8',timeout,
      stdio:['ignore','pipe','pipe'],maxBuffer:1_200_000}).trim();
  }catch{fail('OPERATOR_COMMAND_FAILED');}
}
function safeFile(filename) {
  const stat=fs.lstatSync(filename);
  if(!stat.isFile() || stat.isSymbolicLink() ||
     stat.uid!==process.getuid() ||
     (stat.mode&0o022)!==0 || stat.size>2_000_000)
    fail('UNSAFE_CONTROLLER_ENV');
  return {bytes:fs.readFileSync(filename),mode:stat.mode&0o777};
}
function readSetting(source,name,{optional=false}={}) {
  const found=source.split(/\r?\n/).filter(line=>line.startsWith(name+'='));
  if(optional && found.length===0)return null;
  if(found.length!==1)fail('INVALID_CONFIG_'+name);
  const raw=found[0].slice(name.length+1).trim();
  if(raw.length>=2 &&
    (raw.startsWith('"')&&raw.endsWith('"') ||
     raw.startsWith("'")&&raw.endsWith("'")))
    return raw.slice(1,-1);
  return raw;
}
async function post(port,token,endpoint) {
  const response=await fetch('http://127.0.0.1:'+port+endpoint,{
    method:'POST',redirect:'error',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(3000)
  });
  if(!response.ok)fail('BRIDGE_STATUS_HTTP_'+response.status);
  const data=await response.json();
  if(!data?.ok || !data.data || typeof data.data!=='object')
    fail('INVALID_BRIDGE_STATUS');
  return data.data;
}
async function readLiveState(port,token,attempts=1) {
  for(let i=0;i<attempts;i++){
    try{
      const [native,runtime]=await Promise.all([
        post(port,token,'/v1/status'),post(port,token,'/v2/browser/status')
      ]);
      return {native,runtime};
    }catch{
      if(i===attempts-1)break;
      await sleep(500);
    }
  }
  fail('MAC_BRIDGE_STATUS_UNAVAILABLE');
}
function assertSafePolicy(state,expectedOrigins) {
  const native=state.native;
  const runtime=state.runtime;
  if(native?.allowlisted_origins!==expectedOrigins.length ||
     native?.mutation_policy!=='allowlist_only' ||
     native?.trusted_delegation_notice?.enabled!==true ||
     native?.trusted_delegation_notice?.max_minutes!==30 ||
     !Array.isArray(native?.browsers) ||
     !['chrome','edge'].every(b=>native.browsers.includes(b)) ||
     runtime?.enabled!==true ||
     runtime?.mutation_policy!=='allowlist_only')
    fail('BRIDGE_ORIGIN_COUNT_OR_POLICY_DRIFT');
  const lchWildcard=expectedOrigins.includes('https://*.lch-app.cloud');
  if(native?.lch_app_cloud_wildcard_enabled!==lchWildcard ||
     runtime?.lch_app_cloud_wildcard_enabled!==lchWildcard)
    fail('WILDCARD_DRIVER_POLICY_DRIFT');
}
function atomicReplace(filename,bytes,mode){
  const temp=filename+'.origin-manager-'+process.pid+'.tmp';
  const fd=fs.openSync(temp,'wx',mode);
  try{
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  try{
    fs.renameSync(temp,filename);
    fs.chmodSync(filename,mode);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function lockDirectory(dir) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(dir);
  if(!stat.isDirectory() || stat.isSymbolicLink() ||
     stat.uid!==process.getuid() || (stat.mode&0o022)!==0)
    fail('UNSAFE_BACKUP_DIRECTORY');
  const lockFile=path.join(dir,'.origin-manager.lock');
  let fd;
  try{fd=fs.openSync(lockFile,'wx',0o600);}
  catch(error) {
    if(error?.code==='EEXIST')fail('ORIGIN_MANAGER_BUSY_REVIEW_STALE_LOCK');
    throw error;
  }
  fs.writeSync(fd,String(process.pid)+'\n');
  return ()=>{
    try{fs.closeSync(fd);}
    finally{fs.unlinkSync(lockFile);}
  };
}
function controllerEnvFile(){
  const info=JSON.parse(command('docker',['inspect','cloud-sandbox-mcp']))[0];
  if(!info?.State?.Running ||
     info?.Config?.Labels?.['com.docker.compose.service']!=='mcp')
    fail('UNEXPECTED_CONTROLLER_IDENTITY');
  const directory=info.Config.Labels['com.docker.compose.project.working_dir'];
  if(typeof directory!=='string'||!path.isAbsolute(directory))
    fail('COMPOSE_DIRECTORY_NOT_FOUND');
  return path.join(fs.realpathSync(directory),'.env');
}
function safeOperatorDirectory(directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     stat.uid!==process.getuid()||(stat.mode&0o022)!==0)
    fail('UNSAFE_OPERATOR_INSTALL_DIRECTORY');
}
function installShortcut() {
  const home=os.homedir();
  const release=path.join(home,'.cloud-sandbox-mcp-data','shared-auth',
    'deployment','handoff','cloud-sandbox-computer-use','allowed-origins');
  const entry=path.join(release,'manage-on-mac.mjs');
  if(fs.realpathSync(fileURLToPath(import.meta.url))!==fs.realpathSync(entry))
    fail('MUST_INSTALL_FROM_VERIFIED_SHARED_RELEASE');
  const sourceFiles=['manage-on-mac.mjs','origin-manager-config.mjs',
    'allowed-origins.mjs'];
  const sources=new Map(sourceFiles.map(name=>[
    name,safeFile(path.join(release,name)).bytes]));
  const localRoot=path.join(home,'.local');
  const localShare=path.join(localRoot,'share');
  safeOperatorDirectory(localRoot);
  safeOperatorDirectory(localShare);
  const privateRoot=path.join(localShare,'sandbox-v3-origins');
  const versionDir=path.join(privateRoot,SHORTCUT_VERSION);
  const bin=path.join(home,'.local','bin');
  safeOperatorDirectory(privateRoot);
  safeOperatorDirectory(bin);
  const installed=fs.existsSync(versionDir);
  if(installed){
    const dir=fs.lstatSync(versionDir);
    if(!dir.isDirectory()||dir.isSymbolicLink()||
       dir.uid!==process.getuid()||(dir.mode&0o077)!==0)
      fail('UNSAFE_INSTALLED_RELEASE_DIRECTORY');
    for(const [name,bytes] of sources){
      if(!safeFile(path.join(versionDir,name)).bytes.equals(bytes))
        fail('INSTALLED_RELEASE_DRIFT_REVIEW_REQUIRED');
    }
  }else{
    const temp=versionDir+'.install-'+process.pid+'.tmp';
    fs.mkdirSync(temp,{mode:0o700});
    try{
      for(const [name,bytes] of sources)
        fs.writeFileSync(path.join(temp,name),bytes,{flag:'wx',mode:0o600});
      fs.renameSync(temp,versionDir);
    }finally{if(fs.existsSync(temp))fs.rmSync(temp,{recursive:true});}
  }
  const script=Buffer.from(SHORTCUT_SCRIPT,'utf8');
  const file=path.join(bin,'sandbox-origins');
  let existing;
  try{existing=fs.lstatSync(file);}
  catch(error){if(error?.code!=='ENOENT')throw error;}
  if(existing){
    if(!existing.isFile()||existing.isSymbolicLink())
      fail('EXISTING_SANDBOX_ORIGINS_COMMAND_CONFLICT');
    const previous=safeFile(file);
    if(!previous.bytes.equals(script))fail('EXISTING_SANDBOX_ORIGINS_COMMAND_CONFLICT');
    if((previous.mode&0o111)===0)fail('SHORTCUT_NOT_EXECUTABLE_REVIEW_REQUIRED');
    log('CLI_INSTALLED','PASS_ALREADY_CONFIGURED');
  }else{
    const tmp=file+'.origin-manager-install-'+process.pid+'.tmp';
    fs.writeFileSync(tmp,script,{flag:'wx',mode:0o700});
    try{
      fs.chmodSync(tmp,0o755);
      fs.linkSync(tmp,file); // Never replace an existing user command.
    }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    log('CLI_INSTALLED','PASS');
  }
  log('INSTALLED_CODE','MAC_PRIVATE_PINNED');
  log('INSTALLED_VERSION',SHORTCUT_VERSION);
  log('COMMAND','sandbox-origins add https://example.com');
}

async function main(){
  const [operation,rawUrl,...extra]=process.argv.slice(2);
  if(operation==='--help'||operation==='help'||!operation) {
    usage();return;
  }
  if(process.platform!=='darwin')fail('MACOS_OPERATOR_ONLY');
  if(process.getuid()===0)fail('RUN_AS_MAC_OPERATOR_NOT_ROOT');
  if(operation==='install-cli' && rawUrl===undefined && extra.length===0){
    installShortcut();return;
  }
  if(!['add','remove','check','list'].includes(operation) ||
     extra.length || (operation==='list' ? rawUrl!==undefined : !rawUrl)){
    usage();fail('USAGE_ADD_REMOVE_CHECK_OR_LIST');
  }
  const envFile=controllerEnvFile();
  const original=safeFile(envFile);
  const source=decode(original.bytes);
  if(readSetting(source,'COMPUTER_USE_ENABLED')!=='true' ||
     readSetting(source,'COMPUTER_USE_BROWSER_V2')!=='true')
    fail('MAC_BRIDGE_RUNTIME_DISABLED');
  const token=readSetting(source,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)fail('BRIDGE_AUTH_NOT_CONFIGURED');
  const port=Number(readSetting(source,'COMPUTER_USE_BRIDGE_PORT',{optional:true})||9764);
  if(!Number.isInteger(port)||port<1024||port>65535)
    fail('UNSAFE_BRIDGE_PORT');
  const update=operation==='list'?null:changeExactOrigin(source,operation,rawUrl);
  const before=parseOriginSettings(source);
  const current=await readLiveState(port,token);
  assertSafePolicy(current,before.origins);
  log('MODE',operation.toUpperCase());
  log('ORIGINS_BEFORE',before.origins.length);
  if(operation==='list'){
    for(const origin of before.origins)log('ALLOWED_ORIGIN',origin);
    log('INSPECT','PASS_READ_ONLY');
    return;
  }
  log('TARGET_ORIGIN',update.entry);
  log('CURRENTLY_ALLOWED',update.alreadyAllowed?'YES':'NO');
  log('ORIGINS_AFTER',update.afterCount);
  if(operation==='check'){
    log('ALLOWED',update.allowedAfter?'YES':'NO');
    log('INSPECT','PASS_READ_ONLY');
    return;
  }
  if(!update.changed){
    log('ACTIVATED',operation==='add'?'PASS_ALREADY_ALLOWED':'PASS_NOT_PRESENT');
    log('BRIDGE_HEALTH','PASS');
    return;
  }
  const session=await post(port,token,'/v1/session/status');
  if(session?.active || current.native.delegated_session?.active)
    fail('ACTIVE_DELEGATED_SESSION_RETRY_AFTER_COMPLETION');
  command('/bin/launchctl',['print',launchLabel]);
  const backupRoot=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxBackups');
  const unlock=lockDirectory(backupRoot);
  let backupDir=null;
  let applied=false;
  try{
    // Recheck after acquiring the lock to avoid overwriting another agent's
    // or operator's edits, and never interrupt an active delegated grant.
    if(!safeFile(envFile).bytes.equals(original.bytes))
      fail('CONCURRENT_CONTROLLER_ENV_CHANGE');
    if((await post(port,token,'/v1/session/status'))?.active)
      fail('DELEGATED_SESSION_STARTED_DURING_PREFLIGHT');
    backupDir=path.join(backupRoot,
      'sandbox-v3-origin-'+Date.now()+'-'+process.pid);
    fs.mkdirSync(backupDir,{mode:0o700});
    fs.writeFileSync(path.join(backupDir,'controller.env.previous'),
      original.bytes,{flag:'wx',mode:0o600});
    const now=new Date().toISOString();
    const receipt={timestamp:now,action:operation,origin:update.entry,
      beforeCount:update.beforeCount,afterCount:update.afterCount,
      bridgeService:'com.lch.cloud-sandbox.computer-use'};
    log('BACKUP',backupDir);
    atomicReplace(envFile,Buffer.from(update.updated,'utf8'),original.mode);
    applied=true;
    const persisted=parseOriginSettings(decode(safeFile(envFile).bytes));
    if(JSON.stringify(persisted.origins)!==JSON.stringify(update.origins))
      fail('POST_WRITE_CONFIG_MISMATCH');
    if((await post(port,token,'/v1/session/status'))?.active)
      fail('DELEGATED_SESSION_STARTED_BEFORE_BRIDGE_RELOAD');
    command('/bin/launchctl',['kickstart','-k',launchLabel],25000);
    const after=await readLiveState(port,token,30);
    assertSafePolicy(after,update.origins);
    const verified=changeExactOrigin(decode(safeFile(envFile).bytes),
      'check',update.entry);
    if(verified.allowedAfter!==update.allowedAfter ||
       verified.beforeCount!==update.afterCount)
      fail('POST_WRITE_CONFIG_MISMATCH');
    fs.writeFileSync(path.join(backupDir,'receipt.json'),
      JSON.stringify({...receipt,result:'PASS'},null,2)+'\n',
      {flag:'wx',mode:0o600});
    log('ACTIVATED','PASS');
    log('BRIDGE_HEALTH','PASS');
    log('ORIGINS_ACTIVE',after.native.allowlisted_origins);
    log('OPERATION',operation.toUpperCase());
  }catch(error){
    if(applied){
      let restored=false;
      try{
        atomicReplace(envFile,original.bytes,original.mode);
        command('/bin/launchctl',['kickstart','-k',launchLabel],25000);
        assertSafePolicy(await readLiveState(port,token,30),before.origins);
        restored=true;
      }catch{ /* Original configuration remains in private backup. */ }
      log('ROLLBACK',restored?'PASS':'INCOMPLETE_REVIEW_BACKUP');
    }
    if(backupDir)log('BACKUP',backupDir);
    fail('ORIGIN_OPERATION_FAILED_'+String(error?.message||'UNKNOWN').slice(0,95));
  }finally{unlock();}
}
main().catch(error=>{
  log('STOP',String(error?.message||'UNKNOWN').slice(0,170));
  process.exitCode=2;
});
