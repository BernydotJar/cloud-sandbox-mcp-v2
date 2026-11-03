#!/usr/bin/env node
/**
 * Mac Docker Engine startup diagnosis of original workstation runtime
 * with SSD bind mounts. Creates ONLY inert, short-lived candidates.
 * IMPORTANT: full original HostConfig.Privileged is necessary for
 * matching start behavior; PID1 deliberately replaced by sleep.
 * Does not stop or modify original running containers or Mac data.
 */
import fs from 'node:fs';
import os from 'node:os';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import http from 'node:http';
import {Buffer} from 'node:buffer';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {candidateConfig} from './direct-bind-rehearsal-on-mac.mjs';

const DISK='/Volumes/SSD';
const UUID='A6268296-0330-4A69-9BE3-059BE8E4016A';
const SOURCE=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const DATA=DISK+'/Sandbox/persistent/cloud-sandbox-mcp-data';
const WID='6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
const RELEASE_DIR=path.dirname(fileURLToPath(import.meta.url));
const JOURNAL=path.join(os.homedir(),
  '.local/share/sandbox-v3/ssd-direct-cutover-state.json');
const TARGET='cloud-sandbox-dev-main';
const SAFE_PREFIX='ssd-prestart-';
const say=(key,value)=>console.log('[SSD Worker Prestart] '+key+'='+value);
const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
function run(bin,args,{input}={}){
  const r=spawnSync(bin,args,{
    input,encoding:'utf8',timeout:16000,maxBuffer:3_000_000,
    stdio:['pipe','pipe','pipe']
  });
  if(r.status!==0||r.error)
    throw Error('LOCAL_COMMAND_FAILED:'+path.basename(bin)+':'+args[0]);
  return r.stdout;
}
function releaseCheck(){
  const manifestPath=RELEASE_DIR+'/manifest.json';
  const digestPath=RELEASE_DIR+'/manifest.sha256';
  const mBytes=fs.readFileSync(manifestPath);
  const digest=fs.readFileSync(digestPath,'utf8').trim();
  if(hash(mBytes)!==digest)
    throw Error('SIGNED_DIAGNOSTIC_MANIFEST_MISMATCH');
  const m=JSON.parse(mBytes.toString('utf8'));
  if(m.schema!=='sandbox-v3.ssd-worker-prestart.v1'||
    m.pinned_volume_uuid!==UUID||
    m.files_sha256?.['ssd-worker-prestart-diagnostic-on-mac.mjs']===undefined)
    throw Error('SIGNED_DIAGNOSTIC_IDENTITY_INVALID');
  for(const [name,digest] of Object.entries(m.files_sha256)){
    if(!/^[A-Za-z0-9._-]{2,90}$/.test(name)||
      !/^[a-f0-9]{64}$/.test(digest)||
      !fs.lstatSync(RELEASE_DIR+'/'+name).isFile()||
      hash(fs.readFileSync(RELEASE_DIR+'/'+name))!==digest)
      throw Error('SIGNED_DIAGNOSTIC_FILE_TAMPERED');
  }
}
function externalDisk(){
  const plist=run('/usr/sbin/diskutil',['info','-plist',DISK]);
  const info=JSON.parse(run('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{input:plist}));
  if(info.Internal!==false||
    info.MountPoint!==DISK||
    String(info.VolumeUUID||'').toUpperCase()!==UUID||
    !/APFS/i.test(String(info.FileSystemPersonality||'')))
    throw Error('SSD_VOLUME_PIN_MISMATCH');
  for(const suffix of ['shared-auth','workspaces/'+WID+'/repo',
    'workspaces/'+WID+'/home','workspaces/'+WID+'/docker']){
    const p=DATA+'/'+suffix;
    const st=fs.lstatSync(p);
    if(!st.isDirectory()||st.isSymbolicLink())
      throw Error('DIRECT_SSD_BIND_SOURCE_NOT_REAL_DIRECTORY');
  }
}
function phaseCheck(){
  const st=fs.lstatSync(JOURNAL);
  if(!st.isFile()||st.isSymbolicLink()||
    st.uid!==process.getuid()||(st.mode&0o077)!==0)
    throw Error('ROLLBACK_JOURNAL_UNTRUSTED');
  const j=JSON.parse(fs.readFileSync(JOURNAL,'utf8'));
  if(j.schema!=='sandbox-v3.ssd-direct-cutover.v1'||
    j.ssdUuid!==UUID||j.phase!=='ROLLBACK_COMPLETE')
    throw Error('ROLLBACK_NOT_VERIFIED_OR_IN_PROGRESS');
}
function dockerContext(){
  const addr=run('docker',['context','inspect',
    '--format','{{.Endpoints.docker.Host}}']).trim();
  if(!addr.startsWith('unix://'))
    throw Error('LOCAL_DOCKER_SOCKET_REQUIRED');
  const socketPath=addr.slice(7);
  if(!fs.statSync(socketPath).isSocket())
    throw Error('DOCKER_SOCKET_NOT_FOUND');
  const apiVersion=run('docker',['version','--format',
    '{{.Server.APIVersion}}']).trim();
  if(!/^\d+\.\d+$/.test(apiVersion))
    throw Error('DOCKER_API_VERSION_UNAVAILABLE');
  return {socketPath,apiVersion};
}
async function query(ctx,method,route,body=null){
  const result=await new Promise((resolve,reject)=>{
    const req=http.request({
      socketPath:ctx.socketPath,method,
      path:'/v'+ctx.apiVersion+route,
      timeout:30000,
      headers:{'Content-Type':'application/json'}
    },resp=>{
      const chunks=[];
      resp.on('data',b=>chunks.push(b));
      resp.on('end',()=>{
        const data=Buffer.concat(chunks).toString('utf8');
        let payload={};
        try{payload=data?JSON.parse(data):{};}
        catch{payload={message:'ENGINE_RESPONSE_NON_JSON'};}
        resolve({status:resp.statusCode,payload});
      });
    });
    req.on('error',reject);
    req.on('timeout',()=>req.destroy(Error('ENGINE_REQUEST_TIMEOUT')));
    req.end(body===null?undefined:JSON.stringify(body));
  });
  return result;
}
async function checked(ctx,method,route,body){
  const r=await query(ctx,method,route,body);
  if(r.status>=400)
    throw Error('ENGINE_'+method+'_HTTP_'+r.status);
  return r.payload;
}
export function sanitizeError(message,secretEnv=[]){
  let value=String(message||'ENGINE_DID_NOT_RETURN_DIAGNOSTIC_MESSAGE');
  for(const e of secretEnv){
    if(typeof e!=='string')continue;
    const eq=e.indexOf('=');
    const text=eq>=0?e.slice(eq+1):'';
    if(text.length>4)
      value=value.split(text).join('[REDACTED_ENV_VALUE]');
  }
  value=value.replaceAll(os.homedir(),'[HOME]')
    .replaceAll(DATA,'[SSD_DATA]')
    .replaceAll(SOURCE,'[ORIGINAL_DATA]')
    .replace(/(token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g,'[REDACTED_TOKEN]')
    .replace(/\s+/g,' ').slice(0,800);
  return value;
}
export function classifyError(message){
  const m=String(message||'').toLowerCase();
  if(/(already.*in use|port.*allocated|address already in use)/.test(m))
    return 'HOST_PORT_COLLISION';
  if(/(ip address.*in use|address.*allocated|endpoint.*network)/.test(m))
    return 'NETWORK_ALLOCATION_OR_ENDPOINT';
  if(/(mount|file.?sharing|permission denied|operation not permitted)/.test(m))
    return 'BIND_MOUNT_OR_PERMISSIONS';
  if(/(oci runtime|runc|create task|containerd)/.test(m))
    return 'OCI_RUNTIME_OR_CONTAINERD';
  if(/(no space left|disk quota)/.test(m))
    return 'STORAGE_SPACE';
  return 'UNCLASSIFIED_DOCKER_ENGINE_FAILURE';
}
function isInertOriginal(c){
  const pathValue=String(c.Path||'').trim();
  const args=c.Args||[];
  const joined=[pathValue,...(Array.isArray(args)?args:[])].join(' ').trim();
  return /^(\/usr\/bin\/|\/bin\/)?sleep infinity$/.test(joined)||
    /^(\/bin\/)?sh -c (exec )?sleep infinity$/.test(joined);
}
async function attempt(ctx,original,mode){
  const spec=candidateConfig(original);
  const name=SAFE_PREFIX+mode+'-'+crypto.randomBytes(6).toString('hex');
  const body=copy(spec.body);
  // PID1 is strictly inert; never run the original launch command
  // unless it has been independently proven to be sleep infinity.
  body.Entrypoint=['/bin/sh','-c'];
  body.Cmd=['exec sleep infinity'];
  body.HostConfig.RestartPolicy={Name:'no'};
  if(body.HostConfig.PortBindings&&
    Object.keys(body.HostConfig.PortBindings).length)
    throw Error('WORKER_HAS_PUBLISHED_PORTS_STOP');
  if(mode==='clean-network')
    body.NetworkingConfig={EndpointsConfig:{bridge:{}}};
  let attemptedCreate=false;
  let createdId=null;
  let cleanupOk=true;
  const secretEnv=original.Config.Env||[];
  try{
    attemptedCreate=true;
    const res=await query(ctx,'POST',
      '/containers/create?name='+encodeURIComponent(name),body);
    if(res.status>=400){
      const msg=sanitizeError(res.payload?.message,secretEnv);
      say(mode+'.CREATE_HTTP',res.status);
      say(mode+'.CREATE_REASON',classifyError(msg));
      say(mode+'.DETAIL',msg);
      return false;
    }
    createdId=res.payload?.Id;
    if(!/^[a-f0-9]{64}$/.test(createdId||''))
      throw Error('CANDIDATE_CREATION_NOT_IDENTIFIED');
    const candidate=await checked(ctx,'GET',
      '/containers/'+createdId+'/json');
    if(candidate?.HostConfig?.Privileged!==true)
      throw Error('REHEARSAL_PRIVILEGED_FLAG_NOT_PRESERVED');
    if(candidate?.Image!==original.Image)
      throw Error('REHEARSAL_IMAGE_ID_CHANGED');
    const target=[
      ['workspace','/workspace',DATA+'/workspaces/'+WID+'/repo'],
      ['home','/home/agent',DATA+'/workspaces/'+WID+'/home'],
      ['auth','/shared-auth',DATA+'/shared-auth'],
      ['docker','/var/lib/docker',DATA+'/workspaces/'+WID+'/docker']
    ];
    for(const [,dest,source] of target){
      if(!candidate.Mounts?.some(m=>m.Destination===dest&&
        m.Source===source&&m.Type==='bind'))
        throw Error('REHEARSAL_MOUNT_PARITY_FAILED');
    }
    const start=await query(ctx,'POST',
      '/containers/'+createdId+'/start');
    if(start.status>=400){
      const msg=sanitizeError(start.payload?.message,secretEnv);
      say(mode+'.START_HTTP',start.status);
      say(mode+'.START_REASON',classifyError(msg));
      say(mode+'.START_DETAIL',msg);
      return false;
    }
    const inspect=await checked(ctx,'GET',
      '/containers/'+createdId+'/json');
    if(!inspect?.State?.Running)
      throw Error('TEMP_INERT_WORKER_DID_NOT_RUN');
    say(mode+'.START','PASS');
    return true;
  }finally{
    if(attemptedCreate){
      let temp=createdId;
      if(!temp){
        const check=await query(ctx,'GET',
          '/containers/'+encodeURIComponent(name)+'/json');
        if(check.status===200)temp=check.payload.Id;
        if(check.status!==404&&check.status!==200)cleanupOk=false;
      }
      if(temp){
        const check=await query(ctx,'GET',
          '/containers/'+temp+'/json');
        if(check.status===200&&check.payload.State?.Running){
          const stopped=await query(ctx,'POST',
            '/containers/'+temp+'/stop?t=8');
          if(stopped.status>=400){
            const after=await query(ctx,'GET',
              '/containers/'+temp+'/json');
            if(after.status===200&&after.payload.State?.Running)
              cleanupOk=false;
          }
        }
        if(cleanupOk){
          const deleted=await query(ctx,'DELETE',
            '/containers/'+temp+'?force=1');
          if(deleted.status!==204&&deleted.status!==200&&deleted.status!==404)
            cleanupOk=false;
        }
      }
    }
    say(mode+'.CLEANUP',cleanupOk?'PASS':'REQUIRES_OPERATOR_REVIEW');
    // Cleanup failure supersedes a test failure: do not falsely report
    // successful removal of a privileged diagnostic candidate.
    // eslint-disable-next-line no-unsafe-finally
    if(!cleanupOk)throw Error('TEMP_CANDIDATE_CLEANUP_FAILED');
  }
}
async function main(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  if(process.argv.length!==3||process.argv[2]!=='--test')
    throw Error('ONLY_TEST_MODE_SUPPORTED');
  releaseCheck();externalDisk();phaseCheck();
  const ctx=dockerContext();
  const info=await checked(ctx,'GET','/info');
  const cli=run('docker',['info','--format','{{.ID}}']).trim();
  if(!cli||info.ID!==cli)
    throw Error('DOCKER_CLI_AND_SOCKET_ENGINE_MISMATCH');
  const before=JSON.parse(run('docker',['inspect',TARGET]));
  if(before.length!==1||before[0].State?.Running!==true)
    throw Error('ACTIVE_ORIGINAL_WORKER_MISSING');
  const c=before[0];
  candidateConfig(c);
  say('ORIGINAL_WORKER_INERT_COMMAND',isInertOriginal(c)?'YES':'NO_OVERRIDE_FOR_SAFETY');
  say('ORIGINAL_WORKER_ID',String(c.Id).slice(0,12));
  say('SSD_DIRECTORY_GATE','PASS');
  // Exact original's host/network configs. PID1 overwritten with
  // inert sleep only, to prevent apps, Docker daemon or side effects.
  const exact=await attempt(ctx,c,'exact-network');
  const clean=exact?null:await attempt(ctx,c,'clean-network');
  const after=JSON.parse(run('docker',['inspect',TARGET]));
  if(after.length!==1||after[0].Id!==c.Id||
    after[0].State?.Running!==true||
    JSON.stringify(after[0].Mounts)!==JSON.stringify(c.Mounts))
    throw Error('ORIGINAL_WORKER_CHANGED_ABORT');
  say('ORIGINAL_WORKER','UNCHANGED_RUNNING');
  say('SECRET_ENV_VALUES_PRINTED','NO');
  if(exact) say('RESULT','FULL_RUNTIME_START_COMPATIBLE');
  else if(clean) say('RESULT','ORIGINAL_ENDPOINT_CONFIG_SUSPECT');
  else say('RESULT','FULL_RUNTIME_START_FAILURE_CAUSE_CAPTURED');
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url))main().catch(e=>{
  say('STOP',String(e.message||'UNKNOWN').slice(0,190));
  process.exitCode=2;
});
