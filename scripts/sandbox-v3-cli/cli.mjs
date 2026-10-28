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
import fs from 'node:fs';
import {banner,readTheme,saveTheme,normalizeTheme} from './art.mjs';
import {ensureCloudflare,inspectCloudflare} from './cloudflare.mjs';
import {probePublicEndpoints,probeBrowserBridge,
  formatDashboard,healthRow,outcomeCode} from './health.mjs';

export const DEFAULT_CONTROLLER='cloud-sandbox-mcp';
export const DEFAULT_WORKSTATION='cloud-sandbox-dev-main';

export function parseContainerStatus(text,name){
  const match=String(text).trim().match(/^(\/[A-Za-z0-9_.-]+)\|(true|false)\|([A-Za-z_-]+)$/);
  if(!match||match[1]!=='/'+name)throw Error('UNEXPECTED_CONTAINER_IDENTITY:'+name);
  return {name,active:match[2]==='true',health:match[3]};
}
const machineReadable=process.argv[2]==='doctor'||
  process.argv[3]==='--plain'||process.env.SANDBOX_VERBOSE==='1';
const out=(key,val)=>{
  const important=['RESULT','STOP','CLOUDFLARE_ADMIN','DOCKER_DESKTOP'];
  if(machineReadable||important.includes(key)||
     key==='cloud-sandbox-mcp'||key==='cloud-sandbox-dev-main')
    console.log('[Sandbox V3 CLI] '+key+'='+String(val));
};
function exec(cmd,args,timeout=12000){
  const r=spawnSync(cmd,args,{encoding:'utf8',timeout,
    stdio:['ignore','pipe','pipe'],maxBuffer:50000});
  return {ok:r.status===0&&!r.error,stdout:String(r.stdout||'').trim(),
    stderr:String(r.stderr||'').trim(),code:r.status};
}
function privilegedCloudflareOperation(args){
  // The service module provides exactly two allowed launchctl forms:
  // kickstart of a known label, or bootstrap of a verified existing plist.
  const command=['/bin/launchctl',...args];
  const noninteractive=exec('/usr/bin/sudo',['-n',...command],12000);
  if(noninteractive.ok)return true;
  if(!process.stdin.isTTY||!process.stderr.isTTY)return false;
  out('CLOUDFLARE_ADMIN','ONE_TIME_MACOS_PRIVILEGE_IF_NEEDED');
  const withPrompt=spawnSync('/usr/bin/sudo',command,{
    stdio:'inherit',timeout:90000
  });
  return withPrompt.status===0&&!withPrompt.error;
}
function printCloudflareStatus(){
  const state=inspectCloudflare({exec});
  out('CLOUDFLARE_LAUNCHD',state.running?'RUNNING':
    state.selected?'STOPPED':'NOT_LOADED');
  if(state.selected)out('CLOUDFLARE_SERVICE',state.selected.label);
  out('CLOUDFLARE_NETWORK_HEALTH','CHECK_PUBLIC_HTTPS_ROWS');
}
function optionalContainerState(name){
  try{return state(name);}catch{return null;}
}
export function composeHealthRows({docker,controller,workstation,
  controllerHttp,cloudflare,bridge,publicEndpoints}){
  if(!Array.isArray(publicEndpoints)||publicEndpoints.length!==2)
    throw Error('PUBLIC_HEALTH_PROBES_INCOMPLETE');
  const canRun=status=>Boolean(status?.active)&&
    ['healthy','none'].includes(status.health);
  const rows=[
    healthRow('DOCKER','Docker Desktop',docker,
      'Motor Docker disponible','Motor Docker detenido'),
    healthRow('CONTROLLER','MCP Controller',docker&&canRun(controller),
      'Contenedor cloud-sandbox-mcp activo','Controlador no disponible'),
    healthRow('WORKSTATION','Workstation',docker&&canRun(workstation),
      'dev-main activo · datos persistentes','Workstation no disponible'),
    healthRow('MCP_HTTP','MCP /healthz',controllerHttp,
      'HTTP local correcto','Healthcheck MCP falló'),
    healthRow('CLOUDFLARE','Cloudflare Tunnel',cloudflare?.running===true,
      'cloud-sandbox-mac · launchd activo',
      cloudflare?.selected?'Servicio detenido':'Servicio no cargado'),
    ...publicEndpoints,
    bridge,
    {id:'V3_PLUGIN',label:'ChatGPT · Sandbox V3',
      status:'unknown',code:'EXTERNAL_PLUGIN',
      detail:'Conexión MCP: verificar desde ChatGPT'}
  ];
  return rows;
}
async function collectHealthRows(){
  // Keep synchronous Docker checks outside the timed HTTPS window:
  // otherwise reported network latency includes time blocked by spawnSync.
  const docker=dockerReady();
  const controller=docker?optionalContainerState(DEFAULT_CONTROLLER):null;
  const workstation=docker?optionalContainerState(DEFAULT_WORKSTATION):null;
  const controllerHttp=docker&&controller?.active?controllerHealth():false;
  const cloudflare=inspectCloudflare({exec});
  // These are read-only and run concurrently even when Docker is down.
  const [publicEndpoints,bridge]=await Promise.all([
    probePublicEndpoints(),probeBrowserBridge()
  ]);
  return composeHealthRows({docker,controller,workstation,
    controllerHttp,cloudflare,bridge,publicEndpoints});
}
function showHealthRows(rows,{json=false,plain=false}={}){
  if(json){
    console.log(JSON.stringify({
      schema:'sandbox-v3.health.v1',
      checked_at:new Date().toISOString(),
      status:outcomeCode(rows)?'DEGRADED':'READY',
      rows
    },null,2));
  }else if(plain){
    for(const row of rows){
      console.log('[Sandbox V3 CLI] '+row.id+'='+row.code+
        ' STATUS='+row.status.toUpperCase()+
        ' DETAIL='+row.detail);
    }
    console.log('[Sandbox V3 CLI] HEALTH_RESULT='+
      (outcomeCode(rows)?'DEGRADED':'READY'));
  }else{
    console.log(formatDashboard(rows));
  }
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
  console.log('Usage: sandbox [start|status|doctor|help|cats|jupiter]');
  console.log('       sandbox art [cats|jupiter]     preview ASCII, no Docker');
  console.log('       sandbox theme [cats|jupiter]   save preferred intro');
  console.log('       sandbox --no-art               start without ASCII');
  console.log('       sandbox status --plain         machine-readable text');
  console.log('       sandbox status --json          structured check results');
  console.log('No argument means start. Existing Docker and Cloudflare Tunnel only.');
}
export function isMainModule(argv1=process.argv[1],url=import.meta.url){
  if(!argv1)return false;
  try{
    // A symlink executable passes ~/.local/bin/sandbox in argv[1],
    // while Node loads its ESM module from ~/.local/share/sandbox-v3/cli.mjs.
    // Comparing path.resolve() without realpathSync() silently skipped main.
    return fs.realpathSync(argv1)===fs.realpathSync(fileURLToPath(url));
  }catch{return false;}
}
async function main(){
  const command=process.argv[2]??'start';
  const option=process.argv[3];
  if(command==='help'||command==='--help'){
    if(option!==undefined)throw Error('USAGE_SANDBOX_HELP');
    help();return;
  }
  if(command==='art'){
    if(process.argv.length>4)throw Error('USAGE_SANDBOX_ART_CATS_OR_JUPITER');
    console.log(banner(normalizeTheme(option??readTheme())));
    return;
  }
  if(command==='theme'){
    if(process.argv.length>4)throw Error('USAGE_SANDBOX_THEME_CATS_OR_JUPITER');
    if(option){saveTheme(normalizeTheme(option));out('ASCII_THEME',option.toUpperCase());}
    else out('ASCII_THEME',readTheme().toUpperCase());
    return;
  }
  if((option!==undefined&&
      !(command==='status'&&['--plain','--json'].includes(option)))||
     !['start','status','doctor','cats','jupiter','--no-art'].includes(command))
    throw Error('USAGE_SANDBOX_START_STATUS_DOCTOR_ART_THEME');
  const launching=['start','cats','jupiter','--no-art'].includes(command);
  if(launching&&command!=='--no-art'){
    console.log(banner(['cats','jupiter'].includes(command)?command:readTheme()));
  }
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
    const rows=await collectHealthRows();
    if(command==='doctor'){
      printCloudflareStatus();
      out('DOCKER',rows[0].code);
      out('CONTROLLER',rows[1].code);
      out('WORKSTATION',rows[2].code);
      out('MCP_CONTROLLER_HTTP_HEALTH',rows[3].code);
      for(const row of rows.slice(5,8))out(row.id,row.code);
      out('V3_CONNECTOR_EXTERNAL_HEALTH','REQUIRES_CHATGPT_V3_CHECK');
    }
    showHealthRows(rows,{json:option==='--json',plain:option==='--plain'});
    if(outcomeCode(rows))process.exitCode=1;
    return;
  }
  await ensureDocker();
  // A new runtime / workspace is NEVER created: both container names
  // must exist before any start operation is attempted.
  state(DEFAULT_CONTROLLER);
  state(DEFAULT_WORKSTATION);
  await ensureExisting(DEFAULT_CONTROLLER);
  await ensureExisting(DEFAULT_WORKSTATION);
  const tunnel=await ensureCloudflare({exec,
    privileged:privilegedCloudflareOperation,sleep:delay});
  out('CLOUDFLARE_TUNNEL',tunnel.state);
  out('CLOUDFLARE_SERVICE',tunnel.service);
  out('CLOUDFLARE_NETWORK_HEALTH','CHECK_PUBLIC_HTTPS_ROWS');
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
  out('EXISTING_CLOUDFLARE_REUSED','YES');
  out('BROWSER_BRIDGE_RESTARTED','NO');
  out('EXTERNAL_V3_CONNECTOR','VERIFY_WITH_SANDBOX_V3_PLUGIN');
  const rows=await collectHealthRows();
  showHealthRows(rows);
  const degraded=outcomeCode(rows)>0;
  out('RESULT',degraded?'LOCAL_READY_PUBLIC_DEGRADED':'LOCAL_SANDBOX_V3_READY');
  if(degraded)process.exitCode=1;
}
if(isMainModule()){
  main().catch(error=>{
    out('STOP',String(error?.message||'UNKNOWN').slice(0,190));
    process.exitCode=2;
  });
}
