/**
 * Strict image-only promotion for the EXISTING cloud-sandbox-mcp Docker Compose service.
 * A permanent additive override preserves the full original Compose service definition.
 * Never recreates dev-main, changes any non-MCP service, or edits the original compose files.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {
  ORIGINAL_IMAGE,V2_IMAGE,V2_TAG,BASE_TAG,
  overlayFor,confirmOnlyImageChanged,verifyControllerMetadata
} from './promotion-core.mjs';

const mode=process.argv[2]??'--inspect';
if(!['--inspect','--promote','--rollback'].includes(mode)) {
  throw Error('USE_INSPECT_PROMOTE_OR_ROLLBACK');
}
if(process.platform!=='darwin') throw Error('MACOS_OPERATOR_ONLY');

const containerName='cloud-sandbox-mcp';
const workstation='cloud-sandbox-dev-main';
const home=os.homedir();
const deploymentDir=path.join(home,'.cloud-sandbox-mcp-data','shared-auth','deployment');
const overridePath=path.join(deploymentDir,'compose-overrides','browser-runtime-v2-mcp-image.compose.yaml');
const backupsDir=path.join(deploymentDir,'backups');
const lockPath=path.join(deploymentDir,'browser-runtime-v2-mcp-image-promotion.lock');
const log=msg=>process.stdout.write('[MCP image promotion] '+msg+'\n');

function run(exe,args,{cwd,input,timeout=45000}={}) {
  try {
    return execFileSync(exe,args,{
      cwd, input, encoding:'utf8',timeout,maxBuffer:6_000_000,
      stdio:['pipe','pipe','pipe']
    }).trim();
  }catch(error) {
    if(error?.code==='ETIMEDOUT')throw Error('COMMAND_TIMEOUT_'+args[0]?.toUpperCase().replace(/[^A-Z]/g,''));
    throw Error('COMMAND_FAILED_'+String(args[0]||'UNKNOWN').toUpperCase().replace(/[^A-Z]/g,''));
  }
}
async function dockerRead(args,options={}) {
  for(const seconds of [45,75]) {
    try {return run('docker',args,{...options,timeout:seconds*1000});}
    catch(error) {
      if(String(error.message).startsWith('COMMAND_TIMEOUT') && seconds===45) {
        log('Docker Desktop is slow; retrying this read-only check once.');
        await new Promise(resolve=>setTimeout(resolve,2000));
        continue;
      }
      throw error;
    }
  }
  throw Error('DOCKER_READ_UNAVAILABLE');
}
function readJSON(raw,description){
  try{return JSON.parse(raw);}
  catch{throw Error('INVALID_JSON_'+description);}
}
function safeFile(file) {
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink())throw Error('UNSAFE_FILE_TYPE');
}
function atomic(file,contents,permissions=0o600){
  const temp=file+'.staged-'+process.pid;
  fs.writeFileSync(temp,contents,{flag:'wx',mode:permissions});
  fs.renameSync(temp,file);
  fs.chmodSync(file,permissions);
}
function envValue(content,key){
  const lines=content.split(/\r?\n/).filter(line=>line.startsWith(key+'='));
  if(lines.length!==1)throw Error('EXISTING_ENV_KEY_MISSING_OR_DUPLICATE');
  const value=lines[0].slice(key.length+1).trim();
  return ((value.startsWith('"')&&value.endsWith('"'))||
         (value.startsWith("'")&&value.endsWith("'"))) ? value.slice(1,-1) : value;
}
async function noTaskSession(working) {
  const envFile=path.join(working,'.env');
  safeFile(envFile);
  const raw=fs.readFileSync(envFile,'utf8');
  const token=envValue(raw,'COMPUTER_USE_BRIDGE_TOKEN');
  if(token.length<32)throw Error('BRIDGE_TOKEN_UNAVAILABLE');
  let response;
  try{
    response=await fetch('http://127.0.0.1:9764/v1/status',{
      method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:'{}',signal:AbortSignal.timeout(8000),redirect:'error'
    });
  }catch{throw Error('BRIDGE_STATUS_UNAVAILABLE');}
  if(!response.ok)throw Error('BRIDGE_STATUS_REFUSED');
  const body=await response.json();
  if(body.ok!==true||!body.data||!body.data.delegated_session)
    throw Error('BRIDGE_SESSION_STATUS_UNSUPPORTED');
  if(body.data.delegated_session.active) throw Error('ACTIVE_COMPUTER_USE_SESSION_STOP_FIRST');
}
function imageId(tag){
  return run('docker',['image','inspect','--format','{{.Id}}',tag],{timeout:45000});
}
function inspectContainer(name){
  return verifyControllerMetadata(readJSON(
    run('docker',['inspect','--type','container',name]),'CONTROLLER_INSPECT'));
}
function snapshotWorkstation(){
  const result=readJSON(run('docker',['inspect','--type','container',workstation]),'WORKSTATION');
  if(!Array.isArray(result)||result.length!==1||!result[0].State?.Running)
    throw Error('WORKSTATION_UNEXPECTEDLY_UNAVAILABLE');
  return result[0].Id;
}
function mountIdentity(c){
  const mounts=(c.Mounts||[]).map(m=>[m.Type,m.Source,m.Destination,m.RW]).sort((a,b)=>String(a[2]).localeCompare(String(b[2])));
  return JSON.stringify({
    mounts,
    networks:Object.keys(c.NetworkSettings?.Networks||{}).sort(),
    restart:c.HostConfig?.RestartPolicy?.Name,
    ports:c.HostConfig?.PortBindings||{},
    environment:[...(c.Config?.Env||[])].sort(),
    user:c.Config?.User||'',
    command:c.Config?.Cmd||[],
    entrypoint:c.Config?.Entrypoint||[],
    privileged:Boolean(c.HostConfig?.Privileged)
  });
}
function composeCmd(files,project,working) {
  return ['compose','--project-name',project,'--project-directory',working,
    ...files.flatMap(f=>['-f',f])];
}
function render(prefix,working,stdin) {
  const args=stdin===undefined
    ?[...prefix,'config','--format','json']
    :[...prefix,'-f','-','config','--format','json'];
  return readJSON(run('docker',args,{cwd:working,input:stdin}), 'COMPOSE_CONFIG');
}
function approve(verb){
  const fd=fs.openSync('/dev/tty','r+');
  try{
    const value=verb==='--promote'?'PROMOTE_MCP_IMAGE':'ROLLBACK_MCP_IMAGE';
    const message=verb==='--promote'
      ?'Promote the pinned V2 image to ONLY cloud-sandbox-mcp, with one MCP service recreate?'
      :'Restore the original cloud-sandbox-mcp image, with one MCP service recreate?';
    fs.writeSync(fd,message+' Type '+value+': ');
    let response='';
    const char=Buffer.alloc(1);
    for(let i=0;i<64;i++){
      const n=fs.readSync(fd,char,0,1,null);
      if(n===0||char[0]===10||char[0]===13)break;
      response+=String.fromCharCode(char[0]);
    }
    return response===value;
  }finally{fs.closeSync(fd);}
}
async function execute(){
  log('Checking the running MCP controller and immutable local images.');
  const initial=verifyControllerMetadata(readJSON(
    await dockerRead(['inspect','--type','container',containerName]),'CONTROLLER'));
  if(initial.State.Health?.Status!=='healthy')throw Error('EXISTING_CONTROLLER_NOT_HEALTHY');
  const labels=initial.Config.Labels;
  const working=fs.realpathSync(labels['com.docker.compose.project.working_dir']||'');
  const project=labels['com.docker.compose.project'];
  const originalFiles=(labels['com.docker.compose.project.config_files']||'')
    .split(',').map(s=>s.trim()).filter(Boolean);
  if(!project || originalFiles.length===0 || !/^[a-zA-Z0-9_-]+$/.test(project))
    throw Error('COMPOSE_PROJECT_METADATA_UNAVAILABLE');
  for(const file of originalFiles) {
    if(!path.isAbsolute(file))throw Error('COMPOSE_FILE_IS_NOT_ABSOLUTE');
    safeFile(file);
  }
  if(new Set(originalFiles).size!==originalFiles.length) throw Error('DUPLICATE_COMPOSE_FILES');

  const oldId=imageId(BASE_TAG);
  const newId=imageId(V2_TAG);
  if(oldId!==ORIGINAL_IMAGE)throw Error('ORIGINAL_CONTROLLER_IMAGE_CHANGED');
  if(newId!==V2_IMAGE)throw Error('V2_CONTROLLER_IMAGE_CHANGED');
  const devMainId=snapshotWorkstation();
  await noTaskSession(working);

  const overrideAlready=originalFiles.includes(overridePath);
  if(fs.existsSync(overridePath)) {
    safeFile(overridePath);
    const currentBytes=fs.readFileSync(overridePath,'utf8');
    if(![overlayFor(BASE_TAG),overlayFor(V2_TAG)].includes(currentBytes))
      throw Error('UNRECOGNIZED_PERSISTENT_IMAGE_OVERRIDE');
    if(!overrideAlready)
      throw Error('OVERRIDE_EXISTS_BUT_NOT_REGISTERED_WITH_COMPOSE');
  }else if(overrideAlready){
    throw Error('REGISTERED_IMAGE_OVERRIDE_FILE_MISSING');
  }

  const isPromoted=initial.Config.Image===V2_TAG;
  const isBase=initial.Image===ORIGINAL_IMAGE || initial.Config.Image===BASE_TAG;
  if(!isPromoted && !isBase)throw Error('RUNNING_CONTROLLER_IMAGE_DRIFT');
  if(isPromoted && !overrideAlready)throw Error('PROMOTED_CONTROLLER_MISSING_OVERRIDE');
  if(overrideAlready){
    const expectedOverride=overlayFor(isPromoted?V2_TAG:BASE_TAG);
    if(fs.readFileSync(overridePath,'utf8')!==expectedOverride)
      throw Error('LIVE_IMAGE_OVERRIDE_DISAGREES_WITH_CONTROLLER');
  }
  if((mode==='--promote'||mode==='--inspect') && isPromoted){
    log('ALREADY_PROMOTED: verified V2 image reference is already active. No changes necessary.');
    return;
  }
  if(mode==='--rollback' && isBase){
    log('ALREADY_ROLLED_BACK: no changes necessary.');
    return;
  }
  if(mode==='--rollback' && isPromoted){
    // After Browser Runtime V2 code has been installed, reverting ONLY its
    // dependencies would break the live 28-tool registry. Roll back code first.
    let registry='';
    try {
      registry=run('docker',['exec',containerName,'node','--input-type=module',
        '-e',probes[V2_TAG].code],{timeout:18000});
    }catch{throw Error('ROLLBACK_V2_CODE_FIRST_THEN_IMAGE');}
    if(!registry.includes(probes[V2_TAG].marker))
      throw Error('ROLLBACK_V2_CODE_FIRST_THEN_IMAGE');
  }

  const projectPrefix=composeCmd(originalFiles,project,working);
  const currentConfig=render(projectPrefix,working);
  if(currentConfig.name!==project)throw Error('PROJECT_NAME_DRIFT');
  const desired=mode==='--rollback'?BASE_TAG:V2_TAG;
  const effectiveTargetConfig=render(projectPrefix,working,overlayFor(desired));
  confirmOnlyImageChanged(currentConfig,effectiveTargetConfig,desired);
  // On the very first promotion the baseline compose config should not
  // already reference the staged V2 image.
  if(mode!=='--rollback' && currentConfig.services.mcp.image===V2_TAG)
    throw Error('EXISTING_COMPOSE_ALREADY_REFERENCES_V2');

  log('PREFLIGHT_PASS: exact image IDs pinned, current Mac task session inactive.');
  log('PROJECT='+project);
  log('FROM_IMAGE='+initial.Image);
  log('TO_IMAGE='+imageId(desired));
  log('COMPOSE_DIFFERENCE=image-only on services.mcp');
  log('EXISTING_WORKSTATION=running (container ID captured)');
  log('PERSISTENT_OVERRIDE='+overridePath);
  if(mode==='--inspect'){
    log('READ_ONLY: no containers, images or Compose files changed.');
    return;
  }

  if(!approve(mode)){log('DECLINED: no changes made.');process.exitCode=2;return;}
  if(snapshotWorkstation()!==devMainId)throw Error('WORKSTATION_CHANGED_SINCE_PREFLIGHT');
  const fresh=inspectContainer(containerName);
  if(fresh.Id!==initial.Id || fresh.Image!==initial.Image || fresh.Config.Image!==initial.Config.Image)
    throw Error('CONTROLLER_CHANGED_SINCE_PREFLIGHT');
  await noTaskSession(working);
  if(imageId(BASE_TAG)!==ORIGINAL_IMAGE||imageId(V2_TAG)!==V2_IMAGE)
    throw Error('IMAGE_REFERENCE_CHANGED_SINCE_PREFLIGHT');

  await fsp.mkdir(path.dirname(overridePath),{recursive:true,mode:0o700});
  await fsp.mkdir(backupsDir,{recursive:true,mode:0o700});
  for(const dir of [deploymentDir,path.dirname(overridePath),backupsDir]){
    const st=fs.lstatSync(dir);
    if(!st.isDirectory()||st.isSymbolicLink())throw Error('UNSAFE_DEPLOYMENT_DIRECTORY');
  }
  const lockFd=fs.openSync(lockPath,'wx',0o600);
  try {
    fs.writeSync(lockFd,JSON.stringify({pid:process.pid,project,started:new Date().toISOString()})+'\n');
    const backup=path.join(backupsDir,'mcp-runtime-v2-'+Date.now()+'-'+process.pid);
    await fsp.mkdir(backup,{recursive:true,mode:0o700});
    const receipt={
      schema:'cloud-sandbox.mcp-image-promotion.v1',
      mode,project,working,originalFiles,overridePath,
      before:{container_id:initial.Id,image_id:initial.Image,compose_image:initial.Config.Image},
      requested:{image_ref:desired,image_id:imageId(desired)},
      workstation_container_id:devMainId,
      changed_at:new Date().toISOString(),
      state:'preparing'
    };
    await fsp.writeFile(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
    const beforeBytes=fs.existsSync(overridePath)?fs.readFileSync(overridePath):null;
    if(beforeBytes)await fsp.writeFile(path.join(backup,'previous-override.yaml'),beforeBytes,{mode:0o600});
    let composeStarted=false;
    try {
      atomic(overridePath,overlayFor(desired),0o600);
      const finalFiles=overrideAlready?originalFiles:[...originalFiles,overridePath];
      const finalPrefix=composeCmd(finalFiles,project,working);
      const finalConfig=render(finalPrefix,working);
      confirmOnlyImageChanged(currentConfig,finalConfig,desired);
      await noTaskSession(working);
      if(snapshotWorkstation()!==devMainId)throw Error('WORKSTATION_CHANGED_DURING_DEPLOYMENT');
      // Only target service mcp. No dependent services, no builds and no pulls.
      composeStarted=true;
      log('Recreating ONLY the existing mcp service with pinned '+desired+'.');
      run('docker',[...finalPrefix,'up','-d','--no-deps','--no-build','--pull','never',
        '--force-recreate','mcp'],{cwd:working,timeout:180000});
      await waitForHealthy(desired,devMainId,initial);
      receipt.state='verified';
      receipt.completed_at=new Date().toISOString();
      receipt.after=brief(inspectContainer(containerName));
      await fsp.writeFile(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
      log(mode==='--rollback'?'MCP_IMAGE_ROLLBACK_PASS':'MCP_IMAGE_PROMOTION_PASS');
      log('MCP, mounts, network and runtime checks passed; dev-main not recreated.');
      log('AUDIT_RECEIPT='+path.join(backup,'receipt.json'));
      if(mode==='--promote'){
        log('NEXT_GATE: run runtime-v2-f95ffeb/install.mjs --inspect.');
      }
    }catch(error){
      log('DEPLOYMENT_ERROR='+String(error.message||'UNKNOWN'));
      // Revert to the exact previous image using a stable Compose override.
      // When recreation has begun, do not delete the override or use a floating tag.
      const restoreTag=isPromoted?V2_TAG:BASE_TAG;
      try{
        if(composeStarted){
          atomic(overridePath,overlayFor(restoreTag),0o600);
          const finalFiles=overrideAlready?originalFiles:[...originalFiles,overridePath];
          const rollbackPrefix=composeCmd(finalFiles,project,working);
          const current=render(rollbackPrefix,working);
          confirmOnlyImageChanged(currentConfig,current,restoreTag);
          run('docker',[...rollbackPrefix,'up','-d','--no-deps','--no-build',
            '--pull','never','--force-recreate','mcp'],{cwd:working,timeout:180000});
          await waitForHealthy(restoreTag,devMainId,initial);
        }else if(beforeBytes!==null){
          atomic(overridePath,beforeBytes,0o600);
        }else{
          await fsp.rm(overridePath,{force:true});
        }
        receipt.state='rolled_back';
        await fsp.writeFile(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
        log('AUTOMATIC_ROLLBACK_VERIFIED: prior controller image restored.');
      }catch(rollbackError){
        receipt.state='rollback_requires_operator';
        await fsp.writeFile(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
        log('ROLLBACK_INCOMPLETE: stop and inspect the MCP controller.');
        log('RECOVERY_RECEIPT='+path.join(backup,'receipt.json'));
      }
      process.exitCode=2;
    }
  }finally{
    fs.closeSync(lockFd);
    await fsp.rm(lockPath,{force:true});
  }
}
function brief(item) {
  return {
    container_id:item.Id,
    image_ref:item.Config.Image,
    image_id:item.Image,
    health:item.State?.Health?.Status??'none'
  };
}
const probes={
  [V2_TAG]: {
    code:fs.readFileSync(new URL('./registry-probe.mjs',import.meta.url),'utf8'),
    marker:'CONTROLLER_DEPENDENCIES_8_AND_MCP_REGISTRY_23_PASS'
  },
  [BASE_TAG]: {
    code:fs.readFileSync(new URL('./registry-probe-old.mjs',import.meta.url),'utf8'),
    marker:'BASE_IMAGE_MCP_REGISTRY_23_PASS'
  }
};
async function waitForHealthy(expectedTag,workstationId,previous) {
  let reached=false;
  const probe=probes[expectedTag];
  if(!probe)throw Error('UNRECOGNIZED_IMAGE_FOR_VERIFICATION');
  for(let attempt=0;attempt<38;attempt++){
    try{
      const current=inspectContainer(containerName);
      if(current.Config.Image!==expectedTag)throw Error('WRONG_CONTAINER_IMAGE');
      if(current.State.Health?.Status!=='healthy')throw Error('NOT_HEALTHY_YET');
      if(mountIdentity(current)!==mountIdentity(previous))
        throw Error('MCP_RUNTIME_MOUNT_NETWORK_OR_PORT_DRIFT');
      if(snapshotWorkstation()!==workstationId)
        throw Error('WORKSTATION_WAS_RECREATED');
      const status=run('docker',['exec',containerName,'node','-e',
        "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(2);console.log('HTTP_200')}).catch(()=>process.exit(2))"],
        {timeout:10000});
      if(!status.includes('HTTP_200'))throw Error('HTTP_PROBE_FAILED');
      const result=run('docker',['exec',containerName,'node','--input-type=module',
        '-e',probe.code],{timeout:18000});
      if(!result.includes(probe.marker))throw Error('MCP_REGISTRY_VERIFICATION_FAILED');
      reached=true;
      break;
    }catch(error){
      if(['MCP_RUNTIME_MOUNT_NETWORK_OR_PORT_DRIFT',
          'WORKSTATION_WAS_RECREATED','WRONG_CONTAINER_IMAGE'].includes(error.message))
        throw error;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }
  if(!reached)throw Error('MCP_IMAGE_NOT_HEALTHY_OR_REGISTRY_UNAVAILABLE');
}
try {
  await execute();
}catch(error) {
  log('STOP: '+String(error.message||'UNKNOWN').replace(/[^\x20-\x7e]/g,'').slice(0,170));
  log('No unrelated Docker service was requested to restart.');
  process.exitCode=2;
}
