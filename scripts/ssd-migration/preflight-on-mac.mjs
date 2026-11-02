#!/usr/bin/env node
/**
 * Toshiba SSD / Sandbox V3 migration - Mac-only, observation-only gate.
 *
 * Never moves data, edits Docker settings, restarts a service, changes
 * permissions, deletes files or invokes a privileged command.
 * Writes only a small sanitized diagnostic in its own handoff folder.
 */
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const VOLUME='/Volumes/SSD';
export const DESTINATION='/Volumes/SSD/Sandbox';
export const EXPECTED_CONTAINERS=Object.freeze([
  'cloud-sandbox-mcp','cloud-sandbox-dev-main'
]);
const rootsToInspect=['workspaces','shared-auth'];
const mountAllowlist=new Set([
  '/data','/workspace','/home/agent','/shared-auth','/var/lib/docker'
]);
const here=path.dirname(fileURLToPath(import.meta.url));
const asGiB=value=>value==null?null:Math.round(value/(1024**3)*100)/100;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const isMissing=e=>e&&e.code==='ENOENT';

function run(exe,args,opts={}){
  const r=spawnSync(exe,args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],
    maxBuffer:3_000_000,timeout:opts.timeout??12000,input:opts.input});
  return {ok:r.status===0&&!r.error,stdout:r.stdout??'',
    code:r.status,error:r.error?.code??null};
}
function optionalLstat(location){
  try{return fs.lstatSync(location);}catch(error){
    if(isMissing(error))return null;throw error;
  }
}
export function filesystemSummary({statfs,location}){
  if(!statfs)return {availableGiB:null,totalGiB:null};
  const stat=statfs(location);
  const block=Number(stat.bsize||stat.frsize);
  const total=block*Number(stat.blocks);
  const free=block*Number(stat.bavail);
  if(!Number.isFinite(total)||total<=0||!Number.isFinite(free)||free<0)
    return {availableGiB:null,totalGiB:null};
  return {availableGiB:asGiB(free),totalGiB:asGiB(total),
    usedPercent:Math.round((1-free/total)*100)};
}
export function classifyDiskutil(info={},mountedAt=VOLUME){
  const fsLabel=[info.FilesystemType,info.FileSystemPersonality,
    info.Content,info.Type,info.APFSContainerReference?'APFS':null]
    .filter(Boolean).join(' ');
  const fileSystem=/APFS/i.test(fsLabel)?'APFS':
    fsLabel?'OTHER':'UNKNOWN';
  const mountedCorrectly=info.MountPoint===mountedAt;
  const external=info.Internal===false;
  const readWrite=(info.Writable===true||
    info.ReadOnlyVolume===false||info.VolumeReadOnly===false) &&
    info.ReadOnlyVolume!==true&&info.VolumeReadOnly!==true&&
    info.ReadOnlyMedia!==true&&info.WriteProtected!==true;
  const uuid=String(info.VolumeUUID||'');
  const encryptionFlags=[info.Encrypted,info.APFSVolumeEncrypted,
    info.FileVault,info.EncryptionEnabled];
  const encrypted=encryptionFlags.some(value=>
    value===true||String(value).toLowerCase()==='yes');
  const explicitUnencrypted=encryptionFlags.some(value=>
    value===false||String(value).toLowerCase()==='no');
  const encryption=encrypted?'CONFIRMED':
    explicitUnencrypted?'NOT_ENCRYPTED':'NOT_VERIFIED';
  return {fileSystem,external,readWrite,mountedCorrectly,encryption,
    uuid:/^[0-9A-Fa-f-]{36}$/.test(uuid)?uuid.toUpperCase():null,
    volumeName:String(info.VolumeName||''),device:String(info.DeviceIdentifier||''),
    valid: fileSystem==='APFS'&&external&&readWrite&&mountedCorrectly&&
      /^[0-9A-Fa-f-]{36}$/.test(uuid)};
}
function diskInfo(diskRun=run){
  const plist=diskRun('/usr/sbin/diskutil',['info','-plist',VOLUME]);
  if(!plist.ok)return {valid:false,reason:'DISKUTIL_VOLUME_NOT_AVAILABLE'};
  const converted=diskRun('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{input:plist.stdout});
  if(!converted.ok)return {valid:false,reason:'DISKUTIL_PLIST_CANNOT_CONVERT'};
  try{return classifyDiskutil(JSON.parse(converted.stdout));}
  catch{return {valid:false,reason:'DISKUTIL_PLIST_NOT_JSON'};}
}
export function selectMounts(objects=[]){
  if(!Array.isArray(objects))throw Error('INVALID_DOCKER_INSPECT_RESPONSE');
  const summaries=[];
  for(const name of EXPECTED_CONTAINERS){
    const c=objects.find(item=>item.Name==='/'+name);
    if(!c){summaries.push({name,found:false,running:false,mounts:[]});continue;}
    const mounts=(Array.isArray(c.Mounts)?c.Mounts:[])
      .filter(m=>m.Type==='bind'&&mountAllowlist.has(m.Destination))
      .map(m=>({destination:m.Destination,source:m.Source,
        readWrite:m.RW!==false}))
      .sort((a,b)=>a.destination.localeCompare(b.destination));
    const labels=c.Config?.Labels||{};
    const composeDirectory=labels['com.docker.compose.project.working_dir']||null;
    summaries.push({name,found:true,running:c.State?.Running===true,
      mounts,composeDirectory});
  }
  return summaries;
}
function inspectDocker(diskRun=run){
  const response=diskRun('docker',['inspect',...EXPECTED_CONTAINERS],
    {timeout:20000});
  if(!response.ok){
    return {available:false,reason:'MAC_DOCKER_INSPECT_UNAVAILABLE',
      containers:EXPECTED_CONTAINERS.map(name=>({name,found:false}))};
  }
  try{
    const containers=selectMounts(JSON.parse(response.stdout));
    return {available:true,
      containers,
      foundBoth:containers.every(item=>item.found),
      bothRunning:containers.every(item=>item.running),
      bindPathsOnSSD:containers.flatMap(item=>item.mounts)
        .filter(m=>m.source===DESTINATION||m.source.startsWith(DESTINATION+'/')).length};
  }catch{
    return {available:false,reason:'DOCKER_INSPECT_JSON_INVALID',containers:[]};
  }
}
function macDataInfo(home){
  const root=path.join(home,'.cloud-sandbox-mcp-data');
  const stat=optionalLstat(root);
  const exists=Boolean(stat);
  const result={path:root,exists,isSymlink:Boolean(stat?.isSymbolicLink()),
    subdirectories:[]};
  for(const name of rootsToInspect){
    const source=path.join(root,name);
    const meta=optionalLstat(source);
    result.subdirectories.push({name,exists:Boolean(meta),
      isSymlink:Boolean(meta?.isSymbolicLink())});
  }
  return result;
}
function dockerDiskSummary(home){
  const defaultPath=path.join(home,
    'Library/Containers/com.docker.docker/Data/vms/0/data');
  const variants=['Docker.raw','Docker.qcow2'];
  const known=variants.flatMap(name=>{
    const location=path.join(defaultPath,name);
    const info=optionalLstat(location);
    return info?.isFile()?[{
      path:location,logicalGiB:asGiB(info.size),
      allocatedGiB:asGiB(info.blocks*512),
      isSymlink:info.isSymbolicLink()
    }]:[];
  });
  const settings=path.join(home,
    'Library/Group Containers/group.com.docker/settings-store.json');
  let configuredDiskImageLocation=null;
  try{
    const stat=optionalLstat(settings);
    if(stat?.isFile()&&!stat.isSymbolicLink()&&stat.size<6_000_000){
      const data=JSON.parse(fs.readFileSync(settings,'utf8'));
      const value=data.diskImageLocation??data.diskImagePath??null;
      if(typeof value==='string'&&path.isAbsolute(value))
        configuredDiskImageLocation=value;
    }
  }catch{/* Docker settings are optional: use the UI to confirm. */}
  return {defaultImageFiles:known,configuredDiskImageLocation,
    requiresDockerDesktopSettingsUI:true};
}
function evidencePath(){return path.join(here,'last-mac-preflight.json');}
function atomicEvidence(file,data){
  // A single authorized evidence write. Do not overwrite SSD directories
  // or transfer any data. The handoff already exists in shared-auth.
  const temp=path.join(path.dirname(file),
    '.mac-preflight-'+process.pid+'-'+crypto.randomUUID()+'.tmp');
  try{
    fs.writeFileSync(temp,data,{mode:0o600,flag:'wx'});
    fs.renameSync(temp,file);
  }finally{
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
}
export function buildReport({mac,ssd,internal,source,docker,image,
  destinationState,previousDataMarkers}){
  const checks=[
    {id:'MAC_HOST',status:mac?'PASS':'FAIL'},
    {id:'SSD_APFS_EXTERNAL_UUID',status:ssd.valid?'PASS':'FAIL'},
    {id:'SSD_FREE_500_GIB',status:
      ssd.availableGiB!=null&&ssd.availableGiB>=500?'PASS':'FAIL'},
    {id:'SSD_SECRET_STORAGE_ENCRYPTION_OPTIONAL',status:'ADVISORY'},
    {id:'SOURCE_DATA_EXISTS',status:source.exists?'PASS':'FAIL'},
    {id:'SOURCE_ROOT_SYMLINK',status:
      source.isSymlink?'REVIEW_REQUIRED':'PASS'},
    {id:'SOURCE_CHILD_SYMLINKS',status:
      source.subdirectories.some(x=>x.isSymlink)?'REVIEW_REQUIRED':'PASS'},
    {id:'SOURCE_WORKSPACES',status:
      source.subdirectories.some(x=>x.name==='workspaces'&&x.exists)?'PASS':'FAIL'},
    {id:'SOURCE_SHARED_AUTH',status:
      source.subdirectories.some(x=>x.name==='shared-auth'&&x.exists)?'PASS':'FAIL'},
    {id:'MAC_DOCKER_INSPECT',status:docker.available&&docker.foundBoth?'PASS':'FAIL'},
    {id:'ALREADY_SSD_BOUND',status:
      docker.bindPathsOnSSD>0?'REVIEW_REQUIRED':'PASS'},
    {id:'TARGET_COLLISION',status:
      destinationState==='ABSENT'?'PASS':'REVIEW_REQUIRED'},
    {id:'DOCKER_DISK_IMAGE_LOCATION',status:'MANUAL_UI_REVIEW'}
  ];
  return {schema:'sandbox-v3.external-ssd-preflight.v1',
    generatedAt:new Date().toISOString(),
    action:'READ_ONLY_INSPECTION_NO_MIGRATION',
    destination:DESTINATION,
    ssd,internal,source,docker,image,
    destinationState,previousDataMarkers,checks,
    readiness:checks.some(x=>x.status==='FAIL')?'BLOCKED':
      checks.some(x=>x.status==='REVIEW_REQUIRED')?
        'MANUAL_REVIEW_REQUIRED':'PREPARED_NEEDS_CUTOVER',
    guaranteedNoDataMove:true,guaranteedNoDelete:true,
    guidance:'MOVE_DOCKER_DISK_VIA_DOCKER_DESKTOP_SETTINGS_NOT_FINDER',
    migrationExecuted:false};
}
function verifyRelease(){
  const manifest=path.join(here,'manifest.json');
  const digest=path.join(here,'manifest.sha256');
  if(!fs.existsSync(manifest)||!fs.existsSync(digest))
    throw Error('SSD_RELEASE_MANIFEST_MISSING');
  const bytes=fs.readFileSync(manifest);
  if(sha(bytes)!==fs.readFileSync(digest,'utf8').trim())
    throw Error('SSD_RELEASE_MANIFEST_HASH_INVALID');
  const data=JSON.parse(bytes.toString('utf8'));
  if(!['sandbox-v3.ssd-preflight-release.v1',
    'sandbox-v3.ssd-stage-release.v1'].includes(data.schema))
    throw Error('SSD_RELEASE_SCHEMA_INVALID');
  for(const [name,expected] of Object.entries(data.files_sha256||{})){
    if(!/^[A-Za-z][A-Za-z0-9.-]+\.(?:mjs|md)$/.test(name))
      throw Error('SSD_RELEASE_FILENAME_INVALID');
    const item=path.join(here,name);
    const stat=fs.lstatSync(item);
    if(!stat.isFile()||stat.isSymbolicLink()||
       sha(fs.readFileSync(item))!==expected)
      throw Error('SSD_RELEASE_FILE_HASH_INVALID:'+name);
  }
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--inspect')
    throw Error('USAGE_NODE_PREFLIGHT_ON_MAC_MJS_INSPECT');
  if(process.platform!=='darwin')throw Error('MACOS_HOST_ONLY');
  verifyRelease();
  const home=os.homedir();
  const disk=diskInfo();
  let capacity={availableGiB:null,totalGiB:null};
  let internal={availableGiB:null,totalGiB:null};
  try{if(fs.statSync(VOLUME).isDirectory())
    capacity=filesystemSummary({statfs:fs.statfsSync,location:VOLUME});}
  catch{/* Disk absent or no longer mounted. */ }
  try{internal=filesystemSummary({statfs:fs.statfsSync,location:home});}
  catch{/* Report incomplete, no mutation. */}
  const target=optionalLstat(DESTINATION);
  const destinationState=!target?'ABSENT':
    target.isSymbolicLink()?'SYMLINK_UNTRUSTED':
      target.isDirectory()?'EXISTS_REQUIRES_INVENTORY':'EXISTS_NOT_DIRECTORY';
  const source=macDataInfo(home);
  const docker=inspectDocker();
  const image=dockerDiskSummary(home);
  const previousDataMarkers=['Documents','Downloads','Development','MacStorage']
    .filter(name=>Boolean(optionalLstat(path.join(VOLUME,name))));
  const report=buildReport({mac:true,ssd:{...disk,...capacity},
    internal,source,docker,image,destinationState,previousDataMarkers});
  const json=JSON.stringify(report,null,2)+'\n';
  atomicEvidence(evidencePath(),json);
  console.log(json.trimEnd());
  console.log('[SSD Preflight] EVIDENCE='+evidencePath());
  console.log('[SSD Preflight] READ_ONLY=YES; MIGRATION_EXECUTED=NO');
  if(report.readiness==='BLOCKED')process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    console.error('[SSD Preflight] STOP='+String(error?.message||'UNEXPECTED_ERROR'));
    process.exitCode=2;
  });
}
