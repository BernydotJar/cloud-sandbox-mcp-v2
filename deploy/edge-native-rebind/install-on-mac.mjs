#!/usr/bin/env node
/* global fetch, AbortSignal */
// One-file, hash-pinned, hot-swappable native macOS tab identity upgrade.
// Does not restart browsers, launchctl, Docker or any MCP service.
import process from 'node:process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const release=path.dirname(fileURLToPath(import.meta.url));
const mode=process.argv[2]||'--inspect';
const expectedBaseline='147330664005f6bf5479a9134390b68b1d4fb726aa8fb3d48d791182ae4fa38e';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const log=text=>process.stdout.write('[Native Edge Rebind] '+text+'\n');
function stop(code){throw Error(code);}
function safeFile(filename){
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink())stop('UNSAFE_FILE_TYPE');
  return {bytes:fs.readFileSync(filename),mode:stat.mode&0o777,hash:sha(fs.readFileSync(filename))};
}
function parseEnv(source,key){
  const lines=source.split(/\r?\n/).filter(x=>x.startsWith(key+'='));
  if(lines.length!==1)stop('MISSING_OR_DUPLICATE_BRIDGE_SETTING');
  const raw=lines[0].slice(key.length+1).trim();
  return (raw.startsWith('"')&&raw.endsWith('"'))||(raw.startsWith("'")&&raw.endsWith("'"))
    ?raw.slice(1,-1):raw;
}
function compileJXA(file){
  let result;
  try{
    result=execFileSync('/usr/bin/osascript',
      ['-l','JavaScript',file,'state','UNSUPPORTED_NATIVE_BROWSER_PROBE'],
      {encoding:'utf8',timeout:10000,maxBuffer:10000,stdio:['ignore','pipe','pipe']});
  }catch{stop('JXA_SYNTAX_OR_RUNTIME_INVALID');}
  let parsed;
  try{parsed=JSON.parse(result.trim());}catch{stop('JXA_RESPONSE_INVALID');}
  if(parsed?.ok!==false||parsed.error!=='UNSUPPORTED_BROWSER')stop('JXA_PROBE_FAILED');
}
async function currentBridgeSession(){
  let inspect;
  try{
    const output=execFileSync('docker',['inspect','cloud-sandbox-mcp'],
      {encoding:'utf8',timeout:13000,maxBuffer:700000,stdio:['ignore','pipe','pipe']});
    inspect=JSON.parse(output)?.[0];
  }catch{stop('CUSTOM_MCP_CONTROLLER_DISCOVERY_FAILED');}
  if(!inspect?.State?.Running||
    inspect.Config?.Labels?.['com.docker.compose.service']!=='mcp')
    stop('UNEXPECTED_MCP_CONTROLLER');
  const workdir=inspect.Config.Labels?.['com.docker.compose.project.working_dir'];
  if(!workdir || !path.isAbsolute(workdir))stop('UNVERIFIED_COMPOSE_WORKDIR');
  const env=fs.readFileSync(path.join(fs.realpathSync(workdir),'.env'),'utf8');
  if(parseEnv(env,'COMPUTER_USE_ENABLED')!=='true')stop('COMPUTER_USE_NOT_ENABLED');
  const token=parseEnv(env,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)stop('INVALID_BRIDGE_AUTH');
  let response;
  try{
    response=await fetch('http://127.0.0.1:9764/v1/status',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:'{}'
    });
    const json=await response.json();
    if(!response.ok||json?.ok!==true)stop('BRIDGE_STATUS_DENIED');
    return json.data?.delegated_session;
  }catch{stop('BRIDGE_STATUS_UNAVAILABLE');}
}
async function main(){
  if(process.platform!=='darwin')stop('MUST_RUN_ON_OPERATOR_MAC');
  if(!['--inspect','--install'].includes(mode))stop('USE_INSPECT_OR_INSTALL');
  const manifestFile=safeFile(path.join(release,'manifest.json'));
  const checksum=fs.readFileSync(path.join(release,'manifest.sha256'),'utf8').trim();
  if(manifestFile.hash!==checksum)stop('MANIFEST_HASH_MISMATCH');
  const manifest=JSON.parse(manifestFile.bytes.toString('utf8'));
  if(manifest.schema!=='cloud-sandbox.native-edge-rebind.v1' ||
    manifest.native_baseline_sha256!==expectedBaseline ||
    !/^[a-f0-9]{64}$/.test(manifest.native_sha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.installer_sha256))
    stop('UNEXPECTED_RELEASE_MANIFEST');
  if(safeFile(path.join(release,'native.jxa')).hash!==manifest.native_sha256 ||
    safeFile(fileURLToPath(import.meta.url)).hash!==manifest.installer_sha256)
    stop('RELEASE_SOURCE_TAMPERED');

  const installed=path.join(os.homedir(),'Library','Application Support',
    'LCH','CloudSandboxComputerUse','native.jxa');
  const current=safeFile(installed);
  if(current.hash!==expectedBaseline && current.hash!==manifest.native_sha256)
    stop('LIVE_NATIVE_CODE_DRIFT');
  // Test syntax BEFORE any file replacement, without accessing a real browser.
  compileJXA(path.join(release,'native.jxa'));
  const session=await currentBridgeSession();
  if(session?.active!==false)stop('ACTIVE_OR_UNKNOWN_TASK_SESSION');
  if(current.hash===manifest.native_sha256){
    log('ALREADY_INSTALLED: verified exact native.jxa hash; no action taken.');
    return;
  }
  log('PREFLIGHT_PASS: existing native driver matched authorized baseline.');
  log('Both Chrome and Edge browser profiles remain untouched.');
  log('No browser, MCP controller or host bridge restart is required.');
  if(mode==='--inspect'){log('Ready for --install when the operator approves.');return;}

  // Revalidate just before replacement, preserving mode/ownership and source.
  if(safeFile(installed).hash!==expectedBaseline)stop('LIVE_NATIVE_CODE_CHANGED');
  if((await currentBridgeSession())?.active!==false)stop('ACTIVE_TASK_SESSION');
  const backupRoot=path.join(os.homedir(),'Library','Application Support',
    'LCH','CloudSandboxBackups');
  const backup=path.join(backupRoot,'native-edge-rebind-'+Date.now()+'-'+process.pid);
  await fsp.mkdir(backup,{mode:0o700,recursive:false});
  const old=path.join(backup,'native.jxa');
  await fsp.writeFile(old,current.bytes,{flag:'wx',mode:0o600});
  const temp=installed+'.native-rebind-'+process.pid+'.tmp';
  let replaced=false;
  try {
    await fsp.writeFile(temp,safeFile(path.join(release,'native.jxa')).bytes,
      {flag:'wx',mode:current.mode});
    await fsp.chmod(temp,current.mode);
    await fsp.rename(temp,installed);
    replaced=true;
    if(safeFile(installed).hash!==manifest.native_sha256)stop('INSTALLED_HASH_MISMATCH');
    compileJXA(installed);
    const check=await currentBridgeSession();
    if(check?.active===undefined)stop('POSTINSTALL_BRIDGE_UNVERIFIED');
    await fsp.writeFile(path.join(backup,'receipt.json'),JSON.stringify({
      source_commit:manifest.source_commit,original_sha256:current.hash,
      installed_sha256:manifest.native_sha256,installed_file:installed,
      bridge_restarted:false,controller_restarted:false,browsers_restarted:false
    },null,2)+'\n',{flag:'wx',mode:0o600});
    log('INSTALL_PASS: native tab identity driver hot-swapped atomically.');
    log('BACKUP='+backup);
    log('Next: run read-only Edge/Chrome tab discovery, screenshots and benign focus checks.');
  }catch(error){
    if(replaced){
      const rollback=installed+'.native-rebind-rollback-'+process.pid+'.tmp';
      await fsp.writeFile(rollback,current.bytes,{flag:'wx',mode:current.mode});
      await fsp.chmod(rollback,current.mode);
      await fsp.rename(rollback,installed);
    }else await fsp.rm(temp,{force:true}).catch(()=>{});
    stop('INSTALL_ROLLED_BACK_'+String(error.message||'UNKNOWN').replace(/[^A-Z_]/g,'_').slice(0,55));
  }
}
main().catch(error=>{log('STOP: '+String(error.message||'UNKNOWN').replace(/[\r\n]/g,' ').slice(0,120));process.exitCode=1;});
