#!/usr/bin/env node
/**
 * Guarded ONE-SHOT Mac final cold sync and reversible symlink cutover.
 * Never removes Mac originals, never moves Docker.raw, and never
 * recreates existing containers. Must run from the operator's Mac.
 */
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setInterval,clearInterval} from 'node:timers';

export const SSD='/Volumes/SSD';
export const VOLUME_UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
export const ROOT=SSD+'/Sandbox';
export const DATA=ROOT+'/persistent/cloud-sandbox-mcp-data';
export const CODE=ROOT+'/source/cloud-sandbox-workstation';
export const WID='6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
export const EXCLUDED_UV='workspaces/'+WID+'/home/.cache/uv/';
const HOME=os.homedir();
const RELEASE_DIR=path.dirname(fileURLToPath(import.meta.url));
const SRC=path.join(HOME,'.cloud-sandbox-mcp-data');
const CONTROLLER=path.join(HOME,
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const PROGRESS=path.join(HOME,'.local/share/sandbox-v3/ssd-cutover-state.json');
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');

function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function verifyImmutableRelease(){
  const manifestFile=path.join(RELEASE_DIR,'manifest.json');
  const digestFile=path.join(RELEASE_DIR,'manifest.sha256');
  const manifest=fs.readFileSync(manifestFile);
  if(sha(manifest)!==fs.readFileSync(digestFile,'utf8').trim())
    throw Error('CUTOVER_RELEASE_MANIFEST_SHA_MISMATCH');
  const info=JSON.parse(manifest.toString('utf8'));
  if(info.schema!=='sandbox-v3.primary-cli.v1'||
    info.ssd_cutover_bundle!==true||
    info.source_git_sha?.length!==40||
    info.files_sha256?.['cold-cutover-on-mac.mjs']===undefined)
    throw Error('CUTOVER_RELEASE_IDENTITY_MISMATCH');
  for(const [name,digest] of Object.entries(info.files_sha256)){
    if(!/^[a-zA-Z0-9._-]{2,80}$/.test(name)||!/^[a-f0-9]{64}$/.test(digest))
      throw Error('CUTOVER_RELEASE_FILE_ENTRY_UNSAFE');
    const file=path.join(RELEASE_DIR,name);
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||
      sha(fs.readFileSync(file))!==digest)
      throw Error('CUTOVER_RELEASE_FILE_HASH_MISMATCH:'+name);
  }
}
function say(k,v){console.log('[SSD Final Cutover] '+k+'='+String(v));}
function run(exe,args,{timeout=20000,stdio='pipe'}={}){
  const r=spawnSync(exe,args,{
    encoding:'utf8',timeout,stdio,
    maxBuffer:3_000_000
  });
  if(r.status!==0||r.error)
    throw Error('COMMAND_FAILED:'+path.basename(exe)+':'+
      String(args[0]||'').slice(0,32));
  return String(r.stdout||'');
}
export function validVolume(info={}){
  const apfs=/(^|[^A-Z])APFS([^A-Z]|$)/i.test(
    String(info.FileSystemPersonality||'')+' '+String(info.FilesystemType||''));
  const writable=(info.Writable===true||
    info.ReadOnlyVolume===false||info.VolumeReadOnly===false)&&
    info.ReadOnlyVolume!==true&&info.VolumeReadOnly!==true&&
    info.ReadOnlyMedia!==true&&info.WriteProtected!==true;
  return apfs&&writable&&info.Internal===false&&
    info.MountPoint===SSD&&
    String(info.VolumeUUID||'').toUpperCase()===VOLUME_UUID;
}
export function finalRsyncArgs(src,dst,{persistent=false}={}){
  if(!((src===SRC&&dst===DATA&&persistent)||
    (src===CONTROLLER&&dst===CODE&&!persistent)))
    throw Error('FINAL_RSYNC_SOURCE_TARGET_NOT_ALLOWLISTED');
  // --delete affects ONLY the verified staged SSD leaf, never the Mac.
  // Removes stale WAL/SHM and old files left by earlier live staging.
  const args=['-aH','--delete','--stats'];
  if(persistent)args.push('--delete-excluded','--exclude=/'+EXCLUDED_UV);
  else args[0]='-aEH';
  return [...args,'--',src+'/',dst+'/'];
}
function lstat(loc){
  try{return fs.lstatSync(loc);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function originalDir(loc){
  const s=lstat(loc);
  if(!s?.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid())
    throw Error('ORIGINAL_MAC_DIRECTORY_MISMATCH:'+path.basename(loc));
}
function guardedSSD(){
  const m=lstat(SSD);
  if(!m?.isDirectory()||m.isSymbolicLink())
    throw Error('SSD_UNMOUNTED_OR_SYMLINK');
  const plist=run('/usr/sbin/diskutil',['info','-plist',SSD]);
  const r=spawnSync('/usr/bin/plutil',['-convert','json','-o','-','-'],{
    encoding:'utf8',input:plist,timeout:15000
  });
  if(r.status!==0||r.error)throw Error('DISK_INFO_CANNOT_DECODE');
  const disk=JSON.parse(r.stdout);
  if(!validVolume(disk))throw Error('SSD_UUID_APFS_READWRITE_MISMATCH');
  fs.accessSync(SSD,fs.constants.R_OK|fs.constants.W_OK);
  for(const d of [ROOT,ROOT+'/persistent',ROOT+'/source',
    ROOT+'/reports',DATA,CODE]){
    const s=lstat(d);
    if(!s?.isDirectory()||s.isSymbolicLink()||
      s.uid!==process.getuid())
      throw Error('SSD_STAGE_DIRECTORY_UNTRUSTED:'+path.basename(d));
    if([ROOT,ROOT+'/persistent',ROOT+'/source',ROOT+'/reports'].includes(d)&&
      (s.mode&0o077)!==0)
      throw Error('SSD_STAGE_PRIVATE_PARENT_DRIFT:'+path.basename(d));
  }
}
function receiptGuard(){
  const marker=JSON.parse(fs.readFileSync(
    ROOT+'/.sandbox-v3-stage.json','utf8'));
  const receipt=JSON.parse(fs.readFileSync(
    ROOT+'/reports/staging-receipt.json','utf8'));
  if(marker.schema!=='sandbox-v3.toshiba-stage.v1'||
    marker.volumeUuid!==VOLUME_UUID||
    marker.targetRoot!==ROOT||
    marker.dataSource!==SRC||
    marker.controllerSource!==CONTROLLER||
    marker.canCutover!==false||
    receipt.operation!=='LIVE_STAGING_COPY_COMPLETED'||
    receipt.volumeUuid!==VOLUME_UUID||
    receipt.requireColdFinalSync!==true||
    receipt.initialPersistentCopyXattrsFullyPreserved!==false||
    receipt.xattrAndAclParityVerificationPending!==true||
    receipt.sourcePathsPreserved!==true||
    receipt.dockerBindMountsRetargeted!==false)
    throw Error('STAGING_RECEIPT_OR_MARKER_NOT_TRUSTED');
}
const BRIDGE_LABEL='com.lch.cloud-sandbox.computer-use';
const BRIDGE_PLIST=path.join(HOME,
  'Library/LaunchAgents/com.lch.cloud-sandbox.computer-use.plist');
function bridgeTarget(){
  return 'gui/'+process.getuid()+'/'+BRIDGE_LABEL;
}
function bridgeLoaded(){
  const result=spawnSync('/bin/launchctl',['print',bridgeTarget()],{
    encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']
  });
  return result.status===0&&!result.error;
}
function bridgePausedState(){
  if(!bridgeLoaded())return {wasLoaded:false};
  const current=lstat(BRIDGE_PLIST);
  if(!current?.isFile()||current.isSymbolicLink()||
    current.uid!==process.getuid())
    throw Error('BRIDGE_LAUNCHAGENT_PLIST_UNTRUSTED');
  const info=spawnSync('/usr/bin/plutil',
    ['-convert','json','-o','-',BRIDGE_PLIST],{
      encoding:'utf8',timeout:10000
    });
  if(info.status!==0||info.error||
    JSON.parse(info.stdout).Label!==BRIDGE_LABEL)
    throw Error('BRIDGE_LAUNCHAGENT_IDENTITY_MISMATCH');
  return {wasLoaded:true};
}
function stopBridge(s){
  if(!s.bridgeWasLoaded||!bridgeLoaded())return;
  run('/bin/launchctl',['bootout',bridgeTarget()],{timeout:25000});
  say('MAC_BRIDGE','PAUSED_FOR_COLD_SYNC');
}
function resumeBridge(s){
  if(!s.bridgeWasLoaded||bridgeLoaded())return;
  const plist=lstat(BRIDGE_PLIST);
  if(!plist?.isFile()||plist.isSymbolicLink())
    throw Error('BRIDGE_LAUNCHAGENT_PLIST_MISSING');
  run('/bin/launchctl',['bootstrap','gui/'+process.getuid(),BRIDGE_PLIST],
    {timeout:25000});
  say('MAC_BRIDGE','RESTORED');
}
function inspectContainers(){
  const containers=JSON.parse(run('docker',[
    'inspect','cloud-sandbox-mcp','cloud-sandbox-dev-main']));
  const a=containers.find(c=>c.Name==='/cloud-sandbox-mcp');
  const b=containers.find(c=>c.Name==='/cloud-sandbox-dev-main');
  if(!a||!b||a.State.Running!==true||b.State.Running!==true||
    a.Config?.Labels?.['com.docker.compose.project.working_dir']!==CONTROLLER)
    throw Error('ORIGINAL_RUNNING_CONTAINERS_MISMATCH');
  const required=[
    [a,'/data',SRC],
    [b,'/workspace',SRC+'/workspaces/'+WID+'/repo'],
    [b,'/home/agent',SRC+'/workspaces/'+WID+'/home'],
    [b,'/shared-auth',SRC+'/shared-auth'],
    [b,'/var/lib/docker',SRC+'/workspaces/'+WID+'/docker']
  ];
  for(const [c,dest,source] of required)
    if(!c.Mounts?.some(m=>m.Type==='bind'&&
      m.Source===source&&m.Destination===dest))
      throw Error('ORIGINAL_BIND_CHANGED:'+dest);
  const policy=c=>c.HostConfig?.RestartPolicy?.Name||'no';
  return {controllerPolicy:policy(a),workerPolicy:policy(b)};
}
export function renderSSDCompose(compose){
  if(typeof compose!=='string')throw Error('COMPOSE_NOT_STRING');
  const matches=compose.match(/^\s*restart:\s*unless-stopped\s*$/gm)||[];
  if(matches.length!==1)throw Error('COMPOSE_RESTART_POLICY_UNEXPECTED');
  return compose.replace(/^([ \t]*)restart:\s*unless-stopped\s*$/m,
    '$1restart: "no"');
}
export function renderSSDEnv(env){
  if(typeof env!=='string')throw Error('ENV_NOT_STRING');
  const key=/^HOST_DATA_DIR\s*=\s*.*$/gm;
  const matches=env.match(key)||[];
  if(matches.length!==1)throw Error('ENV_HOST_DATA_DIR_UNEXPECTED');
  const current=matches[0].replace(/^HOST_DATA_DIR\s*=\s*/,'')
    .trim().replace(/^(['"])(.*)\1$/,'$2');
  if(current!==SRC)throw Error('ENV_PREVIOUS_MOUNT_CHANGED');
  return env.replace(key,'HOST_DATA_DIR='+DATA);
}
function configurePersistentCompose(){
  // Only rewrite the NEW SSD checkout, NOT the original Mac backup.
  // Explicit physical SSD data mounts will be used for any future
  // docker compose recreation. restart:no prevents unguarded starts.
  const compose=CODE+'/compose.yaml';
  const env=CODE+'/.env';
  const code=fs.readFileSync(compose,'utf8');
  const settings=fs.readFileSync(env,'utf8');
  const a=renderSSDCompose(code),b=renderSSDEnv(settings);
  const composeMode=fs.statSync(compose).mode&0o777;
  atomic(compose,a,composeMode);
  atomic(env,b,0o600);
  if(fs.readFileSync(env,'utf8')!==b)
    throw Error('SSD_COMPOSE_ENV_WRITE_VERIFY_FAILED');
}
function envGuard(){
  const value=fs.readFileSync(CONTROLLER+'/.env','utf8')
    .split(/\r?\n/).filter(x=>/^\s*HOST_DATA_DIR\s*=/.test(x));
  if(value.length!==1)throw Error('CONTROLLER_ENV_HOST_DATA_DIR_UNEXPECTED');
  const from=value[0].replace(/^\s*HOST_DATA_DIR\s*=\s*/,'')
    .trim().replace(/^(['"])(.*)\1$/,'$2');
  if(from!==SRC)throw Error('CONTROLLER_ENV_CURRENT_MOUNT_CHANGED');
}
function cliGuard(){
  const file=path.join(HOME,'.local/share/sandbox-v3/cli.mjs');
  const record=path.join(HOME,'.local/share/sandbox-v3/install-record.json');
  const s=lstat(file),r=lstat(record);
  if(!s?.isFile()||s.isSymbolicLink()||
    !r?.isFile()||r.isSymbolicLink())
    throw Error('SANDBOX_CLI_GUARD_UPGRADE_REQUIRED');
  const data=JSON.parse(fs.readFileSync(record,'utf8'));
  const actual=crypto.createHash('sha256').update(
    fs.readFileSync(file)).digest('hex');
  const code=fs.readFileSync(file,'utf8');
  if(data.cli_sha256!==actual||
    !code.includes('guardExternalPersistentStorage()')||
    !code.includes('SSD_VOLUME_UUID_OR_APFS_RW_MISMATCH'))
    throw Error('SANDBOX_CLI_GUARD_UPGRADE_REQUIRED');
}
function atomic(loc,content,mode=0o600){
  fs.mkdirSync(path.dirname(loc),{recursive:true,mode:0o700});
  const tmp=loc+'.tmp-'+crypto.randomUUID();
  try{
    fs.writeFileSync(tmp,content,{mode,flag:'wx'});
    fs.renameSync(tmp,loc);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function saveProgress(state){
  atomic(PROGRESS,JSON.stringify({
    schema:'sandbox-v3.ssd-rollback.v1',...state},null,2)+'\n');
}
function verifyNoExistingOperation(){
  const state=lstat(PROGRESS);
  if(!state)return;
  if(!state.isFile()||state.isSymbolicLink()||state.uid!==process.getuid()||
    state.size>12000)throw Error('CUTOVER_STATE_FILE_UNTRUSTED');
  const previous=JSON.parse(fs.readFileSync(PROGRESS,'utf8'));
  if(previous.schema!=='sandbox-v3.ssd-rollback.v1'||
    previous.status!=='ROLLED_BACK')
    throw Error('PRIOR_CUTOVER_STATE_EXISTS_REVIEW_BEFORE_REPEAT');
  // A previous clean rollback is a safe starting point. The new
  // attempt overwrites the small internal state atomically.
}
function running(name){
  try{
    return run('docker',['inspect','--format','{{.State.Running}}',name])
      .trim()==='true';
  }catch{return false;}
}
function updatePolicy(name,policy){
  const allowed=['no','on-failure','always','unless-stopped'];
  if(!allowed.includes(policy))throw Error('UNEXPECTED_RESTART_POLICY');
  run('docker',['update','--restart='+policy,name],{timeout:30000});
}
function start(name){
  run('docker',['start',name],{timeout:125000});
}
function stop(name){
  if(running(name))
    run('docker',['stop','--time','120',name],{timeout:160000});
}
function nestedActive(){
  const list=run('docker',['exec','cloud-sandbox-dev-main',
    'docker','ps','-q'],{timeout:30000}).trim();
  return list?list.split(/\s+/):[];
}
function quiesceNested(ids){
  // Nested containers may hold databases open under /var/lib/docker.
  // Stop them cleanly before stopping dev-main; restart the same IDs
  // after successful cutover or after full rollback.
  if(!ids.length)return;
  run('docker',['exec','cloud-sandbox-dev-main','docker','stop',
    '--time','75',...ids],{timeout:180000});
}
function restoreNested(ids){
  for(const id of ids){
    const state=run('docker',['exec','cloud-sandbox-dev-main',
      'docker','inspect','--format','{{.State.Running}}',id],
    {timeout:30000}).trim();
    if(state==='false')
      run('docker',['exec','cloud-sandbox-dev-main',
        'docker','start',id],{timeout:45000});
  }
}
async function copy(exe,args,log,name){
  const fd=fs.openSync(log,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
  const started=Date.now();
  try{
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(exe,args,{stdio:['ignore',fd,fd]});
      const heartbeat=setInterval(()=>say('COLD_SYNC_ACTIVE',
        name+' ELAPSED_MINUTES='+Math.floor((Date.now()-started)/60000)),30000);
      child.on('error',e=>{clearInterval(heartbeat);reject(e);});
      child.on('close',c=>{clearInterval(heartbeat);resolve(c);});
    });
    if(code!==0)throw Error('COLD_SYNC_FAILED:'+name+':RC'+code+
      ':PRIVATE_LOG='+log);
  }finally{fs.closeSync(fd);}
}
export function linkToSSD(original,target,backup){
  if(lstat(backup))throw Error('ORIGINAL_BACKUP_PATH_ALREADY_EXISTS');
  originalDir(original);
  fs.renameSync(original,backup);
  try{fs.symlinkSync(target,original);}
  catch(e){fs.renameSync(backup,original);throw e;}
  if(fs.realpathSync(original)!==target)
    throw Error('CUTOVER_SYMLINK_VERIFY_FAILED');
}
export function restoreLink(original,target,backup){
  const current=lstat(original);
  if(current?.isDirectory()&&!current.isSymbolicLink()&&!lstat(backup))
    return; // rename failed and linkToSSD already restored this root
  if(current?.isSymbolicLink()&&fs.readlinkSync(original)===target)
    fs.unlinkSync(original);
  else if(current)throw Error('ROLLBACK_SYMLINK_MISMATCH:'+original);
  if(lstat(backup)&&!lstat(original))fs.renameSync(backup,original);
  else if(!lstat(original))throw Error('ROLLBACK_SOURCE_BACKUP_NOT_FOUND');
}
function probe(name,mount,relative){
  const file='.ssd-mount-probe-'+crypto.randomUUID();
  const dest=path.join(DATA,relative,file);
  const secret=crypto.randomBytes(20).toString('hex');
  fs.writeFileSync(dest,secret,{mode:0o600,flag:'wx'});
  try{
    const got=run('docker',['exec',name,'cat',mount+'/'+file],
      {timeout:15000}).trim();
    if(got!==secret)throw Error('CONTAINER_NOT_READING_SSD:'+name+':'+mount);
  }finally{fs.unlinkSync(dest);}
}
function probeWrite(){
  const file='.ssd-container-write-'+crypto.randomUUID();
  const secret=crypto.randomBytes(20).toString('hex');
  const dest=DATA+'/shared-auth/'+file;
  try{
    run('docker',['exec','cloud-sandbox-dev-main','sh','-c',
      'printf %s "$1" > "$2"','sh',secret,'/shared-auth/'+file],
    {timeout:15000});
    if(fs.readFileSync(dest,'utf8')!==secret)
      throw Error('CONTAINER_WRITE_NOT_ON_SSD');
  }finally{if(fs.existsSync(dest))fs.unlinkSync(dest);}
}
function restoreAfterFailure(s){
  const issues=[];
  function attempt(fn){try{fn();}catch(e){issues.push(e.message);}}
  attempt(()=>stop('cloud-sandbox-dev-main'));
  attempt(()=>stop('cloud-sandbox-mcp'));
  // Restore BOTH original internal paths BEFORE starting any container.
  if(s.codeBackup)attempt(()=>restoreLink(CONTROLLER,CODE,s.codeBackup));
  if(s.dataBackup)attempt(()=>restoreLink(SRC,DATA,s.dataBackup));
  attempt(()=>start('cloud-sandbox-mcp'));
  attempt(()=>start('cloud-sandbox-dev-main'));
  attempt(()=>restoreNested(s.nestedIds||[]));
  attempt(()=>updatePolicy('cloud-sandbox-mcp',s.controllerPolicy));
  attempt(()=>updatePolicy('cloud-sandbox-dev-main',s.workerPolicy));
  attempt(()=>resumeBridge(s));
  if(issues.length){
    saveProgress({...s,status:'ROLLBACK_INCOMPLETE',issues});
    say('ROLLBACK','INCOMPLETE_REQUIRES_OPERATOR_REVIEW');
    say('ROLLBACK_STATE',PROGRESS);
    return false;
  }
  saveProgress({...s,status:'ROLLED_BACK'});
  say('ROLLBACK','PASS_MAC_ORIGINAL_RESTORED');
  return true;
}
function preflight(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  guardedSSD();receiptGuard();
  originalDir(SRC);originalDir(CONTROLLER);
  envGuard();cliGuard();
  verifyNoExistingOperation();
  if(!fs.existsSync(DATA+'/shared-auth')||
     !fs.existsSync(DATA+'/workspaces/'+WID)||
     !fs.existsSync(CODE+'/compose.yaml'))
    throw Error('INCOMPLETE_STAGED_COPY');
  const policies=inspectContainers();
  const bridge=bridgePausedState();
  return {...policies,bridgeWasLoaded:bridge.wasLoaded};
}
function manualRollback(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  const current=lstat(PROGRESS);
  if(!current?.isFile()||current.isSymbolicLink()||
    current.uid!==process.getuid()||current.size>12000)
    throw Error('CUTOVER_RECOVERY_STATE_MISSING_OR_UNTRUSTED');
  const s=JSON.parse(fs.readFileSync(PROGRESS,'utf8'));
  if(s.schema!=='sandbox-v3.ssd-rollback.v1'||
    s.status==='SUCCESS_SSD_ACTIVE')
    throw Error('ACTIVE_SSD_CUTOVER_ROLLBACK_REQUIRES_OPERATOR_PLAN');
  for(const [value,prefix] of [
    [s.dataBackup,SRC+'.pre-ssd-cutover-'],
    [s.codeBackup,CONTROLLER+'.pre-ssd-cutover-']
  ]){
    if(value!==null&&value!==undefined&&
      (typeof value!=='string'||!value.startsWith(prefix)||
      value.length>prefix.length+64))
      throw Error('CUTOVER_RECOVERY_BACKUP_PATH_UNEXPECTED');
  }
  const restored=restoreAfterFailure(s);
  if(!restored)throw Error('ROLLBACK_MANUAL_REPAIR_REQUIRED');
  say('RESULT','MAC_ORIGINAL_RESTORED');
}
async function main(){
  verifyImmutableRelease();
  const mode=process.argv[2];
  if(process.argv.length!==3||
    !['--inspect','--activate','--rollback'].includes(mode))
    throw Error('USAGE_INSPECT_ACTIVATE_OR_ROLLBACK');
  if(mode==='--rollback'){manualRollback();return;}
  const policies=preflight();
  say('PREFLIGHT','PASS');
  say('DATA_COPY','STAGED_ON_SSD');
  say('ORIGINALS','BACKED_UP_ON_INTERNAL_MAC_AFTER_CUTOVER');
  if(mode==='--inspect'){
    say('NO_CHANGES','YES');
    return;
  }
  // Credential prompt happens BEFORE any Docker changes.
  const sudo=spawnSync('/usr/bin/sudo',['-v'],{stdio:'inherit',timeout:120000});
  if(sudo.status!==0||sudo.error)throw Error('SUDO_REQUIRED_NO_CHANGES');
  const nestedIds=nestedActive();
  const s={status:'STARTING',createdAt:new Date().toISOString(),
    ...policies,nestedIds,dataBackup:null,codeBackup:null};
  saveProgress(s);
  try{
    // Auto-start must not bypass the SSD UUID guard on a reboot.
    updatePolicy('cloud-sandbox-mcp','no');
    updatePolicy('cloud-sandbox-dev-main','no');
    // Before the cold copy, pause the existing audited macOS Bridge
    // LaunchAgent; it also writes into the original host data tree.
    // Preserve its loaded state and restore it on success or rollback.
    stopBridge(s);
    s.status='MAC_BRIDGE_QUIESCED';saveProgress(s);
    quiesceNested(nestedIds);
    s.status='NESTED_WORKLOADS_QUIESCED';saveProgress(s);
    stop('cloud-sandbox-dev-main');
    stop('cloud-sandbox-mcp');
    s.status='CONTAINERS_STOPPED';saveProgress(s);
    say('DOCKER_WRITERS','STOPPED');
    say('PHASE','FINAL_COLD_INCREMENTAL_SYNC');
    await copy('/usr/bin/sudo',['-n','/usr/bin/rsync',
      ...finalRsyncArgs(SRC,DATA,{persistent:true})],
      ROOT+'/reports/rsync-final-cold-persistent.private.log','persistent');
    await copy('/usr/bin/rsync',finalRsyncArgs(CONTROLLER,CODE),
      ROOT+'/reports/rsync-final-cold-controller.private.log','controller');
    s.status='COLD_SYNC_SUCCEEDED';saveProgress(s);
    // Short same-volume moves of originals to backups, then symlink
    // stable original Mac paths to SSD. NEVER delete the backups.
    const tag=stamp();
    s.codeBackup=CONTROLLER+'.pre-ssd-cutover-'+tag;
    linkToSSD(CONTROLLER,CODE,s.codeBackup);
    s.status='CONTROLLER_LINKED';saveProgress(s);
    s.dataBackup=SRC+'.pre-ssd-cutover-'+tag;
    linkToSSD(SRC,DATA,s.dataBackup);
    s.status='ROOTS_LINKED';saveProgress(s);
    start('cloud-sandbox-mcp');
    start('cloud-sandbox-dev-main');
    s.status='CONTAINERS_STARTED';saveProgress(s);
    // Prove the existing Docker binds resolve PHYSICALLY to Toshiba,
    // instead of silently continuing to use renamed Mac directories.
    probe('cloud-sandbox-mcp','/data/shared-auth','shared-auth');
    probe('cloud-sandbox-dev-main','/shared-auth','shared-auth');
    probe('cloud-sandbox-dev-main','/workspace',
      'workspaces/'+WID+'/repo');
    probe('cloud-sandbox-dev-main','/home/agent',
      'workspaces/'+WID+'/home');
    probe('cloud-sandbox-dev-main','/var/lib/docker',
      'workspaces/'+WID+'/docker');
    probeWrite();
    run('docker',['exec','cloud-sandbox-mcp','node','-e',
      "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
      {timeout:20000});
    run('docker',['exec','cloud-sandbox-dev-main','docker','info'],
      {timeout:35000});
    restoreNested(nestedIds);
    configurePersistentCompose();
    resumeBridge(s);
    s.status='SUCCESS_SSD_ACTIVE';saveProgress(s);
    atomic(ROOT+'/reports/cutover-receipt.json',JSON.stringify({
      schema:'sandbox-v3.ssd-alias-cutover.v1',
      result:'PHYSICAL_SSD_MOUNTS_VERIFIED',
      timestamp:new Date().toISOString(),
      volumeUuid:VOLUME_UUID,
      originalMacDataBackup:s.dataBackup,
      originalMacCodeBackup:s.codeBackup,
      originalMacDataPreserved:true,
      dockerExistingContainerIdsPreserved:true,
      containerRestartPolicies:'no_requires_guarded_sandbox_command',
      linuxContainerMountProbes:'PASS_READ_WRITE_TO_SSD',
      nestedPreviouslyRunningContainersRestored:true,
      existingMacBridgeRestored:s.bridgeWasLoaded,
      ssdComposeDataRootConfigured:true,
      ssdComposeRestartPolicy:'no',
      dockerDesktopDiskImageMovedByThisScript:false,
      preserveBackupsUntilIndependentAcceptance:true
    },null,2)+'\n');
    say('RESULT','CUTOVER_TO_EXTERNAL_SSD_PASS');
    say('MAC_ORIGINAL_BACKUP',s.dataBackup);
    say('MAC_CONTROLLER_BACKUP',s.codeBackup);
    say('DOCKER_RAW','NOT_MOVED_BY_THIS_SCRIPT_USE_DOCKER_DESKTOP_GUI');
    say('STARTUP','USE_GUARDED_SANDBOX_COMMAND');
    say('DELETE_MAC_ORIGINALS','NO_AWAIT_INDEPENDENT_ACCEPTANCE');
  }catch(error){
    say('STOP',error?.message||'UNKNOWN');
    const pass=restoreAfterFailure(s);
    if(!pass)throw Error('CUTOVER_AND_ROLLBACK_FAILED_REVIEW_LOCAL_STATE');
    throw Error('CUTOVER_FAILED_AUTOMATIC_ROLLBACK_PASS');
  }
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  main().catch(error=>{
    say('STOP',String(error?.message||'UNKNOWN').slice(0,220));
    process.exitCode=2;
  });
}
