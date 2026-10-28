#!/usr/bin/env node
/**
 * One-command entrypoint: sandbox -> the EXISTING Sandbox V3
 * controller + single persistent dev-main workstation.
 *
 * Never invokes legacy V2/ngrok start-all.sh, creates a new container,
 * destroys Docker state, starts CDP or touches macOS browser profiles.
 * A CLI cannot change ChatGPT plugin installation or connector routing.
 */
import console from 'node:console';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const DEFAULT_CONTROLLER='cloud-sandbox-mcp';
export const DEFAULT_WORKSTATION='cloud-sandbox-dev-main';

export function parseContainerStatus(text,name){
  const match=String(text).trim().match(/^(\/[A-Za-z0-9_.-]+)\|(true|false)\|([A-Za-z_-]+)$/);
  if(!match||match[1]!=='/'+name)throw Error('UNEXPECTED_CONTAINER_IDENTITY:'+name);
  return {name,active:match[2]==='true',health:match[3]};
}
const out=(key,val)=>console.log('[Sandbox V3 CLI] '+key+'='+String(val));
function exec(cmd,args,timeout=12000){
  const r=spawnSync(cmd,args,{encoding:'utf8',timeout,
    stdio:['ignore','pipe','pipe'],maxBuffer:50000});
  return {ok:r.status===0&&!r.error,stdout:String(r.stdout||'').trim(),
    stderr:String(r.stderr||'').trim(),code:r.status};
}
function state(container){
  const r=exec('docker',['inspect','--format',
    '{{.Name}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
    container],6000);
  if(!r.ok)throw Error('EXISTING_CONTAINER_NOT_FOUND:'+container);
  return parseContainerStatus(r.stdout,container);
}
function dockerReady(){return exec('docker',['info','--format','{{.ServerVersion}}'],5000).ok;}
function controllerHealth(){
  const statement="fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(3500)})"+
    ".then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))";
  return exec('docker',['exec',DEFAULT_CONTROLLER,'node','-e',statement],7000).ok;
}
async function ensureDocker(){
  if(dockerReady())return;
  if(process.platform!=='darwin')throw Error('DOCKER_DAEMON_NOT_READY');
  out('DOCKER_DESKTOP','OPENING_EXISTING_APP');
  const open=exec('/usr/bin/open',['-a','Docker'],10000);
  if(!open.ok)throw Error('DOCKER_DESKTOP_START_FAILED');
  for(let i=0;i<60;i++){
    await delay(1500);
    if(dockerReady())return;
  }
  throw Error('DOCKER_DAEMON_NOT_READY');
}
async function ensureExisting(name){
  let current=state(name);
  if(!current.active){
    out(name,'STARTING_EXISTING_CONTAINER');
    const started=exec('docker',['start',name],30000);
    if(!started.ok)throw Error('EXISTING_CONTAINER_START_FAILED:'+name);
  }
  for(let i=0;i<35;i++){
    current=state(name);
    if(current.active&&['none','healthy'].includes(current.health))return current;
    if(current.health==='unhealthy')throw Error('EXISTING_CONTAINER_UNHEALTHY:'+name);
    await delay(1000);
  }
  throw Error('EXISTING_CONTAINER_NOT_READY:'+name);
}
function help(){
  console.log('Usage: sandbox [start|status|doctor|help]');
  console.log('No argument means start. Existing containers only, no legacy ngrok.');
}
async function main(){
  const command=process.argv[2]??'start';
  if(process.argv.length>3||!['start','status','doctor','help','--help'].includes(command))
    throw Error('USAGE_SANDBOX_START_STATUS_DOCTOR_HELP');
  if(command==='help'||command==='--help'){help();return;}
  if(process.platform!=='darwin')throw Error('MACOS_OPERATOR_HOST_REQUIRED');
  out('PRODUCT','Sandbox V3');
  out('CONNECTOR_PREFERENCE','Sandbox_V3');
  out('LEGACY_MCP_V2_START','DISABLED');
  out('MULTI_WORKSTATION_START','DISABLED');
  if(command==='doctor'){
    out('CLI_ENTRY',fileURLToPath(import.meta.url).replaceAll(process.env.HOME||'', '~'));
    out('CONTROLLER',DEFAULT_CONTROLLER);
    out('WORKSTATION',DEFAULT_WORKSTATION);
    out('EXTERNAL_PLUGIN_ROUTING','NOT_CONTROLLED_BY_SHELL');
  }
  if(command==='status'||command==='doctor'){
    if(!dockerReady()){out('DOCKER','NOT_READY');process.exitCode=1;return;}
    out('DOCKER','READY');
    for(const name of [DEFAULT_CONTROLLER,DEFAULT_WORKSTATION]){
      try{
        const status=state(name);
        out(name.toUpperCase().replaceAll('-','_'),
          status.active?(status.health==='unhealthy'?'UNHEALTHY':'RUNNING'):
            'STOPPED');
      }catch{out(name.toUpperCase().replaceAll('-','_'),'NOT_FOUND');process.exitCode=1;}
    }
    out('MCP_CONTROLLER_HTTP_HEALTH',controllerHealth()?'PASS':'FAIL');
    out('V3_CONNECTOR_EXTERNAL_HEALTH','REQUIRES_CHATGPT_V3_CHECK');
    return;
  }
  await ensureDocker();
  // A new runtime / workspace is NEVER created: both container names
  // must exist before any start operation is attempted.
  state(DEFAULT_CONTROLLER);
  state(DEFAULT_WORKSTATION);
  await ensureExisting(DEFAULT_CONTROLLER);
  await ensureExisting(DEFAULT_WORKSTATION);
  let healthy=false;
  for(let attempt=0;attempt<18;attempt++){
    healthy=controllerHealth();
    if(healthy)break;
    await delay(750);
  }
  if(!healthy)throw Error('MCP_CONTROLLER_HTTP_HEALTH_FAILED');
  out('CONTROLLER','RUNNING');
  out('CONTROLLER_HTTP_HEALTH','PASS');
  out('WORKSTATION','RUNNING');
  out('DATA_REUSED','YES');
  out('REMOTE_TUNNEL_RESTARTED','NO');
  out('BROWSER_BRIDGE_RESTARTED','NO');
  out('EXTERNAL_V3_CONNECTOR','VERIFY_WITH_SANDBOX_V3_PLUGIN');
  out('RESULT','LOCAL_SANDBOX_V3_READY');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    out('STOP',String(error?.message||'UNKNOWN').slice(0,190));
    process.exitCode=2;
  });
}
