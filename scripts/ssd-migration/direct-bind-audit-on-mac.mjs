#!/usr/bin/env node
/**
 * NON-MUTATING audit of existing Docker containers for direct-SSD
 * bind mount migration. Prints only non-secret settings and flags.
 * Avoids launching containers, touching the SSD or writing
 * a sensitive full docker inspect snapshot.
 */
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const EXPECTED_UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
export const ROOT='/Volumes/SSD/Sandbox';
export const SSD_DATA=ROOT+'/persistent/cloud-sandbox-mcp-data';
export const SSD_CODE=ROOT+'/source/cloud-sandbox-workstation';
export const WID='6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
const SOURCE=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const CONTROLLER=path.join(os.homedir(),
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const mappings={
  'cloud-sandbox-mcp': {
    '/data':[SOURCE,SSD_DATA]
  },
  'cloud-sandbox-dev-main': {
    '/workspace':[SOURCE+'/workspaces/'+WID+'/repo',
      SSD_DATA+'/workspaces/'+WID+'/repo'],
    '/home/agent':[SOURCE+'/workspaces/'+WID+'/home',
      SSD_DATA+'/workspaces/'+WID+'/home'],
    '/shared-auth':[SOURCE+'/shared-auth',SSD_DATA+'/shared-auth'],
    '/var/lib/docker':[SOURCE+'/workspaces/'+WID+'/docker',
      SSD_DATA+'/workspaces/'+WID+'/docker']
  }
};
function say(key,value){
  console.log('[SSD Direct Bind Audit] '+key+'='+String(value));
}
function run(command,args,{input,timeout=18000}={}){
  const r=spawnSync(command,args,{
    encoding:'utf8',input,timeout,maxBuffer:4_000_000,
    stdio:['pipe','pipe','pipe']
  });
  if(r.status!==0||r.error)
    throw Error('READ_ONLY_COMMAND_FAILED:'+path.basename(command)+
      ':'+String(args[0]||''));
  return r.stdout;
}
export function validateDisk(info={}){
  const filesystem=String(info.FileSystemPersonality||'')+
    ' '+String(info.FilesystemType||'');
  const apfs=/(^|[^A-Z])APFS([^A-Z]|$)/i.test(filesystem);
  const writable=(info.Writable===true||
    info.ReadOnlyVolume===false||info.VolumeReadOnly===false)&&
    info.ReadOnlyVolume!==true&&info.VolumeReadOnly!==true&&
    info.ReadOnlyMedia!==true&&info.WriteProtected!==true;
  return apfs&&writable&&info.Internal===false&&
    info.MountPoint==='/Volumes/SSD'&&
    String(info.VolumeUUID||'').toUpperCase()===EXPECTED_UUID;
}
export function containerSummary(c){
  const name=String(c?.Name||'').replace(/^\/+/,'');
  const expected=mappings[name];
  if(!expected)throw Error('UNRECOGNIZED_CONTAINER_NAME');
  if(c.State?.Running!==true)
    throw Error('CONTAINER_NOT_RUNNING:'+name);
  const mounts=c.Mounts||[];
  const primary=[];
  for(const [destination,[source,target]] of Object.entries(expected)){
    const found=mounts.filter(m=>m.Destination===destination);
    if(found.length!==1||found[0].Type!=='bind'||
      found[0].Source!==source)
      throw Error('ORIGINAL_MOUNT_DRIFT:'+name+':'+destination);
    primary.push({destination,originalSource:source,
      directSSDTarget:target,writable:found[0].RW});
  }
  const extra=mounts.filter(m=>!(m.Destination in expected))
    .map(m=>({
      destination:m.Destination,
      sourceKind:m.Type,
      hostPath:m.Type==='bind'?m.Source:null,
      writable:m.RW
    }));
  const cfg=c.Config||{};
  const host=c.HostConfig||{};
  const network=c.NetworkSettings||{};
  return {
    name,
    running:c.State.Running,
    image:cfg.Image||'unknown',
    imageId:String(c.Image||'').slice(0,20),
    networkMode:host.NetworkMode||'',
    networks:Object.keys(network.Networks||{}).sort(),
    aliases:Object.fromEntries(Object.entries(network.Networks||{})
      .map(([k,v])=>[k,(v.Aliases||[]).filter(Boolean)])),
    portBindings:host.PortBindings||{},
    restartPolicy:host.RestartPolicy?.Name||'no',
    privileged:host.Privileged===true,
    readOnlyRootfs:host.ReadonlyRootfs===true,
    autoRemove:host.AutoRemove===true,
    runtime:host.Runtime||'',
    pidMode:host.PidMode||'',
    ipcMode:host.IpcMode||'',
    usernsMode:host.UsernsMode||'',
    cgroupnsMode:host.CgroupnsMode||'',
    init:host.Init??null,
    memory:host.Memory||0,
    memorySwap:host.MemorySwap??null,
    nanoCpus:host.NanoCpus||0,
    cpuQuota:host.CpuQuota||0,
    cpuPeriod:host.CpuPeriod||0,
    pidsLimit:host.PidsLimit??null,
    shmSize:host.ShmSize||0,
    capAdd:host.CapAdd||[],
    capDrop:host.CapDrop||[],
    securityOpts:host.SecurityOpt||[],
    dnsCount:(host.Dns||[]).length,
    extraHostsCount:(host.ExtraHosts||[]).length,
    devicesCount:(host.Devices||[]).length,
    volumesFrom:host.VolumesFrom||[],
    deviceRequestsCount:(host.DeviceRequests||[]).length,
    namedMountCount:mounts.filter(m=>m.Type==='volume').length,
    workdir:cfg.WorkingDir||'',
    user:cfg.User||'',
    entrypointArgs:(cfg.Entrypoint||[]).length,
    commandArgs:(cfg.Cmd||[]).length,
    envCount:(cfg.Env||[]).length,
    exposedPortCount:Object.keys(cfg.ExposedPorts||{}).length,
    labelKeys:Object.keys(cfg.Labels||{}).sort(),
    healthcheckConfigured:cfg.Healthcheck!==null&&
      cfg.Healthcheck!==undefined,
    primaryMounts:primary,
    extraMounts:extra
  };
}
export function migrationBlockers(s){
  const blockers=[];
  if(s.autoRemove)blockers.push('AUTOREMOVE');
  if(s.deviceRequestsCount||s.devicesCount)
    blockers.push('DEVICE_MAPPING_REQUIRES_RECONCILIATION');
  if(s.volumesFrom.length)
    blockers.push('VOLUMES_FROM_REQUIRES_RECONCILIATION');
  if(s.namedMountCount)
    blockers.push('NAMED_VOLUME_REQUIRES_RECONCILIATION');
  if(s.extraMounts.some(m=>m.sourceKind==='bind'))
    blockers.push('ADDITIONAL_BIND_MOUNTS_REQUIRE_EXPLICIT_MAPPING');
  if(s.networks.length>1)
    blockers.push('MULTIPLE_NETWORK_ATTACHMENTS_REQUIRE_RECONCILIATION');
  if(s.pidMode||s.ipcMode||s.usernsMode)
    blockers.push('NAMESPACE_MODE_REQUIRES_RECONCILIATION');
  return blockers;
}
function diskInfo(){
  const plist=run('/usr/sbin/diskutil',
    ['info','-plist','/Volumes/SSD']);
  return JSON.parse(run('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{input:plist}));
}
function trustedStage(){
  const markerFile=ROOT+'/.sandbox-v3-stage.json';
  const receiptFile=ROOT+'/reports/staging-receipt.json';
  const marker=JSON.parse(fs.readFileSync(markerFile,'utf8'));
  const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  if(marker.volumeUuid!==EXPECTED_UUID||marker.dataSource!==SOURCE||
    marker.controllerSource!==CONTROLLER||marker.canCutover!==false||
    receipt.operation!=='LIVE_STAGING_COPY_COMPLETED'||
    receipt.requireColdFinalSync!==true||
    receipt.migrationCutoverExecuted!==false)
    throw Error('STAGING_EVIDENCE_UNTRUSTED');
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--inspect')
    throw Error('READ_ONLY_INSPECT_REQUIRED');
  if(process.platform!=='darwin')throw Error('MACOS_HOST_REQUIRED');
  const mount=fs.lstatSync('/Volumes/SSD');
  if(!mount.isDirectory()||mount.isSymbolicLink()||
    !validateDisk(diskInfo()))
    throw Error('SSD_UUID_APFS_OR_RW_MISMATCH');
  fs.accessSync('/Volumes/SSD',fs.constants.R_OK|fs.constants.W_OK);
  for(const loc of [SOURCE,CONTROLLER,SSD_DATA,SSD_CODE]){
    const st=fs.lstatSync(loc);
    if(!st.isDirectory()||st.isSymbolicLink())
      throw Error('EXPECTED_DIRECTORY_MISSING_OR_SYMLINK:'+loc);
  }
  trustedStage();
  const containers=JSON.parse(run('docker',[
    'inspect','cloud-sandbox-mcp','cloud-sandbox-dev-main'
  ]));
  const summaries=containers.map(containerSummary).sort((a,b)=>
    a.name.localeCompare(b.name));
  if(summaries.length!==2)throw Error('UNEXPECTED_CONTAINER_COUNT');
  const controller=summaries.find(x=>x.name==='cloud-sandbox-mcp');
  if(!controller.labelKeys.includes('com.docker.compose.project'))
    throw Error('CONTROLLER_COMPOSE_LABEL_MISSING');
  for(const s of summaries){
    say('CONTAINER',s.name);
    say(s.name+'.IMAGE',s.image);
    say(s.name+'.IMAGE_ID',s.imageId);
    say(s.name+'.NETWORK_MODE',s.networkMode);
    say(s.name+'.NETWORKS',s.networks.join(',')||'none');
    say(s.name+'.PORT_BINDINGS',JSON.stringify(s.portBindings));
    say(s.name+'.RESTART_POLICY',s.restartPolicy);
    say(s.name+'.PRIVILEGED',s.privileged);
    say(s.name+'.MEMORY_BYTES',s.memory);
    say(s.name+'.NANO_CPUS',s.nanoCpus);
    say(s.name+'.PIDS_LIMIT',s.pidsLimit);
    say(s.name+'.COMMAND_ARG_COUNT',s.commandArgs);
    say(s.name+'.ENTRYPOINT_ARG_COUNT',s.entrypointArgs);
    say(s.name+'.ENV_VARIABLE_COUNT',s.envCount);
    say(s.name+'.HEALTHCHECK',s.healthcheckConfigured);
    say(s.name+'.LABEL_KEYS',s.labelKeys.join(',')||'none');
    say(s.name+'.MOUNTS_TO_RETARGET',
      s.primaryMounts.map(m=>m.destination).join(','));
    say(s.name+'.EXTRA_MOUNTS',JSON.stringify(s.extraMounts));
    const blockers=migrationBlockers(s);
    say(s.name+'.REQUIRES_RECONCILIATION',
      blockers.join(',')||'none');
    say(s.name+'.RESOURCE_SECURITY',
      JSON.stringify({runtime:s.runtime,pidMode:s.pidMode,
        ipcMode:s.ipcMode,usernsMode:s.usernsMode,cgroupnsMode:s.cgroupnsMode,
        init:s.init,memorySwap:s.memorySwap,cpuPeriod:s.cpuPeriod,
        cpuQuota:s.cpuQuota,shmSize:s.shmSize,capAdd:s.capAdd,
        capDrop:s.capDrop,securityOpts:s.securityOpts,
        dnsCount:s.dnsCount,extraHostsCount:s.extraHostsCount}));
  }
  say('UUID_AND_SSD_STAGE','PASS');
  say('LIVE_ORIGINAL_MOUNTS','PASS');
  say('SECRETS_OR_ENV_VALUES_PRINTED','NO');
  say('CONFIG_CHANGED','NO');
  say('RESULT','DIRECT_BIND_CONFIGURATION_AUDITED_NOT_CUTOVER');
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  try{main();}
  catch(e){say('STOP',String(e?.message||'UNKNOWN'));process.exitCode=2;}
}
