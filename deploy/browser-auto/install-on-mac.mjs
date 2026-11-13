/* global fetch, AbortSignal */
/**
 * One-step additive upgrade for the EXISTING native Mac Computer Use runtime.
 * No .env/provider/domain/port/profile changes. Only the existing MCP controller
 * and Mac bridge are restarted after four strictly hashed code-file replacements.
 */
import process from 'node:process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

const release=path.dirname(fileURLToPath(import.meta.url));
const mode=process.argv[2]||'--inspect';
const log=value=>process.stdout.write('[Computer Use Auto] '+value+'\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const safeHash=file=>{
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('UNSAFE_FILE_TYPE');
  return sha(fs.readFileSync(file));
};
const run=(exe,args,timeout=60000)=>{
  try{return execFileSync(exe,args,{encoding:'utf8',timeout,maxBuffer:5_000_000,
    stdio:['ignore','pipe','pipe']}).trim();}
  catch(error){throw Error(error?.code==='ETIMEDOUT'
    ?'LOCAL_COMMAND_TIMED_OUT':'LOCAL_COMMAND_FAILED');}
};
const atomic=(dest,bytes,permissions)=>{
  const tmp=dest+'.browser-auto-'+process.pid+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:permissions,flag:'wx'});
  fs.renameSync(tmp,dest);
  fs.chmodSync(dest,permissions);
};
function envValue(raw,key) {
  const lines=raw.split(/\r?\n/).filter(line=>line.startsWith(key+'='));
  if(lines.length!==1)throw Error('BRIDGE_ENV_SETTING_MISSING_OR_DUPLICATE');
  return lines[0].slice(key.length+1).trim().replace(/^['"]|['"]$/g,'');
}
async function post(token,endpoint,body={},timeout=10000) {
  let response;
  try{
    response=await fetch('http://127.0.0.1:9764'+endpoint,{
      method:'POST',redirect:'error',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)
    });
  }catch{throw Error('MAC_BRIDGE_NOT_READY');}
  const raw=await response.text();
  if(raw.length>2_000_000)throw Error('BRIDGE_RESULT_OVERSIZED');
  let data;
  try{data=JSON.parse(raw);}catch{throw Error('BRIDGE_RESPONSE_INVALID');}
  if(!response.ok||data?.ok!==true)throw Error('BRIDGE_CALL_FAILED');
  return data.data;
}
async function waitForBridge(token) {
  for(let n=0;n<32;n++){
    try{
      const v=await post(token,'/v2/browser/status');
      if(v.enabled)return v;
    }catch{ /* launchd activation may still be in progress */ }
    await sleep(500);
  }
  throw Error('MAC_BRIDGE_RESTART_FAILED');
}
async function verifyController(expected) {
  const source=fs.readFileSync(path.join(release,'registry-probe.mjs'),'utf8')
    .replaceAll('EXPECTED_TOOL_COUNT',String(expected));
  for(let n=0;n<26;n++){
    try{
      const running=JSON.parse(run('docker',['inspect','cloud-sandbox-mcp'],15000))[0];
      if(!running?.State?.Running||
          (running.State.Health && running.State.Health.Status!=='healthy'))
        throw Error('WAITING_FOR_MCP');
      const health=run('docker',['exec','cloud-sandbox-mcp','node','-e',
        "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(2);console.log('HEALTH_OK')}).catch(()=>process.exit(2))"],11000);
      if(!health.includes('HEALTH_OK'))throw Error('MCP_HTTP_HEALTH_FAILED');
      const registry=run('docker',['exec','cloud-sandbox-mcp','node',
        '--input-type=module','-e',source],16000);
      if(registry.includes('EXPECTED_MCP_REGISTRY_PASS'))return;
    }catch{ /* MCP still starting; never retry an action, only health checks */ }
    await sleep(750);
  }
  throw Error('MCP_REGISTRY_OR_HEALTH_FAILED');
}
async function main(){
  if(process.platform!=='darwin')throw Error('RUN_IN_MAC_TERMINAL');
  if(!['--inspect','--install'].includes(mode))throw Error('USE_INSPECT_OR_INSTALL');
  const manifestBytes=fs.readFileSync(path.join(release,'manifest.json'));
  const expectedManifestHash=fs.readFileSync(path.join(release,'manifest.sha256'),'utf8').trim();
  if(sha(manifestBytes)!==expectedManifestHash)throw Error('MANIFEST_INTEGRITY_ERROR');
  const manifest=JSON.parse(manifestBytes);
  const assets=manifest.assets;
  if(manifest.schema!=='browser-auto-release.v1'||Object.keys(assets).length!==4 ||
     !((manifest.tools_before===28 || manifest.tools_before===29) && manifest.tools_after===29) ||
     ['bridge.mjs','runtime.mjs','connection-pool.mjs','browser-runtime-tools.js']
       .some(key => !Object.hasOwn(assets,key)))
    throw Error('INVALID_AUTO_RELEASE_MANIFEST');
  for(const [key,item] of Object.entries(assets)){
    if(!/^[a-z-]+\.m?js$/.test(key)||safeHash(path.join(release,key))!==item.sha256)
      throw Error('RELEASE_CHECKSUM_MISMATCH');
  }
  if(safeHash(path.join(release,'registry-probe.mjs'))!==manifest.probe_sha256)
    throw Error('RELEASE_PROBE_CHECKSUM_MISMATCH');
  const info=JSON.parse(run('docker',['inspect','cloud-sandbox-mcp'],60000))[0];
  if(!info?.State?.Running ||
      info.Config?.Labels?.['com.docker.compose.service']!=='mcp')
    throw Error('UNEXPECTED_MCP_CONTROLLER');
  const mount=info.Mounts?.find(m=>m.Type==='bind'&&m.Destination==='/app/dist');
  if(!mount)throw Error('CONTROLLER_BIND_MISSING');
  const controller=fs.realpathSync(mount.Source);
  const working=fs.realpathSync(info.Config.Labels['com.docker.compose.project.working_dir']);
  const home=os.homedir();
  const host=path.join(home,'Library','Application Support','LCH','CloudSandboxComputerUse');
  const files={
    'bridge.mjs':path.join(host,'bridge.mjs'),
    'runtime.mjs':path.join(host,'browser-runtime','runtime.mjs'),
    'connection-pool.mjs':path.join(host,'browser-runtime','connection-pool.mjs'),
    'browser-runtime-tools.js':path.join(controller,'mcp','browser-runtime-tools.js')
  };
  const env=fs.readFileSync(path.join(working,'.env'),'utf8');
  for(const key of ['COMPUTER_USE_ENABLED','COMPUTER_USE_BROWSER_V2','COMPUTER_USE_DYNAMIC_TABS'])
    if(envValue(env,key)!=='true')throw Error('CURRENT_RUNTIME_NOT_ENABLED');
  const token=envValue(env,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)throw Error('BRIDGE_AUTH_MISSING');
  const current=await post(token,'/v1/status');
  if(current?.delegated_session?.active)throw Error('ACTIVE_TASK_MUST_FINISH_FIRST');
  if((await post(token,'/v2/browser/status'))?.enabled!==true)
    throw Error('EXISTING_BROWSER_RUNTIME_NOT_READY');
  const launchLabel='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
  run('/bin/launchctl',['print',launchLabel],15000);

  let changed=0;
  const alreadyPatched=[];
  for(const [key,dest] of Object.entries(files)){
    const hash=safeHash(dest);
    if(hash===assets[key].sha256){alreadyPatched.push(key);continue;}
    if(!assets[key].allowed_previous.includes(hash))
      throw Error('CUSTOM_CODE_DRIFT_'+key.replace(/[^a-z]/g,'_').toUpperCase());
    changed++;
  }
  if(changed===0){
    await verifyController(29);
    const updated=await post(token,'/v2/browser/status');
    if(!['chrome','edge'].every(browser=>
      updated.providers?.some(p=>p.browser===browser&&p.configured)))
      throw Error('INSTALLED_CHANNEL_DISCOVERY_UNAVAILABLE');
    log('ALREADY_INSTALLED: verified 29 tools and both automatic browser channels.');
    return;
  }
  // The optional earlier channel-only enhancement updates just the pool.
  // Accept exactly that known state, but refuse other half-finished upgrades.
  const priorChannelOnly=manifest.tools_before===28 &&
    changed===3 && alreadyPatched.length===1 &&
    alreadyPatched[0]==='connection-pool.mjs';
  if(changed!==Object.keys(files).length && !priorChannelOnly)
    throw Error('PARTIALLY_INSTALLED_RUNTIME_REQUIRES_RECONCILIATION');
  const devMain=JSON.parse(run('docker',['inspect','cloud-sandbox-dev-main'],20000))[0];
  if(!devMain?.State?.Running)throw Error('DEV_MAIN_MUST_BE_RUNNING');
  log('PREFLIGHT_PASS: no per-browser providers or debugging ports to configure.');
  log('Auto CDP -> native fallback -> browser_open only when requested.');
  log('Original Mac browser profiles and existing workspaces remain intact.');
  if(mode==='--inspect')return;

  if((await post(token,'/v1/status'))?.delegated_session?.active)
    throw Error('ACTIVE_TASK_MUST_FINISH_FIRST');
  const backupDir=path.join(home,'Library','Application Support','LCH',
    'CloudSandboxBackups','browser-auto-'+Date.now()+'-'+process.pid);
  await fsp.mkdir(backupDir,{recursive:true,mode:0o700});
  const modes={};
  for(const [key,dest] of Object.entries(files)){
    modes[key]=fs.lstatSync(dest).mode&0o777;
    await fsp.writeFile(path.join(backupDir,key),fs.readFileSync(dest),
      {flag:'wx',mode:0o600});
  }
  await fsp.writeFile(path.join(backupDir,'receipt.json'),JSON.stringify({
    type:'browser-auto-existing-controller',source_commit:manifest.source_commit,
    files,baseline_image:info.Image,dev_main_id:devMain.Id
  },null,2),{mode:0o600,flag:'wx'});
  let applied=false;
  try{
    applied=true;
    for(const [key,dest] of Object.entries(files))
      atomic(dest,fs.readFileSync(path.join(release,key)),modes[key]);
    if((await post(token,'/v1/status'))?.delegated_session?.active)
      throw Error('ACTIVE_TASK_STARTED_DURING_UPGRADE');
    run('/bin/launchctl',['kickstart','-k',launchLabel],30000);
    const status=await waitForBridge(token);
    if(!['chrome','edge'].every(browser=>
      status.providers?.some(p=>p.browser===browser&&p.configured)))
      throw Error('AUTO_BROWSER_CHANNELS_MISSING');
    run('docker',['restart','cloud-sandbox-mcp'],120000);
    await verifyController(29);
    const fresh=JSON.parse(run('docker',['inspect','cloud-sandbox-dev-main'],20000))[0];
    if(fresh?.Id!==devMain.Id||!fresh?.State?.Running)
      throw Error('DEV_MAIN_WAS_MODIFIED');
    for(const browser of ['chrome','edge']){
      const discovered=await post(token,'/v2/browser/tabs',{browser},30000);
      if(!['persistent','native'].includes(discovered?.provider) ||
          !Array.isArray(discovered.tabs))throw Error('BROWSER_DISCOVERY_FAILED');
      log(browser.toUpperCase()+'_DRIVER='+discovered.provider+
        ', TABS='+discovered.tabs.length);
    }
    log('AUTO_BROWSER_READY: 29 MCP tools, one-time upgrade completed.');
    log('No browsers were restarted, opened, or reconfigured during deployment.');
    log('BACKUP='+backupDir);
  }catch(error){
    log('INSTALL_FAILED: attempting automatic rollback.');
    let recovered=true;
    if(applied)try{
      for(const [key,dest] of Object.entries(files))
        atomic(dest,fs.readFileSync(path.join(backupDir,key)),modes[key]);
      run('/bin/launchctl',['kickstart','-k',launchLabel],30000);
      await waitForBridge(token);
      run('docker',['restart','cloud-sandbox-mcp'],120000);
      await verifyController(manifest.tools_before);
    }catch{recovered=false;}
    log(recovered?'ROLLBACK_VERIFIED':'ROLLBACK_INCOMPLETE; backup is preserved.');
    if(!recovered)log('BACKUP='+backupDir);
    throw error;
  }
}
try{await main();}
catch(error){
  log('STOP: '+String(error?.message||'UNKNOWN').replace(/[^\x20-\x7e]/g,'').slice(0,160));
  process.exitCode=2;
}
