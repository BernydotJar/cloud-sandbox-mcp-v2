/* global fetch, AbortSignal */
/**
 * Capability-checked, additive Mac Bridge upgrade. NO full-source replacement.
 * Adapts to existing scalar and per-browser routing variants, preserving local
 * changes and controller code; backs up, smoke-checks, and rolls back on failure.
 */
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {upgradeBridgeSource,upgradeEnvSource} from './upgrade-bridge.mjs';

const say=(key,value)=>process.stdout.write('[Dedicated Chrome Auto] '+key+'='+value+'\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function run(binary,args,timeout=20000) {
  return execFileSync(binary,args,{
    timeout,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:300000
  }).trim();
}
function safeFile(file) {
  const info=fs.lstatSync(file);
  if(!info.isFile() || info.isSymbolicLink())throw Error('UNSAFE_FILE');
  if(info.uid!==process.getuid())throw Error('OWNER_MISMATCH');
  return {contents:fs.readFileSync(file,'utf8'),mode:info.mode&0o777};
}
function atomic(file,contents,mode) {
  const temp=file+'.dedicated-'+process.pid+'.tmp';
  fs.writeFileSync(temp,contents,{mode,flag:'wx'});
  try{fs.renameSync(temp,file);fs.chmodSync(file,mode);}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function envGet(contents,name){
  const matches=contents.split(/\r?\n/).filter(line=>line.startsWith(name+'='));
  if(matches.length!==1)throw Error('MISSING_OR_DUPLICATE_'+name);
  let value=matches[0].slice(name.length+1);
  if((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")))value=value.slice(1,-1);
  return value;
}
async function post(port,token,route){
  const response=await fetch('http://127.0.0.1:'+port+route,{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(2500)
  });
  if(!response.ok)throw Error('BRIDGE_HEALTH_HTTP_'+response.status);
  const json=await response.json();
  if(!json?.ok)throw Error('BRIDGE_HEALTH_RESPONSE_INVALID');
  return json.data;
}
async function healthy(port,token){
  for(let i=0;i<20;i++){
    try{
      const state=await post(port,token,'/v2/browser/status');
      const providers=state?.providers||[];
      const chrome=providers.some(item=>item.browser==='chrome' && item.configured);
      const routing=typeof state?.browser_routing==='object'
        ? state.browser_routing.chrome : state?.browser_routing;
      if(chrome && routing==='prefer_persistent')return true;
    }catch{ /* Restart is asynchronous. */ }
    await delay(600);
  }
  return false;
}
async function main(){
  if(process.platform!=='darwin')throw Error('MACOS_REQUIRED');
  const mode=process.argv[2]||'--inspect';
  if(!['--inspect','--activate'].includes(mode))throw Error('INVALID_MODE');
  const info=JSON.parse(run('docker',['inspect','cloud-sandbox-mcp']))[0];
  if(!info?.State?.Running || info.Config?.Labels?.['com.docker.compose.service']!=='mcp')
    throw Error('UNEXPECTED_MCP_CONTROLLER');
  const compose=info.Config.Labels['com.docker.compose.project.working_dir'];
  if(!compose)throw Error('COMPOSE_DIRECTORY_MISSING');
  const envFile=path.join(fs.realpathSync(compose),'.env');
  const bridgeFile=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxComputerUse/bridge.mjs');
  const bridge=safeFile(bridgeFile),env=safeFile(envFile);
  const patch=upgradeBridgeSource(bridge.contents);
  const config=upgradeEnvSource(env.contents,patch.variant);
  if(envGet(env.contents,'COMPUTER_USE_ENABLED')!=='true' ||
     envGet(env.contents,'COMPUTER_USE_BROWSER_V2')!=='true')
    throw Error('BROWSER_RUNTIME_NOT_ENABLED');
  const token=envGet(env.contents,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)throw Error('BRIDGE_AUTH_INVALID');
  const portEntry=env.contents.split(/\r?\n/).find(line => line.startsWith('COMPUTER_USE_BRIDGE_PORT='));
  const port=Number(portEntry ? envGet(env.contents,'COMPUTER_USE_BRIDGE_PORT') : '9764');
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('BRIDGE_PORT_INVALID');
  const agent='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
  run('/bin/launchctl',['print',agent]);
  // The candidate is validated with the macOS Node parser, without executing it.
  execFileSync(process.execPath,['--check','--input-type=module'],{
    input:patch.source,encoding:'utf8',timeout:8000,stdio:['pipe','pipe','pipe']
  });
  say('COMPATIBLE_ROUTING',patch.variant);
  say('EXISTING_BRIDGE_SHA256',sha(bridge.contents));
  say('PATCH_REQUIRED',patch.applied);
  say('CONFIG_CHANGES',config.keys.join(','));
  if(mode==='--inspect')return;
  if(bridge.contents===patch.source && env.contents===config.source){
    say('ALREADY_CONFIGURED','YES');return;
  }
  const status=await post(port,token,'/v1/session/status');
  if(status?.active)throw Error('ACTIVE_DELEGATED_SESSION_RETRY_LATER');
  const backup=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxBackups/dedicated-chrome-'+Date.now());
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(backup,'bridge.mjs'),bridge.contents,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(backup,'controller.env'),env.contents,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(backup,'checksums.txt'),
    'bridge='+sha(bridge.contents)+'\nenv='+sha(env.contents)+'\n',
    {mode:0o600,flag:'wx'});
  try{
    if(bridge.contents!==patch.source)atomic(bridgeFile,patch.source,bridge.mode);
    if(env.contents!==config.source)atomic(envFile,config.source,env.mode);
    run('/bin/launchctl',['kickstart','-k',agent]);
    if(!await healthy(port,token))throw Error('HEALTH_GATE_FAILED');
  }catch(error){
    atomic(bridgeFile,bridge.contents,bridge.mode);
    atomic(envFile,env.contents,env.mode);
    try{run('/bin/launchctl',['kickstart','-k',agent]);}catch{ /* Saved backup available. */ }
    say('ROLLED_BACK','YES');
    say('BACKUP',backup);
    throw Error('INSTALL_ABORTED_ROLLBACK_'+String(error?.message||'UNKNOWN').slice(0,90));
  }
  say('ACTIVATED','PASS');
  say('BRIDGE_HEALTH','PASS');
  say('BACKUP',backup);
  say('NEXT','Call browser_tabs(chrome) to launch the isolated CDP browser on demand');
}
main().catch(error=>{
  say('STOP',String(error?.message||error).slice(0,170));
  process.exitCode=2;
});
