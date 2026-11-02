#!/usr/bin/env node
/**
 * Safe Toshiba SSD staging for Sandbox V3 on the same Mac.
 * --inspect: no writes. --stage: initial resumable COPY to new folder.
 * Never edits the original source, active Docker mounts or Docker.raw.
 * Initial copy is NOT a consistent live snapshot or a cutover.
 */
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {spawn,spawnSync} from 'node:child_process';
import {setInterval,clearInterval} from 'node:timers';
import {fileURLToPath} from 'node:url';

export const VOLUME='/Volumes/SSD';
export const VOLUME_UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
export const ROOT='/Volumes/SSD/Sandbox';
export const DATA_DEST=ROOT+'/persistent/cloud-sandbox-mcp-data';
export const CODE_DEST=ROOT+'/source/cloud-sandbox-workstation';
export const DOCKER_GUI_DEST=ROOT+'/docker-desktop';
export const LEGACY_SSD_WORKTREE='/Volumes/SSD/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation';
export const EPHEMERAL_UV_CACHE_RELATIVE=
  '/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/home/.cache/uv/';
const packageDir=path.dirname(fileURLToPath(import.meta.url));
const dataSource=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const controllerSource=path.join(os.homedir(),
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const giB=n=>Math.round(n/(1024**3)*100)/100;
function run(exe,args,{timeout=13000,input}={}){
  const r=spawnSync(exe,args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],
    timeout,input,maxBuffer:3_000_000});
  return {ok:r.status===0&&!r.error,stdout:r.stdout??'',error:r.error?.code??null};
}
function lstat(loc){
  try{return fs.lstatSync(loc);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function isOwnedDirectory(p){
  const st=lstat(p);
  return Boolean(st?.isDirectory()&&!st.isSymbolicLink()&&
    st.uid===process.getuid());
}
export function classifyVolume(info={},availableGiB=0){
  const apfs=/(^|[^A-Z])APFS([^A-Z]|$)/i.test(
    String(info.FileSystemPersonality||'')+' '+String(info.FilesystemType||''));
  const writable=(info.Writable===true||
    info.ReadOnlyVolume===false||info.VolumeReadOnly===false) &&
    info.ReadOnlyVolume!==true && info.VolumeReadOnly!==true &&
    info.WriteProtected!==true && info.ReadOnlyMedia!==true;
  const uuid=String(info.VolumeUUID||'').toUpperCase();
  const valid=apfs&&info.MountPoint===VOLUME&&
    info.Internal===false&&uuid===VOLUME_UUID&&
    writable&&availableGiB>=500;
  return {valid,reason:!apfs?'NOT_APFS':
    info.MountPoint!==VOLUME?'UNEXPECTED_VOLUME_PATH':
      info.Internal!==false?'NOT_EXTERNAL':
        uuid!==VOLUME_UUID?'SSD_UUID_CHANGED':
          !writable?'SSD_NOT_CONFIRMED_WRITABLE':
            availableGiB<500?'SSD_CAPACITY_INSUFFICIENT':'PASS',
    encryptionOptional:true,encrypted:info.Encrypted===true,
    availableGiB,uuid};
}
function parseDiskutil(){
  const plist=run('/usr/sbin/diskutil',['info','-plist',VOLUME]);
  if(!plist.ok)throw Error('SSD_DISKUTIL_UNAVAILABLE');
  const parsed=run('/usr/bin/plutil',['-convert','json','-o','-','-'],
    {input:plist.stdout});
  if(!parsed.ok)throw Error('SSD_PLIST_CANNOT_CONVERT');
  try{return JSON.parse(parsed.stdout);}
  catch{throw Error('SSD_PLIST_CORRUPTED');}
}
function availableDisk(){
  const mount=lstat(VOLUME);
  if(!mount?.isDirectory()||mount.isSymbolicLink())
    throw Error('EXTERNAL_SSD_MOUNT_NOT_REAL_DIRECTORY');
  const info=parseDiskutil();
  const stat=fs.statfsSync(VOLUME);
  const disk=classifyVolume(info,
    giB(Number(stat.bavail)*Number(stat.bsize||stat.frsize)));
  if(!disk.valid)throw Error('SSD_PREFLIGHT_'+disk.reason);
  fs.accessSync(VOLUME,fs.constants.W_OK);
  return disk;
}
export function selectedDockerMounts(containers,source=dataSource){
  const expected={
    'cloud-sandbox-mcp':{'/data':source},
    'cloud-sandbox-dev-main':{
      '/workspace':source+'/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/repo',
      '/home/agent':source+'/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/home',
      '/shared-auth':source+'/shared-auth',
      '/var/lib/docker':source+'/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/docker'
    }
  };
  if(!Array.isArray(containers))throw Error('INVALID_DOCKER_INSPECT');
  for(const [name,required] of Object.entries(expected)){
    const container=containers.find(c=>c.Name==='/'+name);
    if(!container||container.State?.Running!==true)
      throw Error('EXPECTED_MAC_CONTAINER_NOT_RUNNING:'+name);
    for(const [where,from] of Object.entries(required)){
      const actual=(container.Mounts||[]).find(m=>
        m.Type==='bind'&&m.Destination===where)?.Source;
      if(actual!==from)throw Error('MAC_BIND_SOURCE_CHANGED:'+name+':'+where);
    }
  }
  return {expectedContainerCount:2,mountSourceValidated:true};
}
function verifyDocker(){
  const result=run('docker',['inspect','cloud-sandbox-mcp',
    'cloud-sandbox-dev-main'],{timeout:20000});
  if(!result.ok)throw Error('MAC_DOCKER_INSPECT_UNAVAILABLE');
  let values;
  try{values=JSON.parse(result.stdout);}
  catch{throw Error('MAC_DOCKER_INSPECT_UNPARSABLE');}
  const mounts=selectedDockerMounts(values);
  const controller=values.find(x=>x.Name==='/cloud-sandbox-mcp');
  const activeCheckout=controller?.Config?.Labels?.[
    'com.docker.compose.project.working_dir']??null;
  if(activeCheckout!==controllerSource)
    throw Error('MAC_ACTIVE_CONTROLLER_CHECKOUT_MISMATCH');
  return {...mounts,activeCheckout};
}
function safeSource(){
  if(!isOwnedDirectory(dataSource)||!isOwnedDirectory(controllerSource))
    throw Error('SOURCE_NOT_USER_OWNED_REAL_DIRECTORY');
  if(!isOwnedDirectory(dataSource+'/shared-auth')||
     !isOwnedDirectory(dataSource+'/workspaces'))
    throw Error('EXPECTED_DATA_SUBDIRECTORY_MISSING');
  if(fs.realpathSync(dataSource)!==dataSource||
     fs.realpathSync(controllerSource)!==controllerSource)
    throw Error('SOURCE_PATH_REALPATH_MISMATCH');
  return {dataSource,controllerSource};
}
export const STAGE_SCHEMA='sandbox-v3.toshiba-stage.v1';
export function stageMarker({uuid=VOLUME_UUID,data=dataSource,
  controller=controllerSource}={}){
  return {schema:STAGE_SCHEMA,externalVolume:VOLUME,volumeUuid:uuid,
    targetRoot:ROOT,dataSource:data,controllerSource:controller,
    legacySsdWorktreePreserved:true,dockerDiskImageMoved:false,
    dockerBindSourcesChanged:false,sourceDeleted:false,
    consistentSnapshot:false,canCutover:false};
}
function markerFile(){return ROOT+'/.sandbox-v3-stage.json';}
export function validateStageMarker(marker){
  const expected=stageMarker();
  if(!marker||Object.entries(expected).some(([key,value])=>
    marker[key]!==value))throw Error('STAGE_FOLDER_UNRECOGNIZED_OR_CHANGED');
  return true;
}
function writeAtomically(file,data,mode=0o600){
  const dir=path.dirname(file);
  const temp=path.join(dir,'.sandbox-stage-'+crypto.randomUUID());
  try{
    fs.writeFileSync(temp,data,{flag:'wx',mode});
    fs.renameSync(temp,file);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function safeStageDirectoryMode(mode,{leaf=false}={}){
  // The root and intermediate paths MUST be 0700-ish, enclosing
  // the secret-bearing dataset. Rsync -a resets the final directory
  // permissions to those of the original checkout/data root (often
  // 0755); requiring 0700 there breaks every subsequent resume.
  // Only the two terminal copy directories may be group/world
  // READABLE; never group/world WRITABLE. The enclosing parents
  // remain private. Require user read/write/execute on every path.
  const bits=mode&0o777;
  return (bits&0o700)===0o700&&
    (leaf?(bits&0o022)===0:(bits&0o077)===0);
}
function guardedMkdir(directory,{shouldBeNew=false}={}){
  if(shouldBeNew){
    if(lstat(directory))throw Error('TARGET_COLLISION:'+path.basename(directory));
    fs.mkdirSync(directory,{mode:0o700});
  }else if(!lstat(directory)){
    fs.mkdirSync(directory,{mode:0o700});
  }
  // Never change existing permissions or ownership. rsync -a
  // legitimately restores source modes to its two destination roots.
  const leaf=directory===CODE_DEST||directory===DATA_DEST;
  if(!isOwnedDirectory(directory)||
     !safeStageDirectoryMode(fs.lstatSync(directory).mode,{leaf}))
    throw Error('STAGE_DIRECTORY_UNSAFE_MODE:'+path.basename(directory));
}
function openStage(){
  const existing=lstat(ROOT);
  if(existing){
    if(!isOwnedDirectory(ROOT))
      throw Error('UNTRUSTED_EXISTING_STAGE_DIRECTORY');
    const manifest=lstat(markerFile());
    if(!manifest?.isFile()||manifest.isSymbolicLink()||
       manifest.uid!==process.getuid()||manifest.size>5_000||
       (manifest.mode&0o077)!==0)
      throw Error('EXISTING_DESTINATION_WITHOUT_TRUSTED_MARKER');
    let marker;
    try{marker=JSON.parse(fs.readFileSync(markerFile(),'utf8'));}
    catch{throw Error('STAGE_MARKER_CORRUPT');}
    validateStageMarker(marker);
    guardedMkdir(ROOT);
  }else{
    guardedMkdir(ROOT,{shouldBeNew:true});
    writeAtomically(markerFile(),
      JSON.stringify({...stageMarker(),createdAt:new Date().toISOString()},null,2)+'\n');
  }
  for(const directory of [
    ROOT+'/source',
    ROOT+'/persistent',
    ROOT+'/reports',
    DOCKER_GUI_DEST,
    DATA_DEST,
    CODE_DEST]){
    guardedMkdir(directory);
  }
  // A disposable write/readback fixture ONLY inside our new Sandbox folder.
  const probe=path.join(ROOT,'reports','.probe-'+crypto.randomUUID());
  const payload=crypto.randomBytes(32);
  try{
    fs.writeFileSync(probe,payload,{flag:'wx',mode:0o600});
    if(!fs.readFileSync(probe).equals(payload))throw Error('SSD_WRITE_READBACK_FAILED');
  }finally{
    if(fs.existsSync(probe))fs.unlinkSync(probe);
  }
}
export function rsyncArgs(source,destination){
  if(!path.isAbsolute(source)||!path.isAbsolute(destination)||
     ![dataSource,controllerSource].includes(source)||
     ![DATA_DEST,CODE_DEST].includes(destination)||
     (source===dataSource)!==(destination===DATA_DEST))
    throw Error('SOURCE_OR_TARGET_NOT_ALLOWLISTED');
  const args=['-aEH','--stats'];
  // The uv archive is a disposable, actively regenerated cache; its
  // ._ sidecars vanish during Mac rsync, causing rc=1 on every retry.
  // Exclude the EXACT observed cache path, never all .cache or .git.
  if(source===dataSource)args.push('--exclude='+EPHEMERAL_UV_CACHE_RELATIVE);
  return [...args,'--',source+'/',destination+'/'];
}
async function runRsync(name,src,dest){
  const persistent=name==='persistent'&&src===dataSource&&dest===DATA_DEST;
  // The original Mac user cannot read a Git pack index in an archived
  // nested-Docker dataset. Authenticate via terminal, then run ONLY the
  // exact allowlisted rsync under sudo, preserving original UID/GID.
  // This never performs chown/chmod on the SOURCE or overwrites old SSD
  // directories. All writes are confined to the previously marked stage.
  if(persistent){
    const auth=spawnSync('/usr/bin/sudo',['-v'],{
      stdio:'inherit',timeout:120000
    });
    if(auth.status!==0||auth.error)
      throw Error('SUDO_AUTH_FAILED_NO_DATA_SOURCE_MODIFIED');
  }
  const log=path.join(ROOT,'reports','rsync-'+name+'.private.log');
  const existingLog=lstat(log);
  if(existingLog&&(!existingLog.isFile()||existingLog.isSymbolicLink()||
     existingLog.uid!==process.getuid()||
     (existingLog.mode&0o077)!==0))
    throw Error('STAGING_PRIVATE_LOG_UNTRUSTED');
  const fd=fs.openSync(log,fs.constants.O_WRONLY|fs.constants.O_APPEND|
    fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
  const args=rsyncArgs(src,dest);
  try{
    let heartbeat=null;
    const started=Date.now();
    let code;
    try{
      code=await new Promise((resolve,reject)=>{
        const child=spawn(persistent?'/usr/bin/sudo':'/usr/bin/rsync',
        persistent?['-n','/usr/bin/rsync',...args]:args,
        {stdio:['ignore',fd,fd],env:process.env});
        heartbeat=setInterval(()=>{
          const elapsedMinutes=Math.floor((Date.now()-started)/60000);
          console.log('[SSD Stage] COPY_ACTIVE='+name+
            ' ELAPSED_MINUTES='+elapsedMinutes+
            ' STATUS=INITIAL_STAGING_NOT_CUTOVER');
        },30000);
        child.on('error',reject);
        child.on('close',resolve);
      });
    }finally{if(heartbeat)clearInterval(heartbeat);}
    if(code!==0)throw Error('RSYNC_'+name.toUpperCase()+'_EXIT_'+code+
      '_REVIEW_PRIVATE_LOG');
    return {component:name,status:'STAGED_NON_AUTHORITATIVE',
      privateLog:log,exitCode:0};
  }finally{fs.closeSync(fd);}
}
function verifiedPackage(){
  const manifest=fs.readFileSync(path.join(packageDir,'manifest.json'));
  const digest=fs.readFileSync(path.join(packageDir,'manifest.sha256'),'utf8').trim();
  if(sha(manifest)!==digest)throw Error('RELEASE_MANIFEST_HASH_MISMATCH');
  const data=JSON.parse(manifest.toString('utf8'));
  if(data.schema!=='sandbox-v3.ssd-stage-release.v1')
    throw Error('STAGE_RELEASE_IDENTITY_MISMATCH');
  for(const [name,expected] of Object.entries(data.files_sha256)){
    if(!/^[A-Za-z][A-Za-z0-9.-]+\.(?:mjs|md)$/.test(name))
      throw Error('STAGE_RELEASE_FILE_NAME_INVALID');
    const file=path.join(packageDir,name);
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||
       sha(fs.readFileSync(file))!==expected)
      throw Error('STAGE_RELEASE_FILE_HASH_MISMATCH');
  }
}
function baseReadiness(){
  const disk=availableDisk();
  const source=safeSource();
  const docker=verifyDocker();
  const target=lstat(ROOT);
  if(target&&(!target.isDirectory()||target.isSymbolicLink()))
    throw Error('SSD_SANDBOX_TARGET_UNTRUSTED');
  return {disk,source,docker,targetExists:Boolean(target),
    copyRunsOnlyWithExplicitStageFlag:true,
    externalDiskUnencryptedAccepted:true,
    oldSsdWorktree:LEGACY_SSD_WORKTREE,
    target:ROOT,
    dockerDesktopImageRequiresSeparateGuiMove:true};
}
async function main(){
  const flag=process.argv[2];
  if(process.argv.length!==3||!['--inspect','--stage'].includes(flag))
    throw Error('USE_INSPECT_OR_STAGE');
  if(process.platform!=='darwin')throw Error('MACOS_HOST_ONLY');
  verifiedPackage();
  const ready=baseReadiness();
  console.log('[SSD Stage] PREFLIGHT=PASS');
  console.log('[SSD Stage] UUID='+ready.disk.uuid);
  console.log('[SSD Stage] TARGET='+ROOT);
  console.log('[SSD Stage] ENCRYPTION=OPTIONAL_USER_ACCEPTED');
  console.log('[SSD Stage] LEGACY_SSD_FOLDER=UNTOUCHED');
  if(flag==='--inspect'){
    console.log(JSON.stringify({...ready,operation:'READ_ONLY_NO_COPY'},null,2));
    return;
  }
  openStage();
  console.log('[SSD Stage] PHASE=CODE_STAGING_COPY');
  const code=await runRsync('controller',controllerSource,CODE_DEST);
  console.log('[SSD Stage] PHASE=PERSISTENT_DATA_STAGING_COPY');
  console.log('[SSD Stage] EPHEMERAL_UV_CACHE=EXCLUDED_SOURCE_UNCHANGED');
  console.log('[SSD Stage] PROTECTED_GIT_ARCHIVE=INCLUDED_VIA_SUDO');
  const data=await runRsync('persistent',dataSource,DATA_DEST);
  const receipt={
    schema:STAGE_SCHEMA,operation:'LIVE_STAGING_COPY_COMPLETED',
    completedAt:new Date().toISOString(),volumeUuid:VOLUME_UUID,
    sourcePathsPreserved:true,ssdLegacyFilesPreserved:true,
    copiedInto:ROOT,components:[code,data],
    activeDataMayHaveChangedDuringCopy:true,
    excludedRegenerableUvCache:true,
    privilegedRsyncReadForInaccessibleArchivedGitIndex:true,
    requireColdFinalSync:true,requireStrongVerification:true,
    dockerDesktopDiskImageMoved:false,
    dockerBindMountsRetargeted:false,
    migrationCutoverExecuted:false,
    safeToDeleteOriginal:false
  };
  writeAtomically(ROOT+'/reports/staging-receipt.json',
    JSON.stringify(receipt,null,2)+'\n');
  // Handoff report remains on Mac source until final migration cutover.
  writeAtomically(path.join(packageDir,'last-mac-stage.json'),
    JSON.stringify(receipt,null,2)+'\n');
  console.log('[SSD Stage] RESULT=STAGED_COPY_ONLY_NOT_CUTOVER');
  console.log('[SSD Stage] ORIGINAL_MAC_DATA=PRESERVED');
  console.log('[SSD Stage] DOCKER_BINDINGS=UNCHANGED');
  console.log('[SSD Stage] FINAL_COLD_SYNC=REQUIRED');
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  main().catch(error=>{
    console.error('[SSD Stage] STOP='+String(error?.message||'UNKNOWN').slice(0,150));
    process.exitCode=2;
  });
}
