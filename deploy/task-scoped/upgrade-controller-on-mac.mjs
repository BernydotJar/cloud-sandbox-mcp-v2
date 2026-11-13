#!/usr/bin/env node
/* global fetch, AbortSignal, structuredClone */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import {fileURLToPath,URL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {isDeepStrictEqual as equal} from 'node:util';

export function createSpec(original,image){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||original.Name!=='/cloud-sandbox-mcp'||
    original.Config.Labels?.['com.docker.compose.service']!=='mcp'||
    original.HostConfig.AutoRemove||Object.keys(original.NetworkSettings.Networks).length!==1)
  throw Error('UNRECOGNIZED_CONTROLLER_SPEC');
 const networks=original.NetworkSettings.Networks;
 const endpoints={};
 for(const [name,n] of Object.entries(networks)){
  if(Object.values(n.IPAMConfig||{}).some(v=>Array.isArray(v)?v.length>0:typeof v==='string'?v.length>0:v!=null)||n.Links?.length)throw Error('STATIC_OR_LINKED_NETWORK_REQUIRES_REVIEW');
  endpoints[name]={Aliases:n.Aliases,DriverOpts:n.DriverOpts,GwPriority:n.GwPriority??0};
 }
 return {...structuredClone(original.Config),Image:image,
  Labels:{...original.Config.Labels,'com.docker.compose.image':image},
  HostConfig:structuredClone(original.HostConfig),NetworkingConfig:{EndpointsConfig:endpoints}};
}
export function verifyParity(original,current,image){
 const config=structuredClone(current.Config),expected=structuredClone(original.Config);
 config.Image=image;expected.Image=image;
 config.Labels['com.docker.compose.image']=image;expected.Labels['com.docker.compose.image']=image;
 if(!equal(config,expected)||!equal(current.HostConfig,original.HostConfig)||
    current.Image!==image||
    !equal(current.Mounts.map(m=>[m.Type,m.Source,m.Destination,m.RW]).sort(),
           original.Mounts.map(m=>[m.Type,m.Source,m.Destination,m.RW]).sort())||
    !equal(Object.keys(current.NetworkSettings.Networks).sort(),Object.keys(original.NetworkSettings.Networks).sort()))
  throw Error('CONTROLLER_PARITY_FAILED');
}
export function guardCanonicalController(source,kind){
 if(source.includes('TASK_SCOPED_CANONICAL_CONTROLLER_V1'))return source;
 const begin=source.indexOf('if [ -d "$PROJECT_DIR" ]; then');
 const end=kind==='runtime.sh'?source.indexOf('docker start   "$WORKSTATION"',begin):source.indexOf('WORKSTATION_RUNNING=',begin);
 if(begin<0||end<begin||!source.slice(begin,end).includes('docker compose'))throw Error('UNKNOWN_HOST_SUPERVISION_SOURCE');
 const guard=`# TASK_SCOPED_CANONICAL_CONTROLLER_V1
# Reuse the named controller; never recreate from a historical Compose image.
MCP_RUNNING="$(docker inspect --format '{{.State.Running}}' cloud-sandbox-mcp 2>/dev/null || true)"
if [ "$MCP_RUNNING" != "true" ]; then
  docker start cloud-sandbox-mcp >/dev/null 2>&1 || true
fi

`;
 return source.slice(0,begin)+guard+source.slice(end);
}
function engine(socketPath,method,route,body){
 return new Promise((resolve,reject)=>{
  const data=body===undefined?undefined:JSON.stringify(body);
  const req=http.request({socketPath,path:route,method,headers:data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);
   res.on('end',()=>{
    if(res.statusCode<200||res.statusCode>=300)return reject(Error('ENGINE_HTTP_'+method+'_'+res.statusCode));
    try{resolve(text?JSON.parse(text):{});}catch{reject(Error('ENGINE_JSON_INVALID'));}
   });
  });
  req.setTimeout(40000,()=>req.destroy(Error('ENGINE_TIMEOUT')));
  req.on('error',()=>reject(Error('ENGINE_REQUEST_FAILED')));
  if(data)req.write(data);req.end();
 });
}
async function main(){
 if(process.platform!=='darwin')throw Error('MACOS_REQUIRED');
 const [mode,image]=process.argv.slice(2);
 if(!['--inspect','--install'].includes(mode)||!/^sha256:[a-f0-9]{64}$/.test(image||'')||process.argv.length!==4)
  throw Error('USE_INSPECT_OR_INSTALL_WITH_LOCAL_IMAGE_ID');
 const socketPath=path.join(os.homedir(),'.docker/run/docker.sock');
 const api=async(method,route,body)=>engine(socketPath,method,route,body);
 const original=await api('GET','/containers/cloud-sandbox-mcp/json');
 const spec=createSpec(original,image);
 if(!original.State.Running)throw Error('ORIGINAL_CONTROLLER_NOT_RUNNING');
 if((await api('GET','/images/'+image+'/json')).Id!==image)throw Error('LOCAL_IMAGE_REQUIRED');
 const env=Object.fromEntries(original.Config.Env.map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 // Credentials remain only in memory. Never write original Env/inspect to receipts or logs.
 const bridgePort=env.COMPUTER_USE_BRIDGE_PORT || new URL(env.COMPUTER_USE_BRIDGE_URL || 'http://host.docker.internal:9764').port || '9764';
 const bridge=async()=>{
  const r=await fetch('http://127.0.0.1:' +bridgePort+'/v1/session/status',{
   method:'POST',headers:{authorization:'Bearer '+env.COMPUTER_USE_BRIDGE_TOKEN,'content-type':'application/json'},
   body:'{}',redirect:'error',signal:AbortSignal.timeout(5000)});
  const j=await r.json();if(!r.ok||!j.ok)throw Error('BRIDGE_PREFLIGHT_FAILED');
  if(j.data.active!==false)throw Error('ACTIVE_TASK_SESSION_DO_NOT_INTERRUPT');
 };
 await bridge();
 process.stdout.write('CONTROLLER_SPEC=PASS\nSECRETS=PRESERVED_IN_MEMORY_ONLY\nWORKSTATION=UNCHANGED\n');
 if(mode==='--inspect')return;
 const suffix=Date.now().toString(),backup='cloud-sandbox-mcp-before-task-'+suffix;
 const journal=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxBackups','controller-'+suffix);
 fs.mkdirSync(journal,{recursive:true,mode:0o700});
 // The old host jobs used Compose discovery, which can select a retained backup.
 // Keep their existing Docker start/focus behavior and change only controller ownership.
 for(const name of ['runtime.sh','watchdog.sh']){
  const file=path.join(os.homedir(),'.local/share/cloud-sandbox/host-automation',name);
  if(!fs.existsSync(file))continue;
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o022))throw Error('UNSAFE_SUPERVISION_FILE');
  const before=fs.readFileSync(file,'utf8'),after=guardCanonicalController(before,name);
  if(before!==after){
   fs.writeFileSync(path.join(journal,name+'.previous'),before,{mode:0o600,flag:'wx'});
   const temp=file+'.task-portal-'+process.pid;
   fs.writeFileSync(temp,after,{mode:stat.mode&0o777,flag:'wx'});fs.renameSync(temp,file);
  }
 }
 let created,renamed=false,stopped=false;
 const health=async()=>{
  for(let i=0;i<30;i++){
   try{const r=await fetch('http://127.0.0.1:3000/healthz',{redirect:'error',signal:AbortSignal.timeout(2000)});if(r.status===200)return;}catch{/* bounded startup */}
   await sleep(500);
  }throw Error('CONTROLLER_HEALTH_FAILED');
 };
 const start=async id=>{
  for(let i=0;i<3;i++){
   try{await api('POST','/containers/'+id+'/start');return;}catch{
    if((await api('GET','/containers/'+id+'/json')).State.Running)return;
    await sleep(700);
   }
  }throw Error('CONTROLLER_START_FAILED');
 };
 try{
  await bridge();
  await api('POST','/containers/'+original.Id+'/stop?t=20');stopped=true;
  await api('POST','/containers/'+original.Id+'/update',{RestartPolicy:{Name:'no',MaximumRetryCount:0}});
  await api('POST','/containers/'+original.Id+'/rename?name='+backup);renamed=true;
  created=(await api('POST','/containers/create?name=cloud-sandbox-mcp',spec)).Id;
  await start(created);
  await health();
  const actual=await api('GET','/containers/'+created+'/json');
  verifyParity(original,actual,image);
  fs.writeFileSync(path.join(journal,'receipt.json'),JSON.stringify({installed:true,old_container:original.Id,
   backup_container:backup,new_container:created,previous_image:original.Image,new_image:image,
   previous_restart_policy:original.HostConfig.RestartPolicy,workstation_changed:false,env_values_logged:false},null,2),{mode:0o600,flag:'wx'});
  process.stdout.write('CONTROLLER_IMAGE_UPGRADE=PASS\nBACKUP_CONTAINER='+backup+'\n');
 }catch(error){
  try{
   if(created){
    try{await api('POST','/containers/'+created+'/stop?t=10');}catch{/* inspect recovery below */}
    await api('POST','/containers/'+created+'/update',{RestartPolicy:{Name:'no',MaximumRetryCount:0}});
    await api('POST','/containers/'+created+'/rename?name=cloud-sandbox-mcp-failed-task-'+suffix);
   }
   if(renamed)await api('POST','/containers/'+original.Id+'/rename?name=cloud-sandbox-mcp');
   if(stopped){
    await api('POST','/containers/'+original.Id+'/update',{RestartPolicy:original.HostConfig.RestartPolicy});
    await start(original.Id);await health();
   }
  }catch{throw Error('CONTROLLER_ROLLBACK_FAILED_CHECK_PRIVATE_JOURNAL');}
  throw Error('CONTROLLER_ROLLED_BACK_'+error.message);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{process.stderr.write('SAFETY_STOP='+error.message+'\n');process.exitCode=1;});
