#!/usr/bin/env node
/*
 * Finish a Mac-to-Toshiba Games/nxnative migration safely.
 * No file deletion, no Docker restart, no rsync copy. The destination
 * is promoted only after a fresh read-only checksum comparison succeeds.
 * Original user content is retained under a timestamped rollback path.
 */
import console from 'node:console';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawn,spawnSync} from 'node:child_process';
import {setInterval,clearInterval} from 'node:timers';
import {fileURLToPath} from 'node:url';

export const SSD='/Volumes/SSD';
export const EXPECTED_UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
export const SRC=path.join(os.homedir(),'Games/nxnative');
export const STAGING='/Volumes/SSD/MacStorage/.migration-staging/Games-nxnative-20261101-225027';
export const FINAL='/Volumes/SSD/MacStorage/Games-nxnative';
const releaseDir=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function ls(p){
  try{return fs.lstatSync(p);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function validateVolume(info={}){
  const uuid=String(info.VolumeUUID||'').toUpperCase();
  const apfs=/APFS/i.test(String(info.FileSystemPersonality||'')+
    ' '+String(info.FilesystemType||''));
  const good=info.MountPoint===SSD&&uuid===EXPECTED_UUID&&
    info.Internal===false&&info.Writable===true&&apfs;
  if(!good)throw Error('TOSHIBA_SSD_IDENTITY_OR_MOUNT_CHANGED');
  return {volumeUUID:uuid,readWrite:true,apfs:true};
}
export function verifyArgs(src=SRC,dst=STAGING){
  if(src!==SRC||dst!==STAGING)throw Error('VERIFY_SOURCE_TARGET_NOT_ALLOWLISTED');
  // --delete is safe here because -n always runs in DRY RUN mode.
  return ['-rclni','--delete','--',src+'/',dst+'/'];
}
function realDir(p){
  const stat=ls(p);
  return Boolean(stat?.isDirectory()&&!stat.isSymbolicLink());
}
function checkedHost(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  for(const p of [SSD,SSD+'/MacStorage',
    SSD+'/MacStorage/.migration-staging']){
    if(!realDir(p))throw Error('EXPECTED_REAL_DIRECTORY_NOT_PRESENT:'+p);
  }
  const disk=spawnSync('/usr/sbin/diskutil',['info','-plist',SSD],
    {encoding:'utf8',timeout:13000,maxBuffer:500000});
  if(disk.status!==0)throw Error('MAC_DISKUTIL_READ_FAILED');
  const asJson=spawnSync('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],
    {input:disk.stdout,encoding:'utf8',timeout:13000,maxBuffer:500000});
  if(asJson.status!==0)throw Error('MAC_DISKUTIL_PARSE_FAILED');
  let info;
  try{info=JSON.parse(asJson.stdout);}
  catch{throw Error('MAC_DISKUTIL_JSON_CORRUPT');}
  const identity=validateVolume(info);
  const device=fs.statSync(SSD).dev;
  if(fs.statSync(SSD+'/MacStorage').dev!==device ||
     fs.statSync(SSD+'/MacStorage/.migration-staging').dev!==device)
    throw Error('SSD_DIRECTORY_UNEXPECTED_DEVICE');
  return {...identity,device};
}
export function inspectPaths({src=SRC,stage=STAGING,dest=FINAL}={}){
  if(src!==SRC||stage!==STAGING||dest!==FINAL)
    throw Error('PATH_OVERRIDE_DENIED');
  const orig=ls(src),copy=ls(stage),finished=ls(dest);
  if(orig?.isSymbolicLink()&&finished?.isDirectory()&&
     fs.readlinkSync(src)===dest)
    return {alreadyLinked:true,originalAvailableAsBackupNotChecked:true};
  if(!orig?.isDirectory()||orig.isSymbolicLink())
    throw Error('MAC_SOURCE_MUST_BE_REAL_DIRECTORY');
  if(!copy?.isDirectory()||copy.isSymbolicLink())
    throw Error('EXPECTED_SSD_STAGING_DIRECTORY_NOT_PRESENT');
  if(finished)throw Error('SSD_FINAL_DESTINATION_ALREADY_EXISTS');
  if(orig.uid!==process.getuid()||copy.uid!==process.getuid())
    throw Error('SOURCE_OR_STAGE_NOT_OWNED_BY_USER');
  if(fs.statSync(stage).dev!==fs.statSync(SSD).dev)
    throw Error('STAGING_IS_NOT_ON_EXPECTED_SSD_DEVICE');
  if(orig.dev===copy.dev)throw Error('SOURCE_AND_COPY_ON_SAME_DEVICE');
  return {alreadyLinked:false,sourceInode:orig.ino,
    sourceDevice:orig.dev,stagingInode:copy.ino,
    stagingDevice:copy.dev};
}
function verifyRelease(){
  const bytes=fs.readFileSync(path.join(releaseDir,'manifest.json'));
  const digest=fs.readFileSync(path.join(releaseDir,'manifest.sha256'),'utf8').trim();
  if(sha(bytes)!==digest)throw Error('RELEASE_MANIFEST_HASH_INVALID');
  const manifest=JSON.parse(bytes);
  if(manifest.schema!=='nxnative.ssd-safe-finalize.v1'||
    manifest.volumeUuid!==EXPECTED_UUID||
    manifest.src!==SRC||manifest.stage!==STAGING||manifest.dst!==FINAL)
    throw Error('RELEASE_PARAMETERS_UNEXPECTED');
  for(const [name,expected] of Object.entries(manifest.files_sha256)){
    if(!/^[A-Za-z0-9.-]+\.(?:mjs|md)$/.test(name))
      throw Error('RELEASE_FILENAME_INVALID');
    const file=path.join(releaseDir,name);
    if(sha(fs.readFileSync(file))!==expected)
      throw Error('RELEASE_FILE_INTEGRITY_FAILED');
  }
}
function processesWithActiveMigration(){
  const r=spawnSync('/bin/ps',['-ww','-axo','pid=,command='],
    {encoding:'utf8',timeout:13000,maxBuffer:3500000});
  if(r.status!==0)throw Error('CANNOT_CONFIRM_NO_LIVE_MIGRATION_PROCESS');
  const active=r.stdout.split('\n').filter(row=>
    /migrate-switch-smart\.py|rsync/.test(row)&&
    (row.includes('/Games/nxnative/')||
     row.includes('Games-nxnative-20261101-225027')||
     row.includes('/Development/migrate-switch-smart.py')));
  if(active.length)throw Error('LIVE_MIGRATION_OR_NXNATIVE_RSYNC_EXISTS');
  return {activeMigrationProcesses:0};
}
function rsyncPath(){
  for(const p of ['/opt/homebrew/bin/rsync','/usr/bin/rsync']){
    try{
      if(fs.statSync(p).isFile()){
        fs.accessSync(p,fs.constants.X_OK);
        return p;
      }
    }catch{/* try next verified system binary */}
  }
  throw Error('RSYNC_NOT_FOUND');
}
function privateLog(){
  const file=SSD+'/MacStorage/.migration-staging/nxnative-final-checksum-'+
    process.pid+'-'+Date.now()+'.private.log';
  const fd=fs.openSync(file,'wx',0o600);
  return {file,fd};
}
async function checksumCompare(){
  const binary=rsyncPath(),args=verifyArgs();
  const record=privateLog();
  console.log('[nxnative finish] CHECKSUM_VERIFY=START READ_ONLY_NO_COPY');
  console.log('[nxnative finish] FULL_FILE_DATA_COMPARISON=IN_PROGRESS');
  let pulse=null;
  let status;
  try{
    status=await new Promise((resolve,reject)=>{
      const child=spawn(binary,args,
        {stdio:['ignore',record.fd,record.fd]});
      const started=Date.now();
      pulse=setInterval(()=>{
        const minutes=Math.floor((Date.now()-started)/60000);
        console.log('[nxnative finish] VERIFY_ACTIVE_ELAPSED_MINUTES='+minutes+
          ' STAGING_PRESERVED=YES');
      },25000);
      child.on('error',reject);
      child.on('close',resolve);
    });
  }finally{
    if(pulse)clearInterval(pulse);
    fs.closeSync(record.fd);
  }
  if(status!==0)throw Error('CHECKSUM_VALIDATION_FAILED_RC_'+status+
    '_DETAILS_IN_PRIVATE_LOG');
  if(fs.statSync(record.file).size!==0)
    throw Error('CHECKSUM_DIFFERENCES_EXIST_INSPECT_PRIVATE_LOG');
  return {checksumExitCode:0,checksumDifferences:0,
    privateLog:record.file};
}
function ensureUnchanged(before){
  const now=inspectPaths();
  if(now.alreadyLinked||now.sourceInode!==before.sourceInode||
     now.sourceDevice!==before.sourceDevice||
     now.stagingInode!==before.stagingInode||
     now.stagingDevice!==before.stagingDevice)
    throw Error('SOURCE_OR_STAGE_CHANGED_DURING_VALIDATION');
}
export function backupName(now=new Date()){
  const timestamp=now.toISOString().replace(/[-:]/g,'').replace(/\..*$/,'').replace('T','-');
  return SRC+'.pre-ssd-migration-'+timestamp;
}
export function atomicSwitchKeepingBackup({
  source,stage,dest,backup,filesystem=fs,expectedDestDevice=null
}){
  function statOptional(p){
    try{return filesystem.lstatSync(p);}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  function dir(p){
    const s=statOptional(p);
    return Boolean(s?.isDirectory()&&!s.isSymbolicLink());
  }
  if(statOptional(dest)||statOptional(backup))
    throw Error('ATOMIC_SWITCH_TARGET_OR_BACKUP_ALREADY_EXISTS');
  if(!dir(source)||!dir(stage))throw Error('ATOMIC_SWITCH_ORIGINAL_OR_STAGE_MISSING');
  filesystem.renameSync(stage,dest);
  try{
    if(!dir(dest)||(expectedDestDevice!=null&&
      filesystem.statSync(dest).dev!==expectedDestDevice))
      throw Error('PROMOTED_SSD_PATH_INVALID');
    filesystem.renameSync(source,backup);
  }catch(e){
    if(dir(dest)&&!statOptional(stage)&&dir(source)){
      try{filesystem.renameSync(dest,stage);}
      catch{/* preserve both paths for manual recovery */}
    }
    throw e;
  }
  try{
    filesystem.symlinkSync(dest,source,'dir');
    if(!statOptional(source)?.isSymbolicLink()||
       filesystem.readlinkSync(source)!==dest||
       filesystem.realpathSync(source)!==filesystem.realpathSync(dest))
      throw Error('SYMLINK_VALIDATION_FAILED');
  }catch(e){
    // Remove only the newly created symlink, never files in the backup.
    try{
      if(statOptional(source)?.isSymbolicLink()&&
         filesystem.readlinkSync(source)===dest)
        filesystem.unlinkSync(source);
    }catch{/* preserve backup and final for manual recovery */}
    if(!statOptional(source)&&dir(backup)){
      try{filesystem.renameSync(backup,source);}
      catch{/* preserve backup and final for manual recovery */}
    }
    throw e;
  }
  if(!dir(backup))throw Error('ORIGINAL_BACKUP_MISSING_AFTER_LINK');
  return {originalBackup:backup,ssdFinal:dest,macOriginalNowSymlink:source};
}
function safePromote(before,backup){
  checkedHost();processesWithActiveMigration();ensureUnchanged(before);
  console.log('[nxnative finish] CHECKSUM=PASS; PROMOTING_ATOMICALLY');
  return atomicSwitchKeepingBackup({
    source:SRC,stage:STAGING,dest:FINAL,backup,
    expectedDestDevice:before.stagingDevice
  });
}
function receipt(file,details){
  const body=JSON.stringify({
    schema:'nxnative.ssd-safe-finalize.v1',
    timestamp:new Date().toISOString(),
    result:'LINKED_TO_SSD_WITH_MAC_ROLLBACK_RETAINED',
    source: SRC,ssdDestination:FINAL,originalBackup:details.originalBackup,
    copiedDataDeleted:false,originalDataDeleted:false,
    checksumExitCode:details.checksumExitCode,
    checksumDifferences:details.checksumDifferences,
    requiresGameLaunchAcceptance:true,
    safeToDeleteBackup:false
  },null,2)+'\n';
  fs.writeFileSync(file,body,{flag:'wx',mode:0o600});
}
async function main(){
  const mode=process.argv[2];
  if(process.argv.length!==3||!['--inspect','--finalize'].includes(mode))
    throw Error('EXPECTED_MODE_INSPECT_OR_FINALIZE');
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  verifyRelease();
  const volume=checkedHost();
  const paths=inspectPaths();
  if(paths.alreadyLinked){
    console.log('[nxnative finish] ALREADY_LINKED='+FINAL);
    console.log('[nxnative finish] ORIGINAL_BACKUP_MUST_BE_CHECKED');
    return;
  }
  processesWithActiveMigration();
  console.log('[nxnative finish] SSD_UUID=VALID '+volume.volumeUUID);
  console.log('[nxnative finish] SOURCE_AND_STAGE=READY');
  console.log('[nxnative finish] FINAL_PATH='+FINAL);
  if(mode==='--inspect'){
    console.log('[nxnative finish] INSPECT=PASS; NO_FILES_CHANGED');
    return;
  }
  const check=await checksumCompare();
  console.log('[nxnative finish] CHECKSUM=PASS ZERO_DIFFERENCES');
  const backup=backupName();
  const finalized=safePromote(paths,backup);
  const report=SSD+'/MacStorage/.migration-staging/nxnative-finalized-'+
    process.pid+'.receipt.json';
  try{receipt(report,{...finalized,...check});}
  catch(e){
    console.error('[nxnative finish] WARNING_RECEIPT_WRITE_FAILED='+e.code);
  }
  console.log('[nxnative finish] COMPLETE=YES');
  console.log('[nxnative finish] MAC_LINK='+SRC+' -> '+FINAL);
  console.log('[nxnative finish] ORIGINAL_MAC_BACKUP_PRESERVED='+backup);
  console.log('[nxnative finish] ORIGINAL_BACKUP_DELETE=NO');
  console.log('[nxnative finish] GAME_LAUNCH_ACCEPTANCE=PENDING');
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  main().catch(e=>{
    console.error('[nxnative finish] STOP='+String(e.message).slice(0,190));
    process.exitCode=2;
  });
}
