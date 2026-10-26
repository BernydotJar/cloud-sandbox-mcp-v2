#!/usr/bin/env node
/**
 * Zero-mutation workstation disk headroom monitor. Measure the filesystem
 * shared by /workspace and /shared-auth once, without deleting anything.
 */
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import process from 'node:process';

const GIB = 1024 ** 3;
export function classifyCapacity({availableGiB,usedPercent}, {
  warningGiB=80, criticalGiB=30, warningPercent=90, criticalPercent=95
}={}) {
  if(!Number.isFinite(availableGiB)||!Number.isFinite(usedPercent)||
    availableGiB<0||usedPercent<0||usedPercent>100)
    throw Error('INVALID_CAPACITY_MEASUREMENT');
  if(availableGiB<criticalGiB||usedPercent>=criticalPercent)
    return {level:'CRITICAL',reason:'DISK_HEADROOM_CRITICAL',prevent_large_jobs:true};
  if(availableGiB<warningGiB||usedPercent>=warningPercent)
    return {level:'WARNING',reason:'DISK_HEADROOM_LOW',prevent_large_jobs:true};
  return {level:'OK',reason:'DISK_HEADROOM_OK',prevent_large_jobs:false};
}
export async function captureCapacity(paths=['/workspace','/shared-auth']) {
  const result=[],seen=new Set();
  for(const pathname of paths){
    const stat=await fs.stat(pathname);
    if(seen.has(String(stat.dev)))continue;
    seen.add(String(stat.dev));
    // Node statfs reports f_bsize, while virtiofs allocates in f_frsize;
    // multiplying f_bavail by f_bsize exaggerates free space ~256x.
    // POSIX df -Pk uses the correct fragment accounting on Linux and macOS.
    const output=execFileSync('df',['-Pk',pathname],{encoding:'utf8',timeout:5000});
    const cols=output.trim().split('\n').at(-1).trim().split(/\s+/);
    if(cols.length<5||!/^\d+$/.test(cols[3])||!/^\d+%$/.test(cols[4]))
      throw Error('INVALID_DF_OUTPUT');
    const availableGiB=Number((Number(cols[3])*1024/GIB).toFixed(2));
    const usedPercent=Number(cols[4].slice(0,-1));
    result.push({path:pathname,available_gib:availableGiB,
      used_percent:usedPercent,...classifyCapacity({availableGiB,usedPercent})});
  }
  return {utc:new Date().toISOString(),paths_checked:paths,
    filesystems:result,read_only:true,automatic_cleanup:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const report=await captureCapacity();
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(process.argv.includes('--exit-on-alert') &&
       report.filesystems.some(x=>x.level!=='OK'))process.exitCode=75;
  }catch(error){
    process.stderr.write('STORAGE_ALERT_CHECK_FAILED:'+String(error?.code||error?.message||'UNKNOWN')+'\n');
    process.exitCode=2;
  }
}
