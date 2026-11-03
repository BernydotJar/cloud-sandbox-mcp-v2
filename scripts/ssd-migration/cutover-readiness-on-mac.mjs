#!/usr/bin/env node
/**
 * Mac read-only assessment after successful Toshiba SSD live staging.
 * Does NOT stop services, sync data, change mounts, move Docker.raw,
 * modify files, remove data, or authorize migration cutover.
 */
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const MAC_VOLUME='/Volumes/SSD';
export const MAC_UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
export const TARGET='/Volumes/SSD/Sandbox';
export const REL_WORKSPACE='workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
const HOME=os.homedir();
const SOURCE=path.join(HOME,'.cloud-sandbox-mcp-data');
const CODE=path.join(HOME,'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const DATA=TARGET+'/persistent/cloud-sandbox-mcp-data';
const CODE_COPY=TARGET+'/source/cloud-sandbox-workstation';

export function checkedStage(marker,receipt){
  if(marker?.schema!=='sandbox-v3.toshiba-stage.v1'||
    marker.volumeUuid!==MAC_UUID||
    marker.externalVolume!==MAC_VOLUME||
    marker.targetRoot!==TARGET||
    marker.dataSource!==SOURCE||
    marker.controllerSource!==CODE||
    marker.sourceDeleted!==false||
    marker.canCutover!==false)
    throw Error('STAGING_MARKER_MISMATCH');
  if(receipt?.operation!=='LIVE_STAGING_COPY_COMPLETED'||
    receipt.volumeUuid!==MAC_UUID||
    receipt.sourcePathsPreserved!==true||
    receipt.migrationCutoverExecuted!==false||
    receipt.dockerBindMountsRetargeted!==false||
    !Array.isArray(receipt.components)||
    receipt.components.length!==2||
    receipt.components.some(c=>c.status!=='STAGED_NON_AUTHORITATIVE'||
      c.exitCode!==0)||
    !['controller','persistent'].every(name=>
      receipt.components.some(x=>x.component===name)))
    throw Error('SUCCESSFUL_STAGING_RECEIPT_MISSING');
  // No signed stage receipt overrides the unverified live-snapshot caveat.
  if(receipt.activeDataMayHaveChangedDuringCopy!==true||
    receipt.requireColdFinalSync!==true||
    receipt.requireStrongVerification!==true||
    receipt.initialPersistentCopyXattrsFullyPreserved!==false||
    receipt.xattrAndAclParityVerificationPending!==true)
    throw Error('STAGING_SAFETY_GATES_MISSING');
  return true;
}
export function checkOldMounts(containers,root=SOURCE,code=CODE){
  const required={
    'cloud-sandbox-mcp':{'/data':root},
    'cloud-sandbox-dev-main':{
      '/workspace':root+'/'+REL_WORKSPACE+'/repo',
      '/home/agent':root+'/'+REL_WORKSPACE+'/home',
      '/shared-auth':root+'/shared-auth',
      '/var/lib/docker':root+'/'+REL_WORKSPACE+'/docker'
    }
  };
  if(!Array.isArray(containers)||containers.length!==2)
    throw Error('DOCKER_INSPECT_UNEXPECTED');
  for(const [name,bindings] of Object.entries(required)){
    const c=containers.find(v=>v.Name==='/'+name);
    if(!c||c.State?.Running!==true)
      throw Error('ACTIVE_CONTAINER_MISSING:'+name);
    for(const [dest,source] of Object.entries(bindings)){
      if(!(c.Mounts||[]).some(m=>m.Type==='bind'&&
        m.Destination===dest&&m.Source===source))
        throw Error('OLD_BIND_SOURCE_CHANGED:'+name+':'+dest);
    }
  }
  const ctl=containers.find(v=>v.Name==='/cloud-sandbox-mcp');
  if(ctl.Config?.Labels?.['com.docker.compose.project.working_dir']!==code)
    throw Error('WRONG_COMPOSE_CHECKOUT');
  return true;
}
function run(exe,args){
  const r=spawnSync(exe,args,{encoding:'utf8',timeout:30000,
    maxBuffer:4_000_000});
  if(r.status!==0||r.error)
    throw Error('READ_ONLY_INSPECT_COMMAND_FAILED:'+path.basename(exe));
  return r.stdout;
}
function safeDir(loc,{ownerOnly=false}={}){
  const st=fs.lstatSync(loc);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())
    throw Error('DIRECTORY_OWNER_OR_TYPE_UNEXPECTED:'+path.basename(loc));
  if(ownerOnly&&(st.mode&0o077)!==0)
    throw Error('STAGE_PARENT_NOT_PRIVATE:'+path.basename(loc));
}
function jsonFile(loc){
  const st=fs.lstatSync(loc);
  if(!st.isFile()||st.isSymbolicLink()||st.size>120000)
    throw Error('RECEIPT_NOT_REGULAR_FILE');
  return JSON.parse(fs.readFileSync(loc,'utf8'));
}
// plutil needs the diskutil plist on stdin; don't rely on shell pipelines.
function diskInfo(){
  const info=spawnSync('/usr/sbin/diskutil',
    ['info','-plist',MAC_VOLUME],{encoding:'utf8',timeout:10000});
  if(info.status!==0||info.error)
    throw Error('DISKUTIL_UNAVAILABLE');
  const decoded=spawnSync('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{
      encoding:'utf8',input:info.stdout,timeout:10000
    });
  if(decoded.status!==0||decoded.error)
    throw Error('SSD_DISK_INFO_UNREADABLE');
  return JSON.parse(decoded.stdout);
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--inspect')
    throw Error('READ_ONLY_INSPECT_FLAG_REQUIRED');
  if(process.platform!=='darwin')
    throw Error('MACOS_HOST_REQUIRED');
  const disk=diskInfo();
  if(disk.VolumeUUID!==MAC_UUID||
    disk.MountPoint!==MAC_VOLUME||
    disk.Internal!==false||
    disk.FileSystemPersonality!=='APFS'||
    disk.Writable!==true)
    throw Error('SSD_IDENTITY_OR_RW_MISMATCH');
  safeDir(TARGET,{ownerOnly:true});
  safeDir(TARGET+'/source',{ownerOnly:true});
  safeDir(TARGET+'/persistent',{ownerOnly:true});
  safeDir(TARGET+'/reports',{ownerOnly:true});
  safeDir(CODE_COPY);
  safeDir(DATA);
  safeDir(SOURCE);
  safeDir(CODE);
  for(const rel of ['shared-auth',REL_WORKSPACE]){
    if(!fs.statSync(path.join(SOURCE,rel)).isDirectory()||
      !fs.statSync(path.join(DATA,rel)).isDirectory())
      throw Error('MISSING_STAGED_DATA_COMPONENT:'+rel);
  }
  const marker=jsonFile(TARGET+'/.sandbox-v3-stage.json');
  const receipt=jsonFile(TARGET+'/reports/staging-receipt.json');
  checkedStage(marker,receipt);
  if(!fs.existsSync(path.join(CODE_COPY,'compose.yaml')))
    throw Error('COMPOSE_CODE_MISSING_IN_STAGING');
  const env=fs.readFileSync(path.join(CODE,'.env'),'utf8');
  const variable=env.split(/\r?\n/).find(x=>/^\s*HOST_DATA_DIR\s*=/.test(x));
  if(!variable)throw Error('ACTIVE_ENV_HOST_DATA_DIR_UNSET');
  const value=variable.replace(/^\s*HOST_DATA_DIR\s*=\s*/,'')
    .trim().replace(/^(['"])(.*)\1$/,'$2');
  if(value!==SOURCE)throw Error('ACTIVE_ENV_DATA_ROOT_NOT_EXPECTED');
  const containers=JSON.parse(run('docker',
    ['inspect','cloud-sandbox-mcp','cloud-sandbox-dev-main']));
  checkOldMounts(containers);
  console.log('[SSD Cutover Inspect] DISK_UUID=PASS');
  console.log('[SSD Cutover Inspect] STAGING_RECEIPT=PASS');
  console.log('[SSD Cutover Inspect] ORIGINAL_MAC_DATA=PRESENT');
  console.log('[SSD Cutover Inspect] STAGED_CODE_AND_DATA=PRESENT');
  console.log('[SSD Cutover Inspect] CURRENT_DOCKER_BINDS=INTERNAL_MAC_CONFIRMED');
  console.log('[SSD Cutover Inspect] CONTROLLER_ENV=INTERNAL_MAC_CONFIRMED');
  console.log('[SSD Cutover Inspect] PERSISTENT_XATTR_ACL_PARITY=NOT_YET_VERIFIED');
  console.log('[SSD Cutover Inspect] DOWNTIME_STARTED=NO');
  console.log('[SSD Cutover Inspect] COLD_FINAL_SYNC=REQUIRED');
  console.log('[SSD Cutover Inspect] DOCKER_DESKTOP_DISK_GUI_MOVE=REQUIRED');
  console.log('[SSD Cutover Inspect] SSD_UUID_GUARDED_STARTUP=REQUIRED');
  console.log('[SSD Cutover Inspect] SAFE_TO_DELETE_MAC_ORIGINAL=NO');
  console.log('[SSD Cutover Inspect] RESULT=READ_ONLY_READY_FOR_CUTOVER_PLANNING');
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  try{main();}
  catch(e){
    console.error('[SSD Cutover Inspect] STOP='+e.message);
    process.exitCode=2;
  }
}
