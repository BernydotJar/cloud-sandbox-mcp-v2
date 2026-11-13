#!/usr/bin/env node
/**
 * Read-only Mac host viability and isolation identity.
 * No VM creation, network downloads, Remote Debugging, permissions
 * modification, credential access, or interactive desktop operations.
 */
import process from 'node:process';
import fs from 'node:fs';
import console from 'node:console';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {platformUuidFromIoreg,machineDigest,capacityStatus} from './identity.mjs';

const print=(k,v)=>console.log('[Mac Background CUA] '+k+'='+String(v));
function exec(bin,args,timeout=8000){
  return execFileSync(bin,args,{encoding:'utf8',timeout,
    stdio:['ignore','pipe','pipe'],maxBuffer:32768}).trim();
}
function optional(bin,args){
  try{return exec(bin,args);}catch{return 'UNAVAILABLE';}
}
export function parseDf(output) {
  const row=String(output).trim().split(/\r?\n/).at(-1).trim().split(/\s+/);
  if(row.length<5||!/^\d+$/.test(row[3])||!/^\d+%$/.test(row[4]))
    throw Error('INVALID_DF_CAPACITY');
  return {freeGiB:Number((Number(row[3])/1048576).toFixed(2)),
    usedPercent:Number(row[4].slice(0,-1))};
}
export function isExternalAPFS(diskutilText){
  const data=String(diskutilText);
  const external=/^\s*Device Location:\s*External\b/im.test(data);
  const apfs=/^\s*File System Personality:\s*APFS\b/im.test(data);
  const readOnly=/^\s*Read-Only Volume:\s*Yes\b/im.test(data);
  return external && apfs && !readOnly;
}
function externalVMVolumes() {
  const prefix='/Volumes';
  if(!fs.existsSync(prefix))return [];
  const items=fs.readdirSync(prefix,{withFileTypes:true});
  const candidates=[];
  for(const item of items.slice(0,24)){
    if(!item.isDirectory()||item.isSymbolicLink())continue;
    const mount=path.join(prefix,item.name);
    const info=optional('/usr/sbin/diskutil',['info',mount]);
    if(info==='UNAVAILABLE'||!isExternalAPFS(info))continue;
    try{
      fs.accessSync(mount,fs.constants.W_OK);
      const disk=parseDf(exec('/bin/df',['-Pk',mount]));
      candidates.push({mount,freeGiB:disk.freeGiB,eligible:disk.freeGiB>=80});
    }catch{/* Ignore unmounted/unreadable volumes. */}
  }
  return candidates;
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--inspect')
    throw Error('READ_ONLY_MODE_ONLY');
  if(process.platform!=='darwin'){
    print('RESULT','MAC_HOST_REQUIRED_FOR_RUNTIME');
    print('NO_MAC_ACTIONS','YES');return;
  }
  const version=exec('/usr/bin/sw_vers',['-productVersion']);
  const arch=exec('/usr/bin/uname',['-m']);
  const hv=optional('/usr/sbin/sysctl',['-n','kern.hv_support']);
  const memBytes=Number(exec('/usr/sbin/sysctl',['-n','hw.memsize']));
  const disk=parseDf(exec('/bin/df',['-Pk',process.env.HOME]));
  const uuid=platformUuidFromIoreg(
    exec('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice']));
  print('MACOS',version);
  print('ARCH',arch);
  print('HYPERVISOR',hv==='1'?'SUPPORTED':'UNAVAILABLE');
  print('RAM_GIB',(memBytes/1073741824).toFixed(1));
  print('HOME_DISK_FREE_GIB',disk.freeGiB);
  print('HOME_DISK_USED_PERCENT',disk.usedPercent);
  print('HOME_DISK_80GIB_SHORTFALL',Number(Math.max(0,80-disk.freeGiB).toFixed(2)));
  print('OPERATOR_MACHINE_DIGEST',machineDigest(uuid));
  const result=capacityStatus({arm64:arch==='arm64',virtualization:hv==='1',
    availableGiB:disk.freeGiB,ramGiB:memBytes/1073741824});
  print('LOCAL_MAC_VM',result.vmEligible?'ELIGIBLE_PREFLIGHT':'NOT_READY');
  print('LOCAL_MAC_VM_REASON',result.reason);
  const candidates=externalVMVolumes();
  print('EXTERNAL_APFS_VOLUMES',candidates.length);
  for(const item of candidates){
    print('EXTERNAL_VM_VOLUME',item.mount);
    print('EXTERNAL_VM_VOLUME_FREE_GIB',item.freeGiB);
    print('EXTERNAL_VM_VOLUME_80GIB_READY',item.eligible?'YES':'NO');
  }
  print('EXTERNAL_VM_STORAGE_CANDIDATE',
    candidates.some(item=>item.eligible)?'FOUND_NOT_PROVISIONED':'NOT_FOUND');
  const tart=optional('/usr/bin/which',['tart']);
  print('TART_INSTALLED',tart==='UNAVAILABLE'?'NO':'YES');
  if(tart!=='UNAVAILABLE'){
    const available=optional(tart,['list','--format','json']);
    if(available.startsWith('[')){
      try{
        const list=JSON.parse(available);
        print('EXISTING_VM_COUNT',Array.isArray(list)?list.length:'UNVERIFIED');
      }catch{print('EXISTING_VM_COUNT','UNVERIFIED');}
    }
  }
  print('BROWSER_DEBUGGING_CHANGED','NO');
  print('MAC_FOREGROUND_TOUCHED','NO');
  print('GUEST_WORKER_CONNECTED','NOT_PROBED');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(error){print('STOP',String(error?.message||'UNKNOWN').slice(0,150));process.exitCode=2;}
}
