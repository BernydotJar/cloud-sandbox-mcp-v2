#!/usr/bin/env node
/**
 * Safely rehearse Docker Engine container CREATE for exact existing
 * sandbox V3 containers, with only 5 target bind paths changed to
 * the pinned external SSD. This does not start, stop, rename or
 * recreate the original active containers, and never runs rsync.
 * The two temporary candidate containers are deleted in finally.
 * Secrets/Env values are passed through the local Docker socket
 * directly from inspect memory and never written or logged.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import http from 'node:http';
import process from 'node:process';
import console from 'node:console';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const VOLUME='/Volumes/SSD';
const UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
const ROOT=VOLUME+'/Sandbox';
const TARGET=ROOT+'/persistent/cloud-sandbox-mcp-data';
const WID='6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
const SOURCE=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const EXPECTED={
  'cloud-sandbox-mcp':{
    '/data':[SOURCE,TARGET]
  },
  'cloud-sandbox-dev-main':{
    '/workspace':[
      SOURCE+'/workspaces/'+WID+'/repo',
      TARGET+'/workspaces/'+WID+'/repo'],
    '/home/agent':[
      SOURCE+'/workspaces/'+WID+'/home',
      TARGET+'/workspaces/'+WID+'/home'],
    '/shared-auth':[SOURCE+'/shared-auth',TARGET+'/shared-auth'],
    '/var/lib/docker':[
      SOURCE+'/workspaces/'+WID+'/docker',
      TARGET+'/workspaces/'+WID+'/docker']
  }
};
const ORIGINALS=Object.keys(EXPECTED);
const RELEASE_DIR=path.dirname(fileURLToPath(import.meta.url));
const echo=(key,val)=>console.log('[SSD Direct Rehearsal] '+key+'='+val);
function verifySignedRelease(){
  const manifestPath=path.join(RELEASE_DIR,'manifest.json');
  const digestPath=path.join(RELEASE_DIR,'manifest.sha256');
  for(const file of [manifestPath,digestPath]){
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>30000)
      throw Error('RELEASE_SIGNATURE_FILE_UNTRUSTED');
  }
  const bytes=fs.readFileSync(manifestPath);
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  if(actual!==fs.readFileSync(digestPath,'utf8').trim())
    throw Error('RELEASE_MANIFEST_HASH_CHANGED');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schema!=='sandbox-v3.ssd-direct-rehearsal.v1'||
    manifest.pinned_volume_uuid!==UUID||
    manifest.files_sha256?.['direct-bind-rehearsal-on-mac.mjs']===undefined)
    throw Error('RELEASE_IDENTITY_MISMATCH');
  for(const [name,expected] of Object.entries(manifest.files_sha256)){
    if(!/^[A-Za-z0-9._-]+$/.test(name)||!/^[0-9a-f]{64}$/.test(expected))
      throw Error('RELEASE_FILE_RECORD_NOT_TRUSTED');
    const filename=path.join(RELEASE_DIR,name);
    const st=fs.lstatSync(filename);
    if(!st.isFile()||st.isSymbolicLink()||
      crypto.createHash('sha256').update(fs.readFileSync(filename))
        .digest('hex')!==expected)
      throw Error('RELEASE_FILE_HASH_CHANGED:'+name);
  }
}
function clone(obj){return JSON.parse(JSON.stringify(obj));}
function command(bin,args,{input,timeout=18000}={}){
  const r=spawnSync(bin,args,{
    encoding:'utf8',timeout,input,stdio:['pipe','pipe','pipe'],
    maxBuffer:4_000_000
  });
  if(r.status!==0||r.error)
    throw Error('COMMAND_FAILED:'+path.basename(bin)+':'+args[0]);
  return r.stdout;
}
function diskReadOnlyCheck(){
  const volume=fs.lstatSync(VOLUME);
  if(!volume.isDirectory()||volume.isSymbolicLink())
    throw Error('EXTERNAL_DISK_NOT_TRUSTED');
  const plist=command('/usr/sbin/diskutil',['info','-plist',VOLUME]);
  const disk=JSON.parse(command('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{input:plist}));
  const apfs=/(^|[^A-Z])APFS([^A-Z]|$)/i.test(
    String(disk.FileSystemPersonality||'')+' '+String(disk.FilesystemType||''));
  const writable=(disk.Writable===true||
    disk.ReadOnlyVolume===false||disk.VolumeReadOnly===false)&&
    disk.ReadOnlyVolume!==true&&disk.VolumeReadOnly!==true&&
    disk.ReadOnlyMedia!==true&&disk.WriteProtected!==true;
  if(!apfs||!writable||disk.Internal!==false||
    disk.MountPoint!==VOLUME||
    String(disk.VolumeUUID||'').toUpperCase()!==UUID)
    throw Error('EXTERNAL_SSD_UUID_APFS_OR_READWRITE_MISMATCH');
  for(const place of [ROOT,TARGET,
    ROOT+'/source/cloud-sandbox-workstation',SOURCE]){
    const st=fs.lstatSync(place);
    if(!st.isDirectory()||st.isSymbolicLink())
      throw Error('STAGING_ROOT_OR_MAC_SOURCE_NOT_DIRECTORIES');
  }
  for(const [,binds] of Object.entries(EXPECTED))
    for(const [,urls] of Object.entries(binds))
      if(!fs.statSync(urls[1]).isDirectory())
        throw Error('SSD_BIND_TARGET_MISSING');
}
function stageReceiptCheck(){
  const marker=JSON.parse(fs.readFileSync(
    ROOT+'/.sandbox-v3-stage.json','utf8'));
  const receipt=JSON.parse(fs.readFileSync(
    ROOT+'/reports/staging-receipt.json','utf8'));
  if(marker.schema!=='sandbox-v3.toshiba-stage.v1'||
    marker.volumeUuid!==UUID||
    marker.dataSource!==SOURCE||
    marker.canCutover!==false||
    receipt.operation!=='LIVE_STAGING_COPY_COMPLETED'||
    receipt.sourcePathsPreserved!==true||
    receipt.migrationCutoverExecuted!==false||
    receipt.requireColdFinalSync!==true)
    throw Error('STAGE_RECEIPT_MISMATCH');
}
export function validateSource(c){
  const name=String(c?.Name||'').replace(/^\//,'');
  if(!EXPECTED[name]||c.State?.Running!==true)
    throw Error('ORIGINAL_CONTAINER_UNRECOGNIZED_OR_STOPPED');
  if(!/^sha256:[0-9a-f]{64}$/.test(c.Image||''))
    throw Error('IMAGE_ID_MUST_BE_PINNED');
  const mounts=c.Mounts||[];
  for(const [dst,[original,physical]] of Object.entries(EXPECTED[name])){
    const m=mounts.filter(v=>v.Destination===dst);
    if(m.length!==1||m[0].Type!=='bind'||m[0].Source!==original||
      !m[0].RW||physical===original)
      throw Error('ORIGINAL_BIND_SOURCE_DRIFT:'+name+':'+dst);
  }
  const settings=c.HostConfig||{};
  if(settings.AutoRemove)
    throw Error('AUTOREMOVE_ORIGINAL_UNSUPPORTED');
  if(c.NetworkSettings?.Networks===undefined)
    throw Error('NETWORK_INSPECTION_MISSING');
  if(name==='cloud-sandbox-dev-main'){
    if(settings.Privileged!==true||
      !c.NetworkSettings.Networks.bridge||
      !c.NetworkSettings.Networks['cloud-sandbox-edge'])
      throw Error('WORKSTATION_DUAL_NETWORK_OR_PRIVILEGED_DRIFT');
    for(const [dst,original] of [
      ['/shared/development',path.join(os.homedir(),'Development')],
      ['/shared/github-repos-local',
        path.join(os.homedir(),'Github-Repos-local')]
    ]){
      if(!mounts.some(m=>m.Type==='bind'&&
        m.Source===original&&m.Destination===dst&&m.RW===true))
        throw Error('WORKSTATION_EXTRA_MOUNT_MISSING:'+dst);
    }
  }
  if(name==='cloud-sandbox-mcp'){
    if(!mounts.some(m=>m.Type==='bind'&&
      m.Source===CONTROLLER_CODE()&&m.Destination==='/app/dist'&&
      m.RW===false)||
      !mounts.some(m=>m.Type==='bind'&&
        m.Source==='/var/run/docker.sock'&&
        m.Destination==='/var/run/docker.sock'))
      throw Error('CONTROLLER_CUSTOM_OVERLAY_OR_SOCKET_MISSING');
  }
  return name;
}
function CONTROLLER_CODE(){
  return path.join(os.homedir(),
    'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation/infra-v1/controller');
}
function rewriteBinds(host,expected){
  const seen=new Set();
  const destKeys=new Set(Object.keys(expected));
  if(Array.isArray(host.Binds)){
    host.Binds=host.Binds.map(entry=>{
      const text=String(entry);
      // Mac source paths are not permitted to include colons in this contract.
      const parts=text.split(':');
      if(parts.length<2||parts.length>3)
        throw Error('UNSUPPORTED_BIND_STRING');
      const [source,dest,...options]=parts;
      if(!destKeys.has(dest))return text;
      if(source!==expected[dest][0]||seen.has(dest))
        throw Error('REPLACE_BIND_MISMATCH:'+dest);
      seen.add(dest);
      return [expected[dest][1],dest,...options].join(':');
    });
  }
  if(Array.isArray(host.Mounts)){
    host.Mounts=host.Mounts.map(m=>{
      if(!destKeys.has(m.Target))return m;
      const [src,dst]=expected[m.Target];
      if(m.Type!=='bind'||m.Source!==src||seen.has(m.Target))
        throw Error('REPLACE_STRUCTURED_MOUNT_MISMATCH:'+m.Target);
      seen.add(m.Target);
      return {...m,Source:dst};
    });
  }
  // Some Docker versions include no HostConfig Bind or Mount spec for
  // Docker Desktop file-share mounts. Recreate ONLY if NONE were represented.
  if(!seen.size&&!host.Binds?.length&&!host.Mounts?.length)
    throw Error('INSPECT_DOES_NOT_EXPOSE_ORIGINAL_BIND_SPECS');
  for(const dst of destKeys)
    if(!seen.has(dst))
      throw Error('NOT_ALL_BINDS_REWRITTEN:'+dst);
  return host;
}
export function candidateConfig(c){
  const name=validateSource(c);
  const host=rewriteBinds(clone(c.HostConfig),EXPECTED[name]);
  // Candidate containers NEVER auto-restart during rehearsal.
  host.RestartPolicy={Name:'no'};
  const config=clone(c.Config);
  config.Image=c.Image; // pinned image ID, not a mutable tag
  // Docker Engine POST /containers/create accepts Config/HostConfig.
  // Runtime inspect fields (Id, Image ID, NetworkSettings, State) are
  // not part of the request. Every env value stays in-process.
  const net=c.NetworkSettings.Networks;
  const main=c.HostConfig.NetworkMode;
  if(!net[main])throw Error('PRIMARY_NETWORK_RECONCILIATION_REQUIRED');
  const networkConfig={
    EndpointsConfig:{
      [main]:{
        Aliases:net[main].Aliases||undefined,
        IPAMConfig:net[main].IPAMConfig||undefined,
        DriverOpts:net[main].DriverOpts||undefined
      }
    }
  };
  const secondary=Object.entries(net)
    .filter(([key])=>key!==main)
    .map(([network,details])=>({
      network,
      endpoint:{
        Aliases:details.Aliases||undefined,
        IPAMConfig:details.IPAMConfig||undefined,
        DriverOpts:details.DriverOpts||undefined
      }
    }));
  return {name,
    body:{...config,HostConfig:host,NetworkingConfig:networkConfig},
    secondary,
    originalConfig:c.Config,
    originalHost:c.HostConfig
  };
}
function assertCandidate(original,created,plan){
  if(created.Config?.Image!==original.Image)
    throw Error('CANDIDATE_PINNED_IMAGE_DIFFERENT');
  if(created.HostConfig?.Privileged!==original.HostConfig?.Privileged||
    created.HostConfig?.NetworkMode!==original.HostConfig?.NetworkMode||
    JSON.stringify(created.Config.Env)!==JSON.stringify(original.Config.Env))
    throw Error('CANDIDATE_CORE_CONFIG_PARITY_FAILED');
  for(const [dst,[,target]] of Object.entries(EXPECTED[plan.name])){
    const matches=(created.Mounts||[]).filter(x=>x.Destination===dst);
    if(matches.length!==1||matches[0].Source!==target||
      matches[0].Type!=='bind')
      throw Error('CANDIDATE_DIRECT_SSD_MOUNT_MISSING:'+dst);
  }
  const originals=original.Mounts.filter(x=>!EXPECTED[plan.name][x.Destination]);
  for(const old of originals){
    const current=(created.Mounts||[]).find(x=>x.Destination===old.Destination);
    if(!current||current.Source!==old.Source||
      current.Type!==old.Type||current.RW!==old.RW)
      throw Error('EXTRA_MOUNT_NOT_PRESERVED:'+old.Destination);
  }
  // A stopped container only requires its ORIGINAL PRIMARY network
  // during CREATE. Modern and older Docker Engine versions differ in
  // whether secondary network connect is available before start; the
  // additional networks MUST be connected after START during the later
  // controlled cutover. This rehearsal does not start containers.
  const primary=original.HostConfig.NetworkMode;
  const networks=Object.keys(created.NetworkSettings?.Networks||{});
  if(!networks.includes(primary))
    throw Error('CANDIDATE_PRIMARY_NETWORK_MISSING');
  const oldNetworks=Object.keys(original.NetworkSettings?.Networks||{});
  if(!plan.secondary.length&&networks.length!==oldNetworks.length)
    throw Error('CANDIDATE_NETWORK_SET_UNEXPECTED');
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  for(const key of ['CapAdd','CapDrop','SecurityOpt','Runtime',
    'IpcMode','CgroupnsMode','PidMode','UsernsMode','PidsLimit',
    'Memory','NanoCpus','ShmSize','PortBindings','LogConfig']){
    if(!same(created.HostConfig?.[key],original.HostConfig?.[key]))
      throw Error('CANDIDATE_HOST_CONFIG_DIFFERENCE:'+key);
  }
  for(const key of ['WorkingDir','User','Entrypoint','Cmd',
    'Labels','ExposedPorts','Volumes']){
    if(!same(created.Config?.[key],original.Config?.[key]))
      throw Error('CANDIDATE_APPLICATION_CONFIG_DIFFERENCE:'+key);
  }
}
function dockerContext(){
  const docker=command('docker',['context','inspect',
    '--format','{{.Endpoints.docker.Host}}']).trim();
  if(!docker.startsWith('unix://'))
    throw Error('ONLY_LOCAL_UNIX_DOCKER_CONTEXT_SUPPORTED');
  const socketPath=docker.slice('unix://'.length);
  const st=fs.statSync(socketPath);
  if(!st.isSocket())throw Error('DOCKER_SOCKET_NOT_VALID');
  const api=command('docker',['version','--format',
    '{{.Server.APIVersion}}']).trim();
  if(!/^\d+\.\d+$/.test(api))
    throw Error('DOCKER_API_VERSION_NOT_SUPPORTED');
  return {socketPath,api};
}
function api({socketPath,api},method,uri,payload=null){
  return new Promise((resolve,reject)=>{
    const request=http.request({
      socketPath,method,path:'/v'+api+uri,
      headers:{'Content-Type':'application/json'},
      timeout:30000
    },resp=>{
      const chunks=[];
      resp.on('data',b=>chunks.push(b));
      resp.on('end',()=>{
        const data=Buffer.concat(chunks).toString('utf8');
        if(resp.statusCode>=400){
          // Avoid echoing Docker errors with absolute paths or env.
          reject(Error('ENGINE_REQUEST_FAILED:'+method+':HTTP'+resp.statusCode));
          return;
        }
        try{resolve(data?JSON.parse(data):{});}
        catch{reject(Error('ENGINE_RESPONSE_NOT_JSON'));}
      });
    });
    request.on('timeout',()=>request.destroy(Error('ENGINE_REQUEST_TIMEOUT')));
    request.on('error',reject);
    if(payload!==null)request.end(JSON.stringify(payload));
    else request.end();
  });
}
async function rehearse(){
  const context=dockerContext();
  // A Docker context can differ from DOCKER_HOST environment overrides.
  // NEVER create candidates on an engine other than the one inspected
  // with the Docker CLI.
  const apiInfo=await api(context,'GET','/info');
  const cliId=command('docker',['info','--format','{{.ID}}']).trim();
  if(!cliId||apiInfo.ID!==cliId)
    throw Error('DOCKER_CLI_AND_ENGINE_SOCKET_IDENTITY_MISMATCH');
  const originals=JSON.parse(command('docker',[
    'inspect',...ORIGINALS]));
  const spec=ORIGINALS.map(name=>{
    const c=originals.find(x=>x.Name==='/'+name);
    if(!c)throw Error('EXPECTED_ORIGINAL_MISSING:'+name);
    return {c,...candidateConfig(c)};
  });
  const tokens=[];
  let operationError=null;
  let cleanupFailed=false;
  try{
    for(const item of spec){
      const suffix=crypto.randomBytes(6).toString('hex');
      const name='ssd-rehearsal-'+item.name+'-'+suffix;
      // Record the name before requesting creation so cleanup can
      // find even a partially-created candidate after a transport error.
      tokens.push(name);
      // No start! Dynamic port conflict, local data mutation and
      // service traffic are avoided during initial create parity.
      const created=await api(context,'POST',
        '/containers/create?name='+encodeURIComponent(name),
        item.body);
      if(!created.Id)throw Error('ENGINE_CREATE_DID_NOT_RETURN_ID');
      // Deliberately DO NOT attach secondary networks while stopped:
      // Docker may respond "operation not supported". Secondary
      // endpoints remain a mandatory guarded AFTER-START operation
      // during real cutover, with parity checked before traffic.
      const check=await api(context,'GET',
        '/containers/'+encodeURIComponent(created.Id)+'/json');
      assertCandidate(item.c,check,item);
      echo(item.name+'.CREATE_PARITY','PASS');
      echo(item.name+'.SECONDARY_NETWORKS_DEFERRED',
        item.secondary.map(n=>n.network).join(',')||'none');
    }
  }catch(error){
    operationError=error;
  }finally{
    for(const name of tokens.reverse()){
      try{
        await api(context,'DELETE',
          '/containers/'+encodeURIComponent(name)+'?force=1');
      }catch(e){
        // An unfinished create may have failed before any candidate
        // existed. HTTP 404 is safe in that specific cleanup path.
        if(e.message!=='ENGINE_REQUEST_FAILED:DELETE:HTTP404')
          cleanupFailed=true;
      }
    }
    if(cleanupFailed)
      echo('CLEANUP','REVIEW_TEMPORARY_CANDIDATES');
    else echo('CLEANUP','PASS');
  }
  if(cleanupFailed)
    throw Error('REHEARSAL_TEMPORARY_CONTAINER_CLEANUP_FAILED');
  const after=JSON.parse(command('docker',['inspect',...ORIGINALS]));
  for(const before of originals){
    const next=after.find(c=>c.Name===before.Name);
    if(!next||next.Id!==before.Id||!next.State?.Running||
      JSON.stringify(next.Mounts)!==JSON.stringify(before.Mounts))
      throw Error('ORIGINAL_CONTAINER_ID_OR_MOUNTS_CHANGED');
  }
  if(operationError)throw operationError;
}
function main(){
  const mode=process.argv[2];
  if(process.argv.length!==3||
    !['--inspect','--rehearse'].includes(mode))
    throw Error('ONLY_INSPECT_OR_REHEARSE_SUPPORTED');
  if(process.platform!=='darwin')throw Error('MACOS_HOST_ONLY');
  verifySignedRelease();
  diskReadOnlyCheck();
  stageReceiptCheck();
  const live=JSON.parse(command('docker',['inspect',...ORIGINALS]));
  for(const c of live)candidateConfig(c);
  echo('EXTERNAL_UUID','PASS');
  echo('ORIGINAL_CONFIG_LOADED','PASS');
  echo('ENV_SECRETS_PRINTED','NO');
  echo('TARGET_BIND_PATH_COUNT','5');
  if(mode==='--inspect'){
    echo('RESULT','DIRECT_SSD_SPEC_READY_FOR_REHEARSAL');
    return;
  }
  rehearse().then(()=>{
    echo('ORIGINAL_CONTAINERS','UNCHANGED_RUNNING');
    echo('RESULT','DIRECT_SSD_CREATE_PARITY_PASS_NO_CUTOVER');
  }).catch(err=>{
    echo('STOP',err.message);process.exitCode=2;
  });
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  try{main();}
  catch(e){echo('STOP',String(e.message||'UNKNOWN'));process.exitCode=2;}
}
