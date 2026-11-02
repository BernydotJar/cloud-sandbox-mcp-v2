#!/usr/bin/env node
/**
 * Non-destructive Mac review of existing Toshiba SSD legacy V2 checkout,
 * real volume read/write evidence and version-neutral future Sandbox path.
 * NO deletion, copy, volume creation or service restart. Report only.
 */
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const EXISTING_SSD='/Volumes/SSD';
export const LEGACY_CHECKOUT='/Volumes/SSD/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation';
export const VERSION_FREE_CHECKOUT='/Volumes/Sandbox/source/cloud-sandbox-workstation';
export const PREFERRED_VOLUME='/Volumes/Sandbox';
export const HISTORICAL_CHECKOUT_NAME='cloud-sandbox-mcp-v0.2.0-workstation';
export const STABLE_CHECKOUT_NAME='cloud-sandbox-workstation';
export const PINNED_EXISTING_VOLUME_UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
const controllerName='cloud-sandbox-mcp';
const workstationName='cloud-sandbox-dev-main';
const currentSource=path.join(os.homedir(),
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const here=path.dirname(fileURLToPath(import.meta.url));
const sha=content=>crypto.createHash('sha256').update(content).digest('hex');
function run(exe,args,{timeout=10000,input}={}){
  const r=spawnSync(exe,args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],
    maxBuffer:4000000,timeout,input});
  return {ok:r.status===0&&!r.error,stdout:r.stdout??'',
    code:r.status,error:r.error?.code??null};
}
function optionalLstat(location){
  try{return fs.lstatSync(location);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function realpath(location){
  try{return fs.realpathSync(location);}catch{return null;}
}
export function classifyVolumeAccess({
  info={},mountOutput='',userWritable=false,mountPoint=EXISTING_SSD
}={}){
  const readableFields={};
  for(const key of ['ReadOnlyVolume','ReadOnlyMedia','VolumeReadOnly',
    'Writable','MediaWritable','WriteProtected']){
    if(typeof info[key]==='boolean')readableFields[key]=info[key];
  }
  const mount=String(mountOutput).split('\n')
    .find(row=>row.includes(' on '+mountPoint+' ('))??'';
  const attrs=mount.match(/ \(([^)]*)\)/)?.[1]??'';
  const options=attrs.split(',').map(s=>s.trim().toLowerCase());
  const mountObserved=Boolean(mount);
  const mountReadOnly=options.some(x=>
    ['read-only','rdonly','ro'].includes(x));
  const explicitlyReadOnly=info.ReadOnlyVolume===true||
    info.VolumeReadOnly===true||info.ReadOnlyMedia===true||
    info.WriteProtected===true||info.Writable===false||
    info.MediaWritable===false;
  const explicitlyWritable=info.ReadOnlyVolume===false||
    info.VolumeReadOnly===false||info.Writable===true||
    info.MediaWritable===true;
  const code=explicitlyReadOnly||mountReadOnly?'READ_ONLY':
    !mountObserved?'MOUNT_NOT_FOUND':
      !userWritable?'USER_WRITE_PERMISSION_NOT_CONFIRMED':
        'MOUNT_RW_PERMISSION_OK_NO_WRITE_PERFORMED';
  return {code,readOnlyFields:readableFields,
    mountedEntryFound:mountObserved,mountReadOnly,
    userWritablePermission:userWritable,
    metadataExplicitWritable:explicitlyWritable,
    verifiedWriteOperation:false,
    originalPreflightWasConservative:
      !explicitlyWritable&&!explicitlyReadOnly&&mountObserved};
}
export function summarizeLegacy({candidatePath=LEGACY_CHECKOUT,
  activePath=currentSource, stat=optionalLstat,
  links=realpath, names,gitCandidate,gitActive,bindSources=[]}={}){
  const observed=stat(candidatePath);
  const live=stat(activePath);
  const sameRealPath=Boolean(observed&&live&&
    links(candidatePath)===links(activePath));
  const dockerUsesCandidate=bindSources.some(src=>
    src===candidatePath||src.startsWith(candidatePath+'/')||
    (links(src)&&links(candidatePath)&&
      (links(src)===links(candidatePath)||
       links(src).startsWith(links(candidatePath)+'/'))));
  const candidateExists=Boolean(observed);
  const isDirectory=Boolean(observed?.isDirectory());
  const isSymlink=Boolean(observed?.isSymbolicLink());
  const kinds=Array.isArray(names)?names:[];
  const observedKnownNames=['AGENTS.md','Dockerfile','compose.yaml','docker-compose.yml',
    '.env','.git','node_modules','scripts','src','data','workspaces',
    'shared-auth','docs','packages','backups','package.json','README.md']
    .filter(n=>kinds.includes(n));
  return {
    candidatePath,exists:candidateExists,isDirectory,isSymlink,
    modificationTime:observed?.mtime?.toISOString?.()??null,
    topLevelEntryCount: candidateExists&&Array.isArray(names)?names.length:null,
    knownProjectMarkers:observedKnownNames,
    activeMacControllerCheckout:activePath,
    activeMacCheckoutExists:Boolean(live),
    sameRealPathAsLive:sameRealPath,
    anyDockerBindUnderCandidate:dockerUsesCandidate,
    gitCandidate,gitActive,
    gitHeadsMatch:Boolean(gitCandidate?.head&&
      gitCandidate.head===gitActive?.head),
    safeToDelete:false,
    recommendedAction:candidateExists?
      sameRealPath||dockerUsesCandidate?
        'LIVE_REFERENCE_DO_NOT_DELETE':
        'ARCHIVE_UNTIL_FULL_DIFF_BACKUP_AND_FINAL_CUTOVER':
      'NOT_PRESENT_NOTHING_TO_DELETE'
  };
}
function gitSummary(location){
  if(!optionalLstat(location)?.isDirectory())return {isRepo:false};
  const result=run('/usr/bin/git',['-C',location,'rev-parse','--verify','HEAD'],
    {timeout:8000});
  if(!result.ok)return {isRepo:false};
  const head=result.stdout.trim();
  return {isRepo:/^[a-f0-9]{40,64}$/.test(head),
    head:/^[a-f0-9]{40,64}$/.test(head)?head:null,
    trackedDirtyState:'NOT_CHECKED',
    untrackedFiles:'NOT_CHECKED'};
}
function readPlist(){
  const raw=run('/usr/sbin/diskutil',
    ['info','-plist',EXISTING_SSD],{timeout:9000});
  if(!raw.ok)throw Error('SSD_DISKUTIL_INFO_NOT_AVAILABLE');
  const json=run('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{input:raw.stdout,timeout:7000});
  if(!json.ok)throw Error('SSD_INFO_PLIST_CONVERSION_FAILED');
  let info;
  try{info=JSON.parse(json.stdout);}catch{
    throw Error('SSD_DISKUTIL_INFO_JSON_INVALID');
  }
  return info;
}
function dockerObservations(){
  const status=run('docker',['inspect',controllerName,workstationName],
    {timeout:15000});
  if(!status.ok)return {available:false,
    reason:'MAC_DOCKER_INSPECT_UNAVAILABLE',bindSources:[]};
  try{
    const containers=JSON.parse(status.stdout);
    const active=containers.find(c=>c.Name==='/'+controllerName);
    const agent=containers.find(c=>c.Name==='/'+workstationName);
    const sources=containers.flatMap(c=>c.Mounts??[])
      .filter(m=>m.Type==='bind'&&typeof m.Source==='string')
      .map(m=>m.Source);
    return {available:true,foundBoth:Boolean(active&&agent),
      composeDirectory:active?.Config?.Labels?.[
        'com.docker.compose.project.working_dir']??null,
      bindSources:sources};
  }catch{return {available:false,reason:'DOCKER_INSPECT_JSON_UNREADABLE',
    bindSources:[]};}
}
function verifyRelease(){
  const manifest=fs.readFileSync(path.join(here,'manifest.json'));
  const digest=fs.readFileSync(path.join(here,'manifest.sha256'),'utf8').trim();
  if(sha(manifest)!==digest)throw Error('RECONCILE_RELEASE_SHA256_MISMATCH');
  const data=JSON.parse(manifest.toString('utf8'));
  if(data.schema!=='sandbox-v3.ssd-reconcile-release.v1')
    throw Error('RECONCILE_RELEASE_SCHEMA_INVALID');
  for(const [name,expected] of Object.entries(data.files_sha256)){
    if(!/^[A-Za-z][A-Za-z0-9.-]+\.(?:mjs|md)$/.test(name))
      throw Error('RECONCILE_RELEASE_FILE_INVALID');
    const loc=path.join(here,name);
    const stat=fs.lstatSync(loc);
    if(!stat.isFile()||stat.isSymbolicLink()||
       sha(fs.readFileSync(loc))!==expected)
      throw Error('RECONCILE_RELEASE_CONTENT_HASH_INVALID');
  }
}
function writeEvidence(output){
  const p=path.join(here,'last-mac-reconcile.json');
  const tmp=path.join(here,'.mac-reconcile-'+process.pid+'-'+
    crypto.randomUUID()+'.tmp');
  try{
    fs.writeFileSync(tmp,JSON.stringify(output,null,2)+'\n',
      {flag:'wx',mode:0o600});
    fs.renameSync(tmp,p);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  return p;
}
function collect(){
  const info=readPlist();
  const uuid=String(info.VolumeUUID||'').toUpperCase();
  const apfs=/(^|[^A-Z])APFS([^A-Z]|$)/i.test(String(info.FileSystemPersonality||'')+' '+
    String(info.FilesystemType||''));
  const identityValid=uuid===PINNED_EXISTING_VOLUME_UUID&&
    info.Internal===false&&info.MountPoint===EXISTING_SSD&&apfs;
  const mount=run('/sbin/mount',[],{timeout:7000});
  let writable=false;
  try{fs.accessSync(EXISTING_SSD,fs.constants.W_OK);writable=true;}
  catch{/* Read-only check: never create a file. */}
  const access=classifyVolumeAccess({info,
    mountOutput:mount.stdout,userWritable:writable});
  const oldStat=optionalLstat(LEGACY_CHECKOUT);
  let names=null;
  if(oldStat?.isDirectory()&&!oldStat.isSymbolicLink()){
    const list=fs.readdirSync(LEGACY_CHECKOUT);
    names=list.length<=20000?list:null;
  }
  const docker=dockerObservations();
  const legacy=summarizeLegacy({names,gitCandidate:gitSummary(LEGACY_CHECKOUT),
    gitActive:gitSummary(docker.composeDirectory||currentSource),
    activePath:docker.composeDirectory||currentSource,
    bindSources:docker.bindSources});
  const encrypted=info.Encrypted===true||
    info.APFSVolumeEncrypted===true||info.EncryptionEnabled===true;
  const encryption=encrypted?'CONFIRMED':'NOT_CONFIRMED';
  const targetState=optionalLstat(PREFERRED_VOLUME);
  const result={
    schema:'sandbox-v3.ssd-legacy-reconciliation.v1',
    generatedAt:new Date().toISOString(),
    operation:'READ_ONLY_EXCEPT_SMALL_REPORT_ON_MAC',
    existingSsd:{mount:EXISTING_SSD,uuid,apfs,external:info.Internal===false,
      identityValid,encryption,access},
    sourceOfPreviousFailure:'ReadOnlyVolume key absent can be reported as false by original preflight; this diagnostic distinguishes unknown from real read-only',
    legacyCheckout:legacy,
    desiredStableNaming:{
      root:'Sandbox',mount:PREFERRED_VOLUME,
      model:'NEW_SEPARATE_APFS_ENCRYPTED_VOLUME_SAME_CONTAINER',
      mustNotCreateAutomatically:true,
      versionedNamesInPersistentPaths:false,
      sourceCheckout:VERSION_FREE_CHECKOUT,
      oldFolderRemainUntouched:true,
      existingSsdFilesRemainUntouched:true,
      nextVersion:'SAME_STORAGE_PATH_FOR_V4'
    },
    preferredVolumeAlreadyExists:Boolean(targetState),
    macDocker:{available:docker.available,
      foundBoth:docker.foundBoth??false,
      composeDirectory:docker.composeDirectory??null,
      bindSourceCount:docker.bindSources.length},
    decisions:{
      legacyDeletion:'BLOCKED_UNTIL_FULL_HASH_COMPARE_AND_ACCEPTED_BACKUP',
      migration:'NOT_EXECUTED',
      newEncryptedVolumeCreation:'NOT_EXECUTED',
      filesystemWritesToToshiba:0,
      encryptedVolumePreferred:true,
      nextGate:identityValid?'COMPLETE_READONLY_REVIEW':'SSD_IDENTITY_MISMATCH'
    }
  };
  return result;
}
function main(){
  if(process.platform!=='darwin')throw Error('MACOS_HOST_ONLY');
  if(process.argv.length!==3||process.argv[2]!=='--inspect')
    throw Error('USE_NODE_RECONCILE_ON_MAC_MJS_INSPECT');
  verifyRelease();
  const result=collect();
  const file=writeEvidence(result);
  console.log(JSON.stringify(result,null,2));
  console.log('[SSD Reconcile] EVIDENCE='+file);
  console.log('[SSD Reconcile] SSD_FILES_CHANGED=NO');
  if(!result.existingSsd.identityValid)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){
    console.error('[SSD Reconcile] STOP='+String(error?.message||'UNKNOWN').slice(0,120));
    process.exitCode=2;
  }
}
