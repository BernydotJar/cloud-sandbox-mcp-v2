/* global fetch, AbortSignal, Buffer */
/**
 * One-shot, additive HTTPS domain policy update. Operator-run on macOS.
 *
 * --inspect  : zero-change validation against live Mac Bridge
 * --activate : private backup, guarded .env/Bridge/Runtime change,
 *              restart ONLY Mac Bridge LaunchAgent, verify, rollback on failure.
 *
 * Does not launch browsers, attach CDP, change profiles, replace the
 * controller or require shell access from the Linux workstation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {TextDecoder} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {addLchOrigins,LINKEDIN_APEX,LINKEDIN_WILDCARD,LCH_APEX,LCH_WILDCARD,UIPATH_APEX,UIPATH_WILDCARD,ATLASSIAN_APEX,ATLASSIAN_WILDCARD} from './wildcard-config.mjs';
import {patchBridgeForLchWildcard,patchRuntimeForLchWildcard}
  from './upgrade-lch-wildcard.mjs';
import {validAllowlistEntry} from './allowed-origins.mjs';
import {createHash} from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
const log=(key,val)=>process.stdout.write('[LCH Bridge Origins] '+key+'='+val+'\n');
const fail=code=>{throw Error(code);};

function command(binary,args,timeout=16000){
  try{return execFileSync(binary,args,{encoding:'utf8',timeout,
    stdio:['ignore','pipe','pipe'],maxBuffer:1200000}).trim();}
  catch{fail('LOCAL_COMMAND_FAILED');}
}
function safeOwnedFile(file,{optional=false}={}){
  if(optional && !fs.existsSync(file))return null;
  const stat=fs.lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink() ||
     stat.uid!==process.getuid() || (stat.mode & 0o022)!==0 || stat.size>2000000)
    fail('UNSAFE_OR_UNOWNED_FILE');
  return {bytes:fs.readFileSync(file),mode:stat.mode&0o777};
}
function readUtf8(bytes){
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function envValue(env,name,{optional=false}={}){
  const entries=env.split(/\r?\n/).filter(x=>x.startsWith(name+'='));
  if(optional && entries.length===0)return null;
  if(entries.length!==1)fail('INVALID_CONFIG_'+name);
  const raw=entries[0].slice(name.length+1).trim();
  return raw.length>=2 && (
    raw.startsWith('"') && raw.endsWith('"') ||
    raw.startsWith("'") && raw.endsWith("'")
  ) ? raw.slice(1,-1):raw;
}
function atomicReplace(file,bytes,mode){
  const temp=file+'.lch-wildcard-'+process.pid+'.tmp';
  fs.writeFileSync(temp,bytes,{flag:'wx',mode});
  try{fs.renameSync(temp,file);fs.chmodSync(file,mode);}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function syntaxCheck(source){
  try {
    execFileSync(process.execPath,['--check','--input-type=module'],{
      input:source,timeout:10000,stdio:['pipe','pipe','pipe'],maxBuffer:100000
    });
  }catch {fail('MIGRATED_JAVASCRIPT_SYNTAX_FAILURE');}
}
async function bridgePost(port,token,route){
  const response=await fetch('http://127.0.0.1:'+port+route,{
    method:'POST',headers:{
      authorization:'Bearer '+token,
      'content-type':'application/json'
    },body:'{}',signal:AbortSignal.timeout(3000)
  });
  if(!response.ok)fail('BRIDGE_HTTP_'+response.status);
  const body=await response.json();
  if(!body?.ok || typeof body.data!=='object')fail('INVALID_BRIDGE_STATUS');
  return body.data;
}
async function waitForBridge(port,token){
  for(let i=0;i<23;i++){
    try{
      const [native,runtime]=await Promise.all([
        bridgePost(port,token,'/v1/status'),
        bridgePost(port,token,'/v2/browser/status')
      ]);
      return {native,runtime};
    }catch{
      if(i===22)break;
      await sleep(500);
    }
  }
  fail('MAC_BRIDGE_NOT_READY');
}
function policyCheck(snapshot,expectedCount,wildcardEnabled){
  const {native,runtime}=snapshot;
  if(native?.allowlisted_origins!==expectedCount ||
     native?.mutation_policy!=='allowlist_only' ||
     native?.trusted_delegation_notice?.enabled!==true ||
     native?.trusted_delegation_notice?.max_minutes!==30 ||
     native?.trusted_delegation_notice?.unlimited_actions!==true ||
     runtime?.enabled!==true ||
     runtime?.mutation_policy!=='allowlist_only')
    fail('BRIDGE_POLICY_OR_COUNT_MISMATCH');
  if(wildcardEnabled){
    if(native?.lch_app_cloud_wildcard_enabled!==true ||
       runtime?.lch_app_cloud_wildcard_enabled!==true)
      fail('WILDCARD_NOT_ACTIVE_IN_BOTH_DRIVERS');
  } else if(native?.lch_app_cloud_wildcard_enabled===true ||
            runtime?.lch_app_cloud_wildcard_enabled===true){
    fail('WILDCARD_ALREADY_ACTIVE_UNEXPECTEDLY');
  }
}
async function main(){
  if(process.platform!=='darwin')fail('MACOS_ONLY');
  const mode=process.argv[2]||'--inspect';
  if(!['--inspect','--activate'].includes(mode) || process.argv.length>3)
    fail('INVALID_MODE');
  const controller=JSON.parse(command('docker',['inspect','cloud-sandbox-mcp']))[0];
  if(!controller?.State?.Running ||
     controller?.Config?.Labels?.['com.docker.compose.service']!=='mcp')
    fail('UNEXPECTED_CONTROLLER');
  const workingDir=controller.Config.Labels['com.docker.compose.project.working_dir'];
  if(typeof workingDir!=='string' || !workingDir.startsWith('/'))
    fail('COMPOSE_ROOT_NOT_FOUND');
  const envFile=path.join(fs.realpathSync(workingDir),'.env');
  const macRoot=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse');
  const bridgeFile=path.join(macRoot,'bridge.mjs');
  const runtimeFile=path.join(macRoot,'browser-runtime','runtime.mjs');
  const helperFile=path.join(macRoot,'allowed-origins.mjs');
  const stored={
    env:safeOwnedFile(envFile),
    bridge:safeOwnedFile(bridgeFile),
    runtime:safeOwnedFile(runtimeFile),
    helper:safeOwnedFile(helperFile,{optional:true})
  };
  const rawEnv=readUtf8(stored.env.bytes);
  if(envValue(rawEnv,'COMPUTER_USE_ENABLED')!=='true' ||
     envValue(rawEnv,'COMPUTER_USE_BROWSER_V2')!=='true' ||
     envValue(rawEnv,'COMPUTER_USE_TRUSTED_SESSION_NOTICE')!=='true')
    fail('REQUIRED_MAC_BRIDGE_SETTINGS_MISSING');
  const token=envValue(rawEnv,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)fail('BRIDGE_TOKEN_INVALID');
  const port=Number(envValue(rawEnv,'COMPUTER_USE_BRIDGE_PORT',{optional:true})||9764);
  if(!Number.isInteger(port)||port<1024||port>65535)
    fail('BRIDGE_PORT_INVALID');
  const next=addLchOrigins(rawEnv);
  const bridgePatch=patchBridgeForLchWildcard(readUtf8(stored.bridge.bytes));
  const runtimePatch=patchRuntimeForLchWildcard(readUtf8(stored.runtime.bytes));
  // This is only supported on the operator-provisioned, trusted Mac Bridge.
  if(!bridgePatch.source.includes('LCH_BRIDGE_TRUSTED_NOTICE_V2') ||
     !runtimePatch.source.includes('cdp_ax_fallback'))
    fail('UNKNOWN_MAC_BRIDGE_VERSION_NO_CHANGES');
  const helperRelease=safeOwnedFile(path.join(here,'allowed-origins.mjs'),{optional:false});
  const helperCode=readUtf8(helperRelease.bytes);
  if(!helperCode.includes('LCH_WILDCARD') ||
     !helperCode.includes('allowsWebOrigin') ||
     !validAllowlistEntry(LCH_WILDCARD))
    fail('INVALID_LCH_HELPER_RELEASE');
  if(stored.helper && !stored.helper.bytes.equals(helperRelease.bytes)){
    const oldSha=createHash('sha256').update(stored.helper.bytes).digest('hex');
    if(!new Set(['aea794ebd723c452ae6427b7064f3815d54033fbf23884a9ce397a475a227c04','7a7bac24d127c891f9932b92646aa19155c89ddbd900667a5a46be551cbb53fc']).has(oldSha))
      fail('EXISTING_ORIGIN_HELPER_MISMATCH');
  }
  syntaxCheck(bridgePatch.source);
  syntaxCheck(runtimePatch.source);
  syntaxCheck(helperCode);
  const launchLabel='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
  command('/bin/launchctl',['print',launchLabel]);
  const before=await waitForBridge(port,token);
  policyCheck(before,next.beforeCount,
    next.alreadyWildcard && !bridgePatch.changed && !runtimePatch.changed);
  log('MODE',mode);
  log('APEX',LCH_APEX);
  log('LINKEDIN_APEX',LINKEDIN_APEX);
  log('LINKEDIN_WILDCARD',LINKEDIN_WILDCARD);
  log('SUBDOMAIN_PATTERN',LCH_WILDCARD);
  log('UIPATH_APEX',UIPATH_APEX);
  log('UIPATH_WILDCARD',UIPATH_WILDCARD);
  log('ATLASSIAN_APEX',ATLASSIAN_APEX);
  log('ATLASSIAN_WILDCARD',ATLASSIAN_WILDCARD);
  log('TARGET_BROWSERS','CHROME_EDGE_SHARED_ALLOWLIST');
  log('ORIGINS_BEFORE',next.beforeCount);
  log('ORIGINS_AFTER',next.afterCount);
  log('EXISTING_ORIGINS','PRESERVED');
  log('CHROME_PROFILES','UNCHANGED');
  const requiresChanges=next.changed || bridgePatch.changed ||
    runtimePatch.changed || !stored.helper;
  log('PATCH_REQUIRED',requiresChanges?'YES':'NO');
  if(mode==='--inspect'){
    log('INSPECT','PASS_READ_ONLY');
    return;
  }
  if(!requiresChanges){
    policyCheck(before,next.afterCount,true);
    log('ACTIVATED','PASS_ALREADY_CONFIGURED');
    log('BRIDGE_HEALTH','PASS');
    return;
  }
  const session=await bridgePost(port,token,'/v1/session/status');
  if(session?.active)fail('ACTIVE_DELEGATED_SESSION_NO_CHANGES');
  // Fail closed when an operator edited the files while preflight ran.
  const files=[
    [envFile,stored.env],
    [bridgeFile,stored.bridge],
    [runtimeFile,stored.runtime]
  ];
  for(const [file,entry] of files)
    if(!safeOwnedFile(file).bytes.equals(entry.bytes))fail('CONCURRENT_CONFIGURATION_CHANGE');
  const existingHelper=safeOwnedFile(helperFile,{optional:true});
  if(Boolean(existingHelper)!==Boolean(stored.helper) ||
     (existingHelper && !existingHelper.bytes.equals(stored.helper.bytes)))
    fail('CONCURRENT_ORIGIN_HELPER_CHANGE');
  const backupDir=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxBackups',
    'lch-wildcard-origin-'+Date.now()+'-'+process.pid);
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  for(const [name,content] of Object.entries(stored)){
    if(content)fs.writeFileSync(path.join(backupDir,name+'.previous'),
      content.bytes,{flag:'wx',mode:0o600});
  }
  const changes=new Map([
    [envFile,{bytes:Buffer.from(next.updated,'utf8'),old:stored.env}],
    [bridgeFile,{bytes:Buffer.from(bridgePatch.source,'utf8'),old:stored.bridge}],
    [runtimeFile,{bytes:Buffer.from(runtimePatch.source,'utf8'),old:stored.runtime}],
    [helperFile,{bytes:helperRelease.bytes,old:stored.helper}]
  ]);
  const touched=[];
  try {
    for(const [file,entry] of changes){
      if(!entry.old || !entry.bytes.equals(entry.old.bytes)){
        atomicReplace(file,entry.bytes,entry.old?.mode||0o600);
        touched.push(file);
      }
    }
    command('/bin/launchctl',['kickstart','-k',launchLabel]);
    const after=await waitForBridge(port,token);
    policyCheck(after,next.afterCount,true);
    const reloaded=addLchOrigins(readUtf8(safeOwnedFile(envFile).bytes));
    if(reloaded.changed || !reloaded.alreadyApex || !reloaded.alreadyWildcard)
      fail('POST_WRITE_CONFIG_VALIDATION_FAILED');
    log('ACTIVATED','PASS');
    log('BRIDGE_HEALTH','PASS');
    log('APEX_ALLOWED','YES');
    log('SUBDOMAIN_PATTERN_ACTIVE','YES');
    log('UIPATH_ATLASSIAN_PATTERNS_ACTIVE','YES');
    log('LINKEDIN_SUBDOMAINS_ACTIVE','YES');
    log('ORIGINS_ACTIVE',after.native.allowlisted_origins);
    log('BACKUP',backupDir);
  }catch(error) {
    let rolledBack=true;
    try{
      for(const file of [...touched].reverse()){
        const old=changes.get(file).old;
        if(old)atomicReplace(file,old.bytes,old.mode);
        else if(fs.existsSync(file))fs.unlinkSync(file);
      }
      command('/bin/launchctl',['kickstart','-k',launchLabel]);
      const restored=await waitForBridge(port,token);
      policyCheck(restored,next.beforeCount,
        next.alreadyWildcard && !bridgePatch.changed && !runtimePatch.changed);
    }catch{rolledBack=false;}
    log('ROLLED_BACK',rolledBack?'PASS':'INCOMPLETE_REVIEW_BACKUP');
    log('BACKUP',backupDir);
    fail('INSTALL_ABORTED_'+String(error?.message||'UNKNOWN').slice(0,100));
  }
}
main().catch(error=>{
  log('STOP',String(error?.message||'UNKNOWN').slice(0,165));
  process.exitCode=2;
});
