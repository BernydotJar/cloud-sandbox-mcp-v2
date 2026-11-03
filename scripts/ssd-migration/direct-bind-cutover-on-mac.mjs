#!/usr/bin/env node
/**
 * macOS-only, reversible direct-bind cutover after verified temporary
 * Docker CREATE parity. No host symlink strategy. Never deletes
 * original data, Docker Desktop's disk image, or old containers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import console from 'node:console';
import http from 'node:http';
import {Buffer} from 'node:buffer';
import {spawn,spawnSync} from 'node:child_process';
import {setInterval,clearInterval} from 'node:timers';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {candidateConfig} from './direct-bind-rehearsal-on-mac.mjs';

export const UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
export const SSD='/Volumes/SSD';
export const ROOT=SSD+'/Sandbox';
export const DATA=ROOT+'/persistent/cloud-sandbox-mcp-data';
export const CODE=ROOT+'/source/cloud-sandbox-workstation';
export const WID='6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
export const NAMES=['cloud-sandbox-mcp','cloud-sandbox-dev-main'];
export const STATE=path.join(os.homedir(),
  '.local/share/sandbox-v3/ssd-direct-cutover-state.json');
const SOURCE=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const CONTROLLER=path.join(os.homedir(),
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const RELEASE_DIR=path.dirname(fileURLToPath(import.meta.url));
const BRIDGE='com.lch.cloud-sandbox.computer-use';
const BRIDGE_PLIST=path.join(os.homedir(),
  'Library/LaunchAgents/'+BRIDGE+'.plist');

function out(key,value){console.log('[SSD Direct Cutover] '+key+'='+String(value));}
function sha(raw){return crypto.createHash('sha256').update(raw).digest('hex');}
function regularFile(l){
  const s=fs.lstatSync(l);
  return s.isFile()&&!s.isSymbolicLink();
}
function own(l){
  return regularFile(l)&&fs.lstatSync(l).uid===process.getuid();
}
function verifyPackage(){
  const manifestPath=RELEASE_DIR+'/manifest.json';
  const digestPath=RELEASE_DIR+'/manifest.sha256';
  if(!regularFile(manifestPath)||!regularFile(digestPath))
    throw Error('CUTOVER_PACKAGE_TYPE_INVALID');
  const b=fs.readFileSync(manifestPath);
  if(b.length>32000||sha(b)!==fs.readFileSync(digestPath,'utf8').trim())
    throw Error('CUTOVER_PACKAGE_MANIFEST_TAMPERED');
  const m=JSON.parse(b);
  // One immutable release services BOTH the existing guarded CLI
  // upgrader and the direct bind cutover. The installer requires
  // sandbox-v3.primary-cli.v1, while the SSD operation is gated by
  // its own explicit identity flag and pinned APFS UUID.
  if(m.schema!=='sandbox-v3.primary-cli.v1'||
    m.ssd_direct_cutover_bundle!==true||
    m.primary_plugin!=='Sandbox_V3'||
    m.pinned_volume_uuid!==UUID||
    !m.files_sha256?.['direct-bind-cutover-on-mac.mjs'])
    throw Error('CUTOVER_PACKAGE_IDENTITY_WRONG');
  for(const [name,digest] of Object.entries(m.files_sha256)){
    if(!/^[A-Za-z0-9._-]{2,80}$/.test(name)||
      !/^[a-f0-9]{64}$/.test(digest)||
      !regularFile(RELEASE_DIR+'/'+name)||
      sha(fs.readFileSync(RELEASE_DIR+'/'+name))!==digest)
      throw Error('CUTOVER_PACKAGE_FILE_DRIFT:'+name);
  }
}
function run(bin,args,{input,timeout=26000}={}){
  const r=spawnSync(bin,args,{
    encoding:'utf8',timeout,input,maxBuffer:4_000_000,
    stdio:['pipe','pipe','pipe']
  });
  if(r.status!==0||r.error)
    throw Error('COMMAND_FAILED:'+path.basename(bin)+':'+args[0]);
  return String(r.stdout||'');
}
function volumeInfo(){
  const st=fs.lstatSync(SSD);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('SSD_NOT_MOUNTED');
  const plist=run('/usr/sbin/diskutil',['info','-plist',SSD]);
  const info=JSON.parse(run('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{input:plist}));
  const apfs=/(^|[^A-Z])APFS([^A-Z]|$)/i.test(
    String(info.FileSystemPersonality||'')+
    ' '+String(info.FilesystemType||''));
  const writable=(info.Writable===true||
    info.ReadOnlyVolume===false||info.VolumeReadOnly===false)&&
    info.ReadOnlyVolume!==true&&info.VolumeReadOnly!==true&&
    info.WriteProtected!==true&&info.ReadOnlyMedia!==true;
  if(!apfs||!writable||info.Internal!==false||
    info.MountPoint!==SSD||
    String(info.VolumeUUID||'').toUpperCase()!==UUID)
    throw Error('SSD_UUID_RW_APFS_MISMATCH');
  fs.accessSync(SSD,fs.constants.R_OK|fs.constants.W_OK);
}
function inspectDirs(){
  for(const loc of [ROOT,ROOT+'/persistent',ROOT+'/source',
    ROOT+'/reports',DATA,CODE,SOURCE,CONTROLLER]){
    const st=fs.lstatSync(loc);
    if(!st.isDirectory()||st.isSymbolicLink())
      throw Error('EXPECTED_PHYSICAL_DIRECTORY_UNAVAILABLE:'+
        path.basename(loc));
  }
  for(const loc of [ROOT,ROOT+'/persistent',ROOT+'/source',ROOT+'/reports']){
    if((fs.lstatSync(loc).mode&0o077)!==0)
      throw Error('PRIVATE_SSD_STAGING_PARENT_DRIFT');
  }
}
function stageIdentity(){
  const a=JSON.parse(fs.readFileSync(ROOT+'/.sandbox-v3-stage.json','utf8'));
  const b=JSON.parse(fs.readFileSync(ROOT+'/reports/staging-receipt.json','utf8'));
  if(a.schema!=='sandbox-v3.toshiba-stage.v1'||
    a.volumeUuid!==UUID||a.targetRoot!==ROOT||a.dataSource!==SOURCE||
    a.controllerSource!==CONTROLLER||a.canCutover!==false||
    b.operation!=='LIVE_STAGING_COPY_COMPLETED'||
    b.volumeUuid!==UUID||b.sourcePathsPreserved!==true||
    b.requireColdFinalSync!==true||b.migrationCutoverExecuted!==false||
    b.initialPersistentCopyXattrsFullyPreserved!==false)
    throw Error('PRIOR_STAGING_NOT_TRUSTED');
}
function existingState(){
  try{
    const st=fs.lstatSync(STATE);
    if(!st.isFile()||st.isSymbolicLink()||
      st.uid!==process.getuid()||(st.mode&0o077)!==0||
      st.size>20000)throw Error('DIRECT_STATE_FILE_UNTRUSTED');
    const item=JSON.parse(fs.readFileSync(STATE,'utf8'));
    if(item.schema!=='sandbox-v3.ssd-direct-cutover.v1'||
      item.ssdUuid!==UUID)
      throw Error('DIRECT_STATE_SCHEMA_MISMATCH');
    return item;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function atomic(file,contents){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.new-'+crypto.randomUUID();
  try{
    fs.writeFileSync(tmp,contents,{flag:'wx',mode:0o600});
    fs.renameSync(tmp,file);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function persist(s){
  atomic(STATE,JSON.stringify({
    schema:'sandbox-v3.ssd-direct-cutover.v1',
    ...s
  },null,2)+'\n');
}
function guardedCli(){
  const filename=path.join(os.homedir(),
    '.local/share/sandbox-v3/cli.mjs');
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||
    !fs.readFileSync(filename,'utf8').includes('directSSDPreStartupGuard()')||
    !fs.readFileSync(filename,'utf8').includes('verifyDirectDockerMounts()'))
    throw Error('CANONICAL_SANDBOX_DIRECT_GUARD_UPGRADE_REQUIRED');
  const record=path.join(os.homedir(),
    '.local/share/sandbox-v3/install-record.json');
  if(!own(record))throw Error('SANDBOX_INSTALL_RECORD_NOT_TRUSTED');
  const expected=JSON.parse(fs.readFileSync(record,'utf8')).cli_sha256;
  if(sha(fs.readFileSync(filename))!==expected)
    throw Error('SANDBOX_INSTALLED_GUARD_HASH_DRIFT');
}
function originalEnv(){
  const env=fs.readFileSync(CONTROLLER+'/.env','utf8');
  const matches=env.split(/\r?\n/).filter(x=>/^HOST_DATA_DIR\s*=/.test(x));
  if(matches.length!==1)throw Error('CONTROLLER_DATA_ROOT_ENV_UNEXPECTED');
  const value=matches[0].replace(/^HOST_DATA_DIR\s*=\s*/,'')
    .trim().replace(/^(['"])(.*)\1$/,'$2');
  if(value!==SOURCE)throw Error('CONTROLLER_DATA_ROOT_ENV_DRIFT');
}
function bridgeLoaded(){
  const r=spawnSync('/bin/launchctl',
    ['print','gui/'+process.getuid()+'/'+BRIDGE],{
      encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']
    });
  return r.status===0&&!r.error;
}
function checkBridgePlist(){
  const st=fs.lstatSync(BRIDGE_PLIST);
  if(!st.isFile()||st.isSymbolicLink()||
    st.uid!==process.getuid())throw Error('MAC_BRIDGE_PLIST_UNTRUSTED');
  const info=JSON.parse(run('/usr/bin/plutil',
    ['-convert','json','-o','-',BRIDGE_PLIST]));
  if(info.Label!==BRIDGE)throw Error('MAC_BRIDGE_LABEL_MISMATCH');
}
function bridgeStop(s){
  if(s.bridgeLoaded&&bridgeLoaded()){
    run('/bin/launchctl',['bootout',
      'gui/'+process.getuid()+'/'+BRIDGE]);
    out('MAC_BRIDGE','PAUSED');
  }
}
function bridgeRestore(s){
  if(s.bridgeLoaded&&!bridgeLoaded()){
    checkBridgePlist();
    run('/bin/launchctl',
      ['bootstrap','gui/'+process.getuid(),BRIDGE_PLIST]);
    out('MAC_BRIDGE','RESTORED');
  }
}
function engineContext(){
  const value=run('docker',['context','inspect',
    '--format','{{.Endpoints.docker.Host}}']).trim();
  if(!value.startsWith('unix://'))throw Error('DOCKER_LOCAL_SOCKET_REQUIRED');
  const socketPath=value.slice(7);
  if(!fs.statSync(socketPath).isSocket())
    throw Error('DOCKER_LOCAL_SOCKET_NOT_VALID');
  const apiVersion=run('docker',['version','--format',
    '{{.Server.APIVersion}}']).trim();
  if(!/^\d+\.\d+$/.test(apiVersion))
    throw Error('DOCKER_ENGINE_VERSION_UNAVAILABLE');
  return {socketPath,apiVersion};
}
export async function call(ctx,method,route,body=null,timeout=45000){
  return await new Promise((resolve,reject)=>{
    const req=http.request({
      socketPath:ctx.socketPath,
      method,path:'/v'+ctx.apiVersion+route,
      timeout,
      headers:{'Content-Type':'application/json'}
    },res=>{
      const chunks=[];
      res.on('data',b=>chunks.push(b));
      res.on('end',()=>{
        if(res.statusCode>=400){
          // Never echo env, port, source, or plugin secrets.
          reject(Error('ENGINE_HTTP_'+method+'_'+res.statusCode));
          return;
        }
        try{
          const text=Buffer.concat(chunks).toString('utf8');
          resolve(text?JSON.parse(text):{});
        }catch{reject(Error('ENGINE_RESPONSE_INVALID_JSON'));}
      });
    });
    req.on('timeout',()=>req.destroy(Error('ENGINE_TIMEOUT_'+method)));
    req.on('error',reject);
    if(body===null)req.end();
    else req.end(JSON.stringify(body));
  });
}
async function current(ctx,id){
  return await call(ctx,'GET',
    '/containers/'+encodeURIComponent(id)+'/json');
}
function namesFromInspect(inspect){
  const original={};
  for(const name of NAMES){
    const c=inspect.find(v=>v.Name==='/'+name);
    if(!c)throw Error('REQUIRED_RUNNING_CONTAINER_MISSING:'+name);
    original[name]=c;
  }
  return original;
}
async function validateContext(ctx){
  const engine=await call(ctx,'GET','/info');
  const cli=run('docker',['info','--format','{{.ID}}']).trim();
  if(!cli||engine.ID!==cli)
    throw Error('CLI_AND_API_ENGINE_IDENTITY_MISMATCH');
}
function futureBackupName(name,runId){
  return 'ssd-old-'+name+'-'+runId;
}
export function allowlistedBackupName(name){
  return /^ssd-old-cloud-sandbox-(mcp|dev-main)-[a-f0-9]{12}$/.test(name);
}
export function updateControllerHostDataEnv(config,originalConfig){
  const env=config?.Env;
  const baseline=originalConfig?.Env;
  if(!Array.isArray(env)||!Array.isArray(baseline)||
    JSON.stringify(env)!==JSON.stringify(baseline))
    throw Error('CONTROLLER_ENV_BASELINE_DRIFT');
  let changed=0;
  const rewritten=env.map(row=>{
    if(typeof row!=='string'||!row.startsWith('HOST_DATA_DIR='))
      return row;
    if(row.slice('HOST_DATA_DIR='.length)!==SOURCE)
      throw Error('CONTROLLER_HOST_DATA_DIR_NOT_MAC_ORIGINAL');
    changed++;
    return 'HOST_DATA_DIR='+DATA;
  });
  if(changed!==1)throw Error('CONTROLLER_HOST_DATA_DIR_EXPECTED_ONCE');
  return {...config,Env:rewritten};
}
function verifyControllerHostDataEnv(newConfig,oldConfig){
  const expect=updateControllerHostDataEnv(oldConfig,oldConfig);
  if(JSON.stringify(newConfig?.Env)!==JSON.stringify(expect.Env))
    throw Error('MIGRATED_CONTROLLER_ENV_CHANGED_BEYOND_HOST_DATA_DIR');
}
export function validateJournal(s){
  if(!s||s.schema!=='sandbox-v3.ssd-direct-cutover.v1'||
    s.ssdUuid!==UUID||!Array.isArray(s.originals))
    throw Error('DIRECT_CUTOVER_JOURNAL_INVALID');
  if(s.originals.length!==2||
    new Set(s.originals.map(c=>c.name)).size!==2||
    s.originals.some(c=>
      !NAMES.includes(c.name)||!/^sha256:[a-f0-9]{64}$/.test(c.imageId)||
      !/^[a-f0-9]{64}$/.test(c.id)||!allowlistedBackupName(c.backupName)||
      !['no','unless-stopped','always','on-failure'].includes(c.restartPolicy)))
    throw Error('DIRECT_CUTOVER_ORIGINAL_RECORD_UNTRUSTED');
}
function preflight(){
  if(process.platform!=='darwin')throw Error('MACOS_OPERATOR_REQUIRED');
  verifyPackage();volumeInfo();inspectDirs();stageIdentity();
  guardedCli();originalEnv();
  const past=existingState();
  if(past&&past.phase!=='ROLLBACK_COMPLETE')
    throw Error('PRIOR_DIRECT_CUTOVER_STATE_EXISTS_DO_NOT_REPEAT');
  const live=JSON.parse(run('docker',['inspect',...NAMES]));
  const original=namesFromInspect(live);
  for(const c of Object.values(original)){
    const plan=candidateConfig(c);
    if(c.Name==='/cloud-sandbox-mcp'){
      // Before any downtime or long rsync, refuse controllers whose
      // new workspace creation would still target the internal Mac.
      updateControllerHostDataEnv(plan.body,c.Config);
    }
  }
  const activeBridge=bridgeLoaded();
  if(activeBridge)checkBridgePlist();
  return {live,original,activeBridge};
}
async function preflightAsync(){
  const base=preflight();
  const ctx=engineContext();
  await validateContext(ctx);
  return {...base,ctx};
}

export async function stopDocker(ctx,id){
  try{
    await call(ctx,'POST','/containers/'+id+'/stop?t=120',null,170000);
  }catch(e){
    // Engine can return an error after a successful stop. Ground the
    // result in the actual current running state, not in CLI exit.
    const c=await current(ctx,id);
    if(c.State?.Running===true)throw e;
  }
  if((await current(ctx,id)).State?.Running)
    throw Error('CONTAINER_NOT_STOPPED:'+id.slice(0,12));
}
export async function startDocker(ctx,id){
  const was=await current(ctx,id);
  if(!was.State?.Running){
    await call(ctx,'POST','/containers/'+id+'/start',null,130000);
  }
  const now=await current(ctx,id);
  if(!now.State?.Running)throw Error('CONTAINER_NOT_RUNNING_AFTER_START');
}
export async function restartPolicy(ctx,id,policy){
  if(!['no','unless-stopped','always','on-failure'].includes(policy))
    throw Error('UNTRUSTED_RESTART_POLICY');
  await call(ctx,'POST','/containers/'+id+'/update',
    {RestartPolicy:{Name:policy}});
}
export async function renameDocker(ctx,id,name){
  if(!allowlistedBackupName(name)&&!NAMES.includes(name))
    throw Error('UNTRUSTED_RENAME_DESTINATION');
  await call(ctx,'POST',
    '/containers/'+id+'/rename?name='+encodeURIComponent(name));
}
export async function removeNewCandidate(ctx,name,originalId){
  let candidate;
  try{candidate=await current(ctx,name);}
  catch(e){if(e.message==='ENGINE_HTTP_GET_404')return;throw e;}
  if(candidate.Id===originalId)return; // original never renamed
  const original=await current(ctx,originalId);
  if(candidate.Image!==original.Image)
    throw Error('UNRELATED_CONTAINER_HAS_CANONICAL_NAME:'+name);
  const expected=name==='cloud-sandbox-mcp'?
    {'/data':DATA}:{
      '/workspace':DATA+'/workspaces/'+WID+'/repo',
      '/home/agent':DATA+'/workspaces/'+WID+'/home',
      '/shared-auth':DATA+'/shared-auth',
      '/var/lib/docker':DATA+'/workspaces/'+WID+'/docker'
    };
  for(const [destination,source] of Object.entries(expected)){
    if(!candidate.Mounts?.some(m=>m.Destination===destination&&
      m.Source===source&&m.Type==='bind'))
      throw Error('CANDIDATE_IDENTITY_NOT_PROVABLE:'+name);
  }
  if(candidate.State?.Running)await stopDocker(ctx,candidate.Id);
  await call(ctx,'DELETE',
    '/containers/'+encodeURIComponent(candidate.Id)+'?force=1');
}
async function restoreOriginalNames(ctx,s){
  for(const old of s.originals){
    const original=await current(ctx,old.id);
    if(original.Name==='/'+old.name)continue;
    if(original.Name!=='/'+old.backupName)
      throw Error('ORIGINAL_BACKUP_IDENTITY_DRIFT:'+old.name);
    await renameDocker(ctx,old.id,old.name);
  }
}
function nestedIds(){
  const list=run('docker',['exec','cloud-sandbox-dev-main',
    'docker','ps','-q'],{timeout:35000}).trim();
  const ids=list?list.split(/\s+/):[];
  if(ids.some(x=>!/^[a-f0-9]{12,64}$/.test(x)))
    throw Error('INNER_DOCKER_CONTAINER_IDS_UNEXPECTED');
  return ids;
}
function nestedStop(ids){
  if(!ids.length)return;
  try{
    run('docker',['exec','cloud-sandbox-dev-main','docker','stop',
      '--time','75',...ids],{timeout:190000});
  }catch{
    const now=new Set(nestedIds());
    if(ids.some(x=>now.has(x)))
      throw Error('INNER_DOCKER_ACTIVE_CONTAINERS_DID_NOT_QUIESCE');
  }
}
async function retryExec(exe,args,{maxAttempts=14,timeout=15000}={}){
  for(let i=0;i<maxAttempts;i++){
    try{return run(exe,args,{timeout});}
    catch(e){if(i===maxAttempts-1)throw e;await sleep(3500);}
  }
  throw Error('UNREACHABLE');
}
async function nestedRestore(ids){
  if(!ids?.length)return;
  await retryExec('docker',['exec','cloud-sandbox-dev-main',
    'docker','info','--format','{{.ServerVersion}}'],
  {maxAttempts:17,timeout:20000});
  for(const id of ids){
    // Fails closed if an inner container disappeared after data migration.
    const v=run('docker',['exec','cloud-sandbox-dev-main',
      'docker','inspect','--format','{{.State.Running}}',id],
    {timeout:35000}).trim();
    if(v==='false')
      run('docker',['exec','cloud-sandbox-dev-main',
        'docker','start',id],{timeout:65000});
    else if(v!=='true')throw Error('INNER_CONTAINER_INVALID_STATE');
  }
}
export function syncArgs(source,dest,{persistent}){
  if(!((persistent&&source===SOURCE&&dest===DATA)||
    (!persistent&&source===CONTROLLER&&dest===CODE)))
    throw Error('RSYNC_SOURCE_OR_SSD_TARGET_NOT_ALLOWLISTED');
  const args=[persistent?'-aH':'-aEH','--delete','--stats'];
  if(persistent)args.push('--delete-excluded',
    '--exclude=/workspaces/'+WID+'/home/.cache/uv/');
  return [...args,'--',source+'/',dest+'/'];
}
async function syncOne(source,dest,{persistent}){
  const name=persistent?'persistent':'controller';
  const log=ROOT+'/reports/direct-bind-final-'+name+'.private.log';
  const stat=fs.lstatSync(ROOT+'/reports');
  if(!stat.isDirectory()||stat.isSymbolicLink()||
    (stat.mode&0o077)!==0)
    throw Error('PRIVATE_SYNC_LOG_DIRECTORY_UNTRUSTED');
  const fd=fs.openSync(log,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
  const commandLine=persistent?'/usr/bin/sudo':'/usr/bin/rsync';
  const args=persistent?
    ['-n','/usr/bin/rsync',...syncArgs(source,dest,{persistent})]:
    syncArgs(source,dest,{persistent});
  const began=Date.now();
  let child;
  try{
    const result=await new Promise((resolve,reject)=>{
      child=spawn(commandLine,args,{stdio:['ignore',fd,fd]});
      const tick=setInterval(()=>{
        out('COLD_SYNC_ACTIVE',name+' ELAPSED_MINUTES='+
          Math.floor((Date.now()-began)/60000));
      },30000);
      child.on('error',err=>{clearInterval(tick);reject(err);});
      child.on('close',code=>{clearInterval(tick);resolve(code);});
    });
    if(result!==0)
      throw Error('FINAL_RSYNC_FAILED:'+name+':EXIT_'+result+
        ':CHECK_PRIVATE_SSD_LOG');
  }finally{fs.closeSync(fd);}
  out('FINAL_RSYNC_'+name.toUpperCase(),'PASS');
}
function probeRead(name,mount,relative){
  const dir=path.join(DATA,relative);
  const target=path.join(dir,'.ssd-direct-read-'+crypto.randomUUID());
  const text=crypto.randomBytes(15).toString('hex');
  fs.writeFileSync(target,text,{mode:0o600,flag:'wx'});
  try{
    const got=run('docker',['exec',name,'cat',
      mount+'/'+path.basename(target)]).trim();
    if(got!==text)
      throw Error('SSD_PHYSICAL_READ_PROBE_FAILED:'+name+':'+mount);
  }finally{fs.unlinkSync(target);}
}
function probeContainerWrite(){
  const filename='.ssd-direct-container-'+crypto.randomUUID();
  const content=crypto.randomBytes(16).toString('hex');
  const dest=DATA+'/shared-auth/'+filename;
  try{
    run('docker',['exec','cloud-sandbox-dev-main','sh','-c',
      'printf %s "$1" > "$2"','sh',content,'/shared-auth/'+filename],
    {timeout:22000});
    if(fs.readFileSync(dest,'utf8')!==content)
      throw Error('SSD_CONTAINER_WRITE_PROBE_FAILED');
  }finally{if(fs.existsSync(dest))fs.unlinkSync(dest);}
}
export function verifyRuntimeParity(old,newContainer,{controller=false}={}){
  if(newContainer.Image!==old.Image)
    throw Error('SSD_RUNTIME_IMAGE_ID_DRIFT');
  if(old.HostConfig?.Privileged!==newContainer.HostConfig?.Privileged||
    old.HostConfig?.NetworkMode!==newContainer.HostConfig?.NetworkMode)
    throw Error('SSD_RUNTIME_PRIVILEGE_OR_NETWORK_DRIFT');
  const exact=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  for(const key of ['Memory','NanoCpus','PidsLimit','IpcMode',
    'CgroupnsMode','PidMode','SecurityOpt','CapAdd','CapDrop',
    'Runtime','PortBindings','LogConfig','ShmSize']){
    if(!exact(old.HostConfig?.[key],newContainer.HostConfig?.[key]))
      throw Error('SSD_RUNTIME_HOST_FLAG_DRIFT:'+key);
  }
  for(const key of ['Cmd','Entrypoint','User','WorkingDir','Labels']){
    if(!exact(old.Config?.[key],newContainer.Config?.[key]))
      throw Error('SSD_RUNTIME_CONFIG_DRIFT:'+key);
  }
  if(controller)
    verifyControllerHostDataEnv(newContainer.Config,old.Config);
  else if(!exact(old.Config?.Env,newContainer.Config?.Env))
    throw Error('SSD_WORKER_SECRET_ENV_DRIFT');
  for(const o of old.Mounts||[]){
    if(['/data','/workspace','/home/agent',
      '/shared-auth','/var/lib/docker'].includes(o.Destination))continue;
    const m=(newContainer.Mounts||[]).find(x=>
      x.Destination===o.Destination);
    if(!m||m.Source!==o.Source||m.RW!==o.RW||m.Type!==o.Type)
      throw Error('SSD_EXTRA_BIND_LOST:'+o.Destination);
  }
  return true;
}
export function verifyNewMounts(containers){
  const expected={
    'cloud-sandbox-mcp':{'/data':DATA},
    'cloud-sandbox-dev-main':{
      '/workspace':DATA+'/workspaces/'+WID+'/repo',
      '/home/agent':DATA+'/workspaces/'+WID+'/home',
      '/shared-auth':DATA+'/shared-auth',
      '/var/lib/docker':DATA+'/workspaces/'+WID+'/docker'
    }
  };
  for(const [name,mounts] of Object.entries(expected)){
    const c=containers.find(v=>v.Name==='/'+name);
    if(!c||!c.State?.Running)
      throw Error('NEW_DIRECT_SSD_CONTAINER_NOT_RUNNING:'+name);
    for(const [dest,source] of Object.entries(mounts)){
      const m=c.Mounts?.find(x=>x.Destination===dest);
      if(!m||m.Source!==source||m.Type!=='bind'||!m.RW)
        throw Error('NEW_SSD_BIND_SOURCE_MISMATCH:'+name+':'+dest);
    }
    if(c.HostConfig.RestartPolicy.Name!=='no')
      throw Error('NEW_SSD_RESTART_POLICY_UNGUARDED');
  }
  const worker=containers.find(c=>c.Name==='/cloud-sandbox-dev-main');
  const networks=Object.keys(worker.NetworkSettings.Networks||{}).sort();
  if(JSON.stringify(networks)!==
    JSON.stringify(['bridge','cloud-sandbox-edge']))
    throw Error('NEW_WORKSTATION_SECONDARY_NETWORK_MISSING');
}
async function checkAppHealth(){
  await retryExec('docker',['exec','cloud-sandbox-dev-main',
    'docker','info','--format','{{.ServerVersion}}'],
  {maxAttempts:18,timeout:22000});
  await retryExec('docker',['exec','cloud-sandbox-mcp','node','-e',
    "fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(4000)})"+
    ".then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
  {maxAttempts:18,timeout:12000});
  probeRead('cloud-sandbox-mcp','/data/shared-auth','shared-auth');
  probeRead('cloud-sandbox-dev-main','/shared-auth','shared-auth');
  // These three may be root-owned or special nested Docker storage;
  // validate their direct bind sources from inspect and test mounted
  // directories without creating host files inside them.
  for(const mount of ['/workspace','/home/agent','/var/lib/docker']){
    run('docker',['exec','cloud-sandbox-dev-main',
      'test','-d',mount],{timeout:17000});
  }
  probeContainerWrite();
}

async function checkOriginalRestoration(ctx,s){
  const inspected=[];
  for(const item of s.originals){
    const live=await current(ctx,item.id);
    if(live.Name!=='/'+item.name||!live.State.Running)
      throw Error('RESTORED_ORIGINAL_CONTAINER_NOT_RUNNING:'+item.name);
    if(live.HostConfig.RestartPolicy.Name!==item.restartPolicy)
      throw Error('RESTORED_RESTART_POLICY_MISMATCH:'+item.name);
    inspected.push(live);
  }
  const sourceMounts={
    'cloud-sandbox-mcp':{'/data':SOURCE},
    'cloud-sandbox-dev-main':{
      '/workspace':SOURCE+'/workspaces/'+WID+'/repo',
      '/home/agent':SOURCE+'/workspaces/'+WID+'/home',
      '/shared-auth':SOURCE+'/shared-auth',
      '/var/lib/docker':SOURCE+'/workspaces/'+WID+'/docker'
    }
  };
  for(const c of inspected){
    const name=c.Name.slice(1);
    if(name==='cloud-sandbox-dev-main'){
      const networks=Object.keys(c.NetworkSettings?.Networks||{}).sort();
      if(JSON.stringify(networks)!==
        JSON.stringify(['bridge','cloud-sandbox-edge']))
        throw Error('RESTORED_WORKER_SECONDARY_NETWORK_MISSING');
    }
    for(const [dest,source] of Object.entries(sourceMounts[name])){
      const mount=c.Mounts.find(m=>m.Destination===dest);
      if(!mount||mount.Source!==source)
        throw Error('RESTORED_ORIGINAL_BIND_DRIFT:'+name+':'+dest);
    }
  }
}
async function restore(s,ctx){
  const issues=[];
  async function attempt(phase,fn){
    try{await fn();}
    catch(e){issues.push(phase+':'+String(e.message||'ERROR').slice(0,140));}
  }
  // Preserve copies of ALL modified files on SSD, including possible
  // writes by started candidates. Remove only newly created containers.
  for(const name of NAMES){
    const old=s.originals.find(v=>v.name===name);
    await attempt('NEW_CANDIDATE_STOP_REMOVE:'+name,
      async()=>await removeNewCandidate(ctx,name,old.id));
  }
  await attempt('RESTORE_ORIGINAL_CONTAINER_NAMES',async()=>
    await restoreOriginalNames(ctx,s));
  for(const item of s.originals){
    await attempt('START_OLD:'+item.name,
      async()=>await startDocker(ctx,item.id));
    await attempt('RESTORE_POLICY:'+item.name,
      async()=>await restartPolicy(ctx,item.id,item.restartPolicy));
  }
  await attempt('RESTORE_INNER_WORKLOADS',
    async()=>await nestedRestore(s.nestedIds||[]));
  await attempt('RESTORE_MAC_BRIDGE',async()=>bridgeRestore(s));
  await attempt('INDEPENDENT_ORIGINAL_VERIFY',
    async()=>await checkOriginalRestoration(ctx,s));
  if(issues.length){
    persist({...s,phase:'ROLLBACK_INCOMPLETE',issues});
    out('ROLLBACK','INCOMPLETE');
    out('RECOVERY_STATE',STATE);
    // Never print potentially credential-bearing Docker daemon responses.
    out('ROLLBACK_ERRORS',issues.join('|'));
    return false;
  }
  persist({...s,phase:'ROLLBACK_COMPLETE',restoredAt:new Date().toISOString()});
  out('ROLLBACK','ORIGINAL_CONTAINERS_RUNNING_AND_BINDS_VERIFIED');
  out('SSD_DATA','PRESERVED_NOT_DELETED');
  return true;
}
async function manualRecovery(){
  if(process.platform!=='darwin')
    throw Error('MACOS_OPERATOR_REQUIRED');
  verifyPackage();
  const s=existingState();
  validateJournal(s);
  if(s.phase==='SUCCEEDED')
    throw Error('POST_SUCCESS_ROLLBACK_REQUIRES_DATA_RECONCILIATION');
  if(s.phase==='ROLLBACK_COMPLETE'){
    out('RESULT','ALREADY_RESTORED_NO_MUTATIONS');
    return;
  }
  const ctx=engineContext();
  await validateContext(ctx);
  if(!await restore(s,ctx))
    throw Error('ROLLBACK_INCOMPLETE_REVIEW_JOURNAL');
  out('RESULT','ORIGINALS_RESTORED');
}
function makeState(base,runId,nested){
  const s={
    schema:'sandbox-v3.ssd-direct-cutover.v1',
    ssdUuid:UUID,
    phase:'PREPARED',
    runId,createdAt:new Date().toISOString(),
    bridgeLoaded:base.activeBridge,
    nestedIds:nested,
    originals: NAMES.map(name=>{
      const c=base.original[name];
      const backupName=futureBackupName(name,runId);
      if(!allowlistedBackupName(backupName))
        throw Error('GENERATED_BACKUP_NAME_REJECTED');
      return {
        name,id:c.Id,imageId:c.Image,
        backupName,restartPolicy:c.HostConfig.RestartPolicy.Name||'no'
      };
    })
  };
  validateJournal(s);
  return s;
}
async function activation(){
  const base=await preflightAsync();
  out('PREFLIGHT','PASS');
  out('SSD_UUID','PASS');
  out('REHEARSED_DIRECT_BINDS','5');
  // Verify access to the nested daemon BEFORE touching any workloads.
  const activeInner=nestedIds();
  const sudo=spawnSync('/usr/bin/sudo',['-v'],{
    stdio:'inherit',timeout:120000
  });
  if(sudo.status!==0||sudo.error)
    throw Error('SUDO_AUTHENTICATION_FAILED_NO_DOWNTIME');
  const id=crypto.randomBytes(6).toString('hex');
  const s=makeState(base,id,activeInner);
  persist(s);
  const ctx=base.ctx;
  try{
    // Disable automatic starts during the transition; the updated
    // canonical CLI now checks the state and SSD UUID first.
    for(const old of s.originals)
      await restartPolicy(ctx,old.id,'no');
    s.phase='RESTART_POLICIES_GUARDED';persist(s);
    bridgeStop(s);
    s.phase='MAC_BRIDGE_QUIESCED';persist(s);
    nestedStop(s.nestedIds);
    s.phase='INNER_CONTAINERS_STOPPED';persist(s);
    await stopDocker(ctx,base.original['cloud-sandbox-dev-main'].Id);
    await stopDocker(ctx,base.original['cloud-sandbox-mcp'].Id);
    s.phase='MAC_DOCKER_CONTAINERS_STOPPED';persist(s);
    out('WRITERS','QUIESCED');

    // Persisted staging was populated earlier. The final rsync
    // reconciles only changed content and deletes stale entries on
    // the SSD TARGET LEAVES (not on the original Mac).
    s.phase='COLD_SYNC_RUNNING';persist(s);
    await syncOne(SOURCE,DATA,{persistent:true});
    await syncOne(CONTROLLER,CODE,{persistent:false});
    s.phase='COLD_SYNC_FINISHED';persist(s);

    // Capture candidates from the original, previously audited inspect,
    // not from guessed Compose defaults or mutable image tags.
    const items=NAMES.map(name=>{
      const original=base.original[name];
      const candidate=candidateConfig(original);
      if(name==='cloud-sandbox-mcp'){
        // Necessary for future workspace creation and /shared-auth:
        // DockerRuntime uses process.env.HOST_DATA_DIR as a host path.
        // Rewrite exactly this ONE non-secret variable; preserve all
        // credential-bearing values byte-for-byte in memory.
        const rewritten=updateControllerHostDataEnv(
          candidate.body,original.Config);
        candidate.body.Env=rewritten.Env;
      }
      return {original,candidate};
    });
    for(const old of s.originals){
      await renameDocker(ctx,old.id,old.backupName);
      s.phase='ORIGINALS_RENAMED';persist(s);
    }
    out('OLD_CONTAINERS','STOPPED_RENAMED_PRESERVED');

    // Docker Engine creates new canonical names with SSD paths; old
    // container IDs and original Mac files are still preserved.
    for(const item of items){
      const spec=item.candidate;
      const created=await call(ctx,'POST',
        '/containers/create?name='+encodeURIComponent(spec.name),
        spec.body,125000);
      if(!/^[a-f0-9]{64}$/.test(created.Id||''))
        throw Error('NEW_CONTAINER_ID_NOT_RECEIVED:'+spec.name);
      s.phase='CREATING_NEW_CONTAINERS';persist(s);
      const inspect=await current(ctx,created.Id);
      if(inspect.Image!==item.original.Image)
        throw Error('NEW_CONTAINER_IMAGE_ID_CHANGED');
      if(spec.name==='cloud-sandbox-mcp')
        verifyControllerHostDataEnv(inspect.Config,item.original.Config);
      else if(JSON.stringify(inspect.Config.Env)!==
        JSON.stringify(item.original.Config.Env))
        throw Error('WORKSTATION_ENV_PARITY_FAILED');
      out('NEW_CONTAINER_CREATED',spec.name);
    }

    const worker=await current(ctx,'cloud-sandbox-dev-main');
    await startDocker(ctx,worker.Id);
    // Older Docker Engine may not allow an extra network on a stopped
    // container. Connect only AFTER the worker has started.
    const workerPlan=items.find(x=>
      x.candidate.name==='cloud-sandbox-dev-main').candidate;
    for(const secondary of workerPlan.secondary){
      if(secondary.network!=='cloud-sandbox-edge')
        throw Error('UNEXPECTED_SECONDARY_NETWORK_NAME');
      await call(ctx,'POST','/networks/'+
        encodeURIComponent(secondary.network)+'/connect',{
        Container:worker.Id,EndpointConfig:secondary.endpoint
      },80000);
    }
    s.phase='WORKER_RUNNING_DUAL_NETWORK';persist(s);
    await retryExec('docker',['exec','cloud-sandbox-dev-main',
      'docker','info','--format','{{.ServerVersion}}'],
    {maxAttempts:18,timeout:22000});
    await nestedRestore(s.nestedIds);
    const controller=await current(ctx,'cloud-sandbox-mcp');
    await startDocker(ctx,controller.Id);
    s.phase='NEW_CONTAINERS_RUNNING';persist(s);

    const live=[];
    for(const name of NAMES)live.push(await current(ctx,name));
    verifyNewMounts(live);
    for(const item of items){
      const candidate=live.find(x=>x.Name==='/'+item.candidate.name);
      verifyRuntimeParity(item.original,candidate,
        {controller:item.candidate.name==='cloud-sandbox-mcp'});
    }
    await checkAppHealth();
    bridgeRestore(s);
    s.phase='VALIDATED';persist(s);
    out('SSD_PHYSICAL_READ_WRITE','PASS');
    out('WORKSTATION_TWO_NETWORKS','PASS');
    out('CONTAINER_HEALTH_AND_NESTED_DOCKER','PASS');

    // The originals stay stopped on the Mac's old bind sources.
    // Do NOT update Compose files until their override parity is
    // independently checked; do not use docker compose up/down yet.
    s.phase='SUCCEEDED';
    s.finishedAt=new Date().toISOString();
    s.newContainerIds=NAMES.map(name=>{
      const c=live.find(x=>x.Name==='/'+name);
      return {name,id:c.Id};
    });
    persist(s);
    atomic(ROOT+'/reports/direct-bind-cutover-receipt.json',JSON.stringify({
      schema:'sandbox-v3.ssd-direct-cutover-receipt.v1',
      result:'DIRECT_SSD_BIND_CUTOVER_PASSED',
      ssdUuid:UUID,at:s.finishedAt,
      sourceRootPreserved:true,oldContainersPreserved:true,
      controllerDataBindOnExternalSSD:true,
      fourWorkstationDataBindsOnExternalSSD:true,
      dockerInternalDaemonVerified:true,
      hostAndContainerDataReadWriteVerified:true,
      workerSecondaryNetworkVerified:true,
      originalComposeFilesNotModified:true,
      dockerDesktopDiskImageNotMoved:true,
      metadataAclXattrParityPending:true,
      explicitDeletionPermission:false
    },null,2)+'\n');
    out('RESULT','DIRECT_SSD_BIND_CUTOVER_PASSED');
    out('ORIGINAL_CONTAINERS','BACKED_UP_STOPPED');
    out('ORIGINAL_MAC_DIRECTORIES','INTACT');
    out('DOCKER_RAW','STILL_INTERNAL_SEPARATE_GUI_STEP');
    out('COMPOSE_REDEPLOY','BLOCKED_UNTIL_OVERRIDE_PARITY_REVIEW');
    out('DELETE_MAC_DATA','NO');
  }catch(e){
    out('STOP',String(e.message||'UNKNOWN').slice(0,150));
    const recovered=await restore(s,ctx);
    if(!recovered)throw Error('CUTOVER_AND_ROLLBACK_FAILED');
    throw Error('CUTOVER_FAILED_ROLLBACK_PASS_NO_SOURCE_DELETION');
  }
}
async function main(){
  const mode=process.argv[2];
  if(process.argv.length!==3||
    !['--inspect','--activate','--rollback'].includes(mode))
    throw Error('USAGE_INSPECT_ACTIVATE_OR_ROLLBACK');
  if(mode==='--rollback'){await manualRecovery();return;}
  if(mode==='--inspect'){
    await preflightAsync();
    out('SSD_UUID','PASS');
    out('CONTAINER_IDS','VERIFIED');
    out('DIRECT_BIND_SPECS','READY');
    out('RESTART_POLICY','TEMPORARILY_GUARDED_DURING_ACTIVATION');
    out('DATA_OR_DOCKER_MODIFIED','NO');
    out('COLD_DELTA_SYNC','REQUIRED_UNTIL_COPY_CONSISTENT');
    out('RESULT','DIRECT_SSD_CUTOVER_PREFLIGHT_PASS');
    return;
  }
  // Activation repeats and re-verifies preflight immediately before
  // action. A daemon restart or spec drift between calls is rejected.
  await activation();
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  main().catch(e=>{
    out('STOP',String(e.message||'UNKNOWN').slice(0,180));
    process.exitCode=2;
  });
}
