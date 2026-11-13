/* global fetch, AbortSignal, Buffer */
/**
 * Operator-run, zero-password, guarded LinkedIn allowlist activation for the
 * existing native Mac Bridge. Does not patch Bridge code or browser profiles.
 *
 * --inspect: check config + live health read-only.
 * --activate: back up the controller .env, add one exact HTTPS origin,
 *            restart ONLY the Bridge LaunchAgent, verify count/policy,
 *            rollback on any failure. No active delegation may be disrupted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {TextDecoder} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {addLinkedInOrigin,LINKEDIN_ORIGIN} from './linkedin-config.mjs';

const log=(key,val)=>process.stdout.write('[LinkedIn Bridge Origin] '+key+'='+val+'\n');
const fail=code=>{throw Error(code);};
function command(commandPath,args,timeout=16000){
  try{
    return execFileSync(commandPath,args,{
      timeout,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1200000
    }).trim();
  }catch{fail('LOCAL_COMMAND_FAILED');}
}
function safeEnvFile(filename){
  const stat=fs.lstatSync(filename);
  if(stat.isSymbolicLink() || !stat.isFile() || stat.uid!==process.getuid() ||
     (stat.mode & 0o022)!==0 || stat.size>2_000_000)fail('UNSAFE_CONTROLLER_ENV');
  return {
    bytes:fs.readFileSync(filename),
    mode:stat.mode&0o777
  };
}
function value(source,key,optional=false){
  const matches=source.split(/\r?\n/).filter(line=>line.startsWith(key+'='));
  if(optional && matches.length===0)return null;
  if(matches.length!==1)fail('INVALID_CONFIG_'+key);
  const raw=matches[0].slice(key.length+1).trim();
  return raw.length>=2 && (raw.startsWith('"') && raw.endsWith('"') ||
    raw.startsWith("'") && raw.endsWith("'"))?raw.slice(1,-1):raw;
}
function atomicReplace(filename,bytes,mode) {
  const temp=filename+'.linkedin-origin-'+process.pid+'.tmp';
  fs.writeFileSync(temp,bytes,{flag:'wx',mode});
  try {
    fs.renameSync(temp,filename);
    fs.chmodSync(filename,mode);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
async function bridgePost(port,token,pathName){
  const response=await fetch('http://127.0.0.1:'+port+pathName,{
    method:'POST',headers:{
      authorization:'Bearer '+token,
      'content-type':'application/json'
    },body:'{}',signal:AbortSignal.timeout(3000)
  });
  if(!response.ok)fail('BRIDGE_STATUS_HTTP_'+response.status);
  const body=await response.json();
  if(!body?.ok || typeof body.data!=='object')fail('INVALID_BRIDGE_RESPONSE');
  return body.data;
}
async function healthy(port,token,attempts=22){
  for(let attempt=0;attempt<attempts;attempt++){
    try{return await bridgePost(port,token,'/v1/status');}
    catch{if(attempt===attempts-1)break;await sleep(500);}
  }
  fail('BRIDGE_UNAVAILABLE_AFTER_RESTART');
}
function assertPolicy(current,expectedCount){
  if(current?.allowlisted_origins!==expectedCount ||
     current?.mutation_policy!=='allowlist_only' ||
     current?.trusted_delegation_notice?.enabled!==true ||
     current?.trusted_delegation_notice?.max_minutes!==30 ||
     !(current?.trusted_delegation_notice?.unlimited_actions===true ||
       (current?.trusted_delegation_notice?.unlimited_actions===false &&
        Number.isInteger(current?.trusted_delegation_notice?.max_actions) &&
        current?.trusted_delegation_notice?.max_actions>=1 &&
        current?.trusted_delegation_notice?.max_actions<=200)))
     fail('UNEXPECTED_BRIDGE_POLICY_OR_ORIGIN_COUNT');
}
async function main(){
  if(process.platform!=='darwin')fail('MACOS_ONLY');
  const mode=process.argv[2]||'--inspect';
  if(!['--inspect','--activate'].includes(mode) || process.argv.length>3)fail('INVALID_MODE');
  const info=JSON.parse(command('docker',['inspect','cloud-sandbox-mcp']))[0];
  if(!info?.State?.Running || info.Config?.Labels?.['com.docker.compose.service']!=='mcp')
    fail('UNEXPECTED_CONTROLLER');
  const working=info.Config.Labels['com.docker.compose.project.working_dir'];
  if(typeof working!=='string' || !working.startsWith('/'))fail('INVALID_COMPOSE_DIRECTORY');
  const envFile=path.join(fs.realpathSync(working),'.env');
  const original=safeEnvFile(envFile);
  const source=new TextDecoder('utf-8',{fatal:true}).decode(original.bytes);
  if(value(source,'COMPUTER_USE_ENABLED')!=='true' ||
     value(source,'COMPUTER_USE_BROWSER_V2')!=='true')
    fail('COMPUTER_USE_NOT_ENABLED');
  const token=value(source,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)fail('BRIDGE_AUTH_INVALID');
  const port=Number(value(source,'COMPUTER_USE_BRIDGE_PORT',true)||9764);
  if(!Number.isInteger(port)||port<1024||port>65535)fail('BRIDGE_PORT_INVALID');
  const update=addLinkedInOrigin(source);
  const label='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
  command('/bin/launchctl',['print',label]);
  const before=await bridgePost(port,token,'/v1/status');
  assertPolicy(before,update.beforeCount);
  log('MODE',mode);
  log('TARGET_ORIGIN',LINKEDIN_ORIGIN);
  log('ORIGINS_BEFORE',update.beforeCount);
  log('ORIGINS_AFTER',update.afterCount);
  log('ALREADY_ALLOWED',update.changed?'NO':'YES');
  log('OTHER_ORIGINS','PRESERVED');
  log('CHROME_PROFILES','UNCHANGED');
  if(mode==='--inspect'){
    log('INSPECT','PASS_READ_ONLY');
    return;
  }
  if(!update.changed){
    log('ACTIVATED','PASS_ALREADY_ALLOWED');
    log('BRIDGE_HEALTH','PASS');
    return;
  }
  const session=await bridgePost(port,token,'/v1/session/status');
  if(session?.active)fail('ACTIVE_DELEGATED_SESSION_NO_CHANGES');
  // Fail closed rather than racing concurrent operator edits.
  const fresh=safeEnvFile(envFile);
  if(!fresh.bytes.equals(original.bytes))fail('CONTROLLER_ENV_CHANGED_NO_CHANGES');
  const backupDir=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxBackups',
    'linkedin-allowed-origin-'+Date.now()+'-'+process.pid);
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const backup=path.join(backupDir,'controller.env');
  fs.writeFileSync(backup,original.bytes,{mode:0o600,flag:'wx'});
  let applied=false;
  try {
    atomicReplace(envFile,Buffer.from(update.updated,'utf8'),original.mode);
    applied=true;
    const persisted=safeEnvFile(envFile);
    const actual=addLinkedInOrigin(
      new TextDecoder('utf-8',{fatal:true}).decode(persisted.bytes));
    if(actual.changed || actual.afterCount!==update.afterCount)
      fail('POST_WRITE_ORIGIN_VALIDATION_FAILED');
    command('/bin/launchctl',['kickstart','-k',label]);
    const after=await healthy(port,token);
    assertPolicy(after,update.afterCount);
    log('ACTIVATED','PASS');
    log('BRIDGE_HEALTH','PASS');
    log('ORIGINS_ACTIVE',after.allowlisted_origins);
    log('BACKUP',backupDir);
  }catch(error){
    if(applied) {
      let rollbackOk=false;
      try {
        atomicReplace(envFile,original.bytes,original.mode);
        command('/bin/launchctl',['kickstart','-k',label]);
        assertPolicy(await healthy(port,token),update.beforeCount);
        rollbackOk=true;
      }catch {/* backup remains available to operator */}
      log('ROLLED_BACK',rollbackOk?'PASS':'INCOMPLETE_CHECK_BACKUP');
    }
    log('BACKUP',backupDir);
    fail('ACTIVATION_FAILED_'+String(error?.message||'UNKNOWN').slice(0,105));
  }
}
main().catch(error=>{
  log('STOP',String(error?.message||'UNKNOWN').slice(0,160));
  process.exitCode=2;
});
