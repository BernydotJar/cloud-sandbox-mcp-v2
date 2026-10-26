#!/usr/bin/env node
/* global fetch, AbortSignal */
/**
 * Opt-in bounded delegated Mac Bridge session upgrade.
 * Only two precisely reviewed files change; no browser/profile/container edit.
 * Unknown source drift or active delegation => SAFETY_STOP. Automatic rollback
 * on failed Bridge restart/health verification.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {applyBudgetEdits} from './patch.mjs';

const release=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const say=(name,value)=>process.stdout.write('[Bounded Session] '+name+'='+value+'\n');
const stop=code=>{throw Error(code);};
function command(bin,args,timeout=15000){
 return execFileSync(bin,args,{encoding:'utf8',timeout,maxBuffer:1000000,
   stdio:['ignore','pipe','pipe']}).trim();
}
function safeFile(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||st.size>1000000)
   stop('UNSAFE_OR_UNOWNED_FILE');
 return {bytes:fs.readFileSync(file),mode:st.mode&0o777};
}
function parseEnv(source,key){
 const list=source.split(/\r?\n/).filter(line=>line.startsWith(key+'='));
 if(list.length!==1)stop('MISSING_OR_DUPLICATE_'+key);
 let value=list[0].slice(key.length+1).trim();
 if((value.startsWith('"')&&value.endsWith('"'))||
    (value.startsWith("'")&&value.endsWith("'")))
   value=value.slice(1,-1);
 return value;
}
function syntax(source){
 const r=spawnSync(process.execPath,['--check','--input-type=module'],
   {input:source,encoding:'utf8',timeout:12000});
 if(r.status!==0)stop('NODE_SYNTAX_FAILED');
}
function atomicReplace(file,bytes,mode){
 const tmp=file+'.session-cap-'+process.pid+'.tmp';
 fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});
 try{fs.chmodSync(tmp,mode);fs.renameSync(tmp,file);}
 finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function trustedFinite(status){
 const n=status?.trusted_delegation_notice;
 return n?.enabled===true&&n.max_minutes===30&&n.max_actions===200&&
   n.unlimited_actions===false&&status?.mutation_policy==='allowlist_only';
}
async function main(){
 if(process.platform!=='darwin')stop('MUST_RUN_ON_OPERATOR_MAC');
 const mode=process.argv[2]||'--inspect';
 if(!['--inspect','--install'].includes(mode)||process.argv.length>3)
   stop('USE_INSPECT_OR_INSTALL');
 const manifestFile=safeFile(path.join(release,'manifest.json'));
 if(sha(manifestFile.bytes)!==fs.readFileSync(path.join(release,'manifest.sha256'),'utf8').trim())
   stop('RELEASE_MANIFEST_HASH_MISMATCH');
 const manifest=JSON.parse(manifestFile.bytes.toString('utf8'));
 if(manifest.schema!=='cloud-sandbox.mac-session-budget.v1' ||
    sha(safeFile(fileURLToPath(import.meta.url)).bytes)!==manifest.installer_sha256 ||
    sha(safeFile(path.join(release,'patch.mjs')).bytes)!==manifest.patch_sha256)
   stop('RELEASE_INTEGRITY_FAILED');
 const root=path.join(os.homedir(),'Library','Application Support','LCH','CloudSandboxComputerUse');
 const files={bridge:path.join(root,'bridge.mjs'),store:path.join(root,'autonomy-session.mjs')};
 const before={},after={};let hasPending=false;
 for(const kind of ['bridge','store']){
   before[kind]=safeFile(files[kind]);
   const baselineHash=manifest.components[kind].baseline_sha256;
   const expectedHash=manifest.components[kind].target_sha256;
   const currentHash=sha(before[kind].bytes);
   if(currentHash!==baselineHash&&currentHash!==expectedHash)
     stop('UNKNOWN_INSTALLED_'+kind.toUpperCase()+'_BASELINE');
   const candidate=applyBudgetEdits(before[kind].bytes.toString('utf8'),kind);
   syntax(candidate.source);
   const candidateBytes=Buffer.from(candidate.source);
   if(sha(candidateBytes)!==expectedHash)stop('CANDIDATE_HASH_MISMATCH');
   after[kind]=candidateBytes;
   if(currentHash!==expectedHash)hasPending=true;
 }
 const inspected=JSON.parse(command('docker',['inspect','cloud-sandbox-mcp']))?.[0];
 if(!inspected?.State?.Running ||
    inspected.Config?.Labels?.['com.docker.compose.service']!=='mcp')
   stop('CONTROLLER_NOT_READY');
 const workdir=inspected.Config.Labels['com.docker.compose.project.working_dir'];
 if(typeof workdir!=='string'||!path.isAbsolute(workdir))
   stop('CONTROLLER_WORKDIR_UNAVAILABLE');
 const env=safeFile(path.join(fs.realpathSync(workdir),'.env')).bytes.toString('utf8');
 const token=parseEnv(env,'COMPUTER_USE_BRIDGE_TOKEN');
 const port=Number(parseEnv(env,'COMPUTER_USE_BRIDGE_PORT'));
 if(token.length<32||!Number.isInteger(port)||port<1024||port>65535)
   stop('BRIDGE_CONFIG_INVALID');
 async function post(route){
   const res=await fetch('http://127.0.0.1:'+port+route,{
     method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
     body:'{}',signal:AbortSignal.timeout(3500)});
   const json=await res.json();
   if(!res.ok||json?.ok!==true)stop('BRIDGE_STATUS_UNAVAILABLE');
   return json.data;
 }
 const delegated=await post('/v1/session/status');
 if(delegated.active!==false)stop('ACTIVE_DELEGATED_SESSION');
 const label='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
 command('/bin/launchctl',['print',label]);
 say('SOURCE_COMMIT',manifest.source_commit);
 say('MODE',mode);
 say('PATCH_REQUIRED',hasPending?'YES':'NO');
 say('MAX_MINUTES',30);
 say('MAX_ACTIONS',200);
 say('NO_PER_ACTION_MODAL_IN_TRUSTED_MODE',true);
 say('BROWSER_OR_PROFILE_RESTARTS','NONE');
 if(!hasPending){
   const status=await post('/v1/status');
   if(!trustedFinite(status))stop('FILES_PATCHED_BUT_RUNTIME_NOT_UPDATED');
   say('ALREADY_INSTALLED','PASS');return;
 }
 if(mode==='--inspect'){say('SAFE_PREFLIGHT','PASS');return;}
 if((await post('/v1/session/status')).active!==false)stop('ACTIVE_DELEGATION_BEFORE_INSTALL');
 for(const kind of ['bridge','store']){
   if(sha(safeFile(files[kind]).bytes)!==sha(before[kind].bytes))
     stop('LIVE_FILE_CHANGED_BEFORE_INSTALL');
 }
 const backupDir=path.join(os.homedir(),'Library','Application Support','LCH',
   'CloudSandboxBackups','session-budget-'+Date.now()+'-'+process.pid);
 fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
 for(const kind of ['bridge','store'])
   fs.writeFileSync(path.join(backupDir,kind+'.previous.mjs'),before[kind].bytes,
     {mode:0o600,flag:'wx'});
 let replaced=false;
 try{
   replaced=true; // any partial atomic replace must be rolled back
   for(const kind of ['bridge','store'])
     atomicReplace(files[kind],after[kind],before[kind].mode);
   for(const kind of ['bridge','store'])
     if(sha(safeFile(files[kind]).bytes)!==sha(after[kind]))
       stop('POST_WRITE_HASH_MISMATCH');
   command('/bin/launchctl',['kickstart','-k',label]);
   let verified=false;
   for(let i=0;i<25;i++){
     await sleep(500);
     try{
       const [status,session]=await Promise.all([
         post('/v1/status'),post('/v1/session/status')]);
       if(trustedFinite(status)&&session.active===false){
         verified=true;break;
       }
     }catch{/* service restarting */}
   }
   if(!verified)stop('POST_INSTALL_BRIDGE_NOT_READY_OR_POLICY_MISMATCH');
   fs.writeFileSync(path.join(backupDir,'receipt.json'),
     JSON.stringify({installed:true,source_commit:manifest.source_commit,
       changed:['bridge.mjs','autonomy-session.mjs'],restored:false,
       browsers_restarted:false,container_restarted:false},null,2)+'\n',
     {mode:0o600,flag:'wx'});
   say('BOUNDED_SESSION_INSTALL','PASS');
   say('BACKUP',backupDir);
 }catch(error){
   if(replaced){
     for(const kind of ['bridge','store'])
       atomicReplace(files[kind],before[kind].bytes,before[kind].mode);
     try{command('/bin/launchctl',['kickstart','-k',label]);}
     catch{say('ROLLBACK_RESTART','FAILED_CHECK_MANUALLY');}
   }
   stop('ROLLED_BACK_'+String(error?.message||'UNKNOWN').replace(/[^A-Z_]/g,'_').slice(0,80));
 }
}
main().catch(err=>{
 say('SAFETY_STOP',String(err?.message||'UNKNOWN').replace(/[\r\n]/g,' ').slice(0,125));
 process.exitCode=1;
});
