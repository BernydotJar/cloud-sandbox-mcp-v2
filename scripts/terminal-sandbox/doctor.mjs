/**
 * Read-only local operator diagnostic. Discovers, but NEVER runs, the user's
 * `sandbox` executable. Can query the already-running Mac Bridge /v1/status.
 * No credential contents, code snippets, URLs or shell output are printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
/* global fetch, AbortSignal */
import process from 'node:process';
import { execFileSync } from 'node:child_process';
const inspectRoot=process.env.SANDBOX_CLI_PATH ||
  path.join(os.homedir(),'.local','bin','sandbox');
const log=(key,value)=>process.stdout.write('[Terminal Sandbox Doctor] '+key+'='+String(value)+'\n');
const redactPath=p=>p?.startsWith(os.homedir())?'~'+p.slice(os.homedir().length):
  p?.startsWith('/workspace/')?'[WORKSPACE]/'+path.basename(p):'[EXTERNAL_PATH]';
const boolean=v=>v?'YES':'NO';
const indicators={
  'CLOUD_SANDBOX_REFERENCE':/cloud[-_ ]sandbox|cloud_sandbox|cloudsandbox|cloud-sandbox-mcp/i,
  'MCP_REFERENCE':/\bmcp\b|modelcontextprotocol|mcp__Cloud_Sandbox_MCP_V2/i,
  'MAC_BRIDGE_REFERENCE':/computer_use_|browser_runtime_status|computer.use|mac.bridge|mac-host\/bridge/i,
  'AGENT_INSTRUCTIONS_REFERENCE':/AGENTS\.md|GEMINI\.md|CLAUDE\.md|browser-driven-qa|Graph-harness/i,
  'CDP_REFERENCE':/remote-debugging|CDP|9223|9239/i,
  'TERMINAL_CHAT_REFERENCE':/gptchat|chatgpt-terminal|codex|claude|gemini|opencode/i,
  'DOCKER_REFERENCE':/\bdocker\b|docker exec/i,
  'FLAG_C_REFERENCE':/(?:case\s+[^\n]{0,25}-c\b|(?:^|\s)(?:--chat|-c)(?=\s|$)|\$1\s*==?\s*['"]-c['"]|['"]-c['"])/i
};
function safeCommand(command,args,timeout=7500){
  try{return execFileSync(command,args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe'],maxBuffer:240000});}
  catch{return null;}
}
async function localBridgeStatus(){
  if(process.platform!=='darwin'){
    log('MAC_BRIDGE_STATUS','MAC_ONLY');
    return;
  }
  const record=safeCommand('docker',['inspect','cloud-sandbox-mcp']);
  if(!record){log('MAC_BRIDGE_STATUS','DOCKER_INSPECT_UNAVAILABLE');return;}
  let info;
  try{info=JSON.parse(record)[0];}catch{log('MAC_BRIDGE_STATUS','CONTROLLER_INSPECT_INVALID');return;}
  const compose=info?.Config?.Labels?.['com.docker.compose.project.working_dir'];
  if(!info?.State?.Running||!compose){log('MAC_BRIDGE_STATUS','CONTROLLER_UNKNOWN');return;}
  let env;
  try{
    const envFile=path.join(fs.realpathSync(compose),'.env');
    const stat=fs.lstatSync(envFile);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('UNSAFE_FILE');
    env=fs.readFileSync(envFile,'utf8');
  }catch{log('MAC_BRIDGE_STATUS','CONFIG_UNAVAILABLE');return;}
  const get=name=>{
    const matches=env.split(/\r?\n/).filter(line=>line.startsWith(name+'='));
    if(matches.length!==1)return null;
    const raw=matches[0].slice(name.length+1).trim();
    return raw.replace(/^["']|["']$/g,'');
  };
  const token=get('COMPUTER_USE_BRIDGE_TOKEN');
  const port=Number(get('COMPUTER_USE_BRIDGE_PORT')||9764);
  if(!token||token.length<32||!Number.isInteger(port)||port<1024||port>65535){
    log('MAC_BRIDGE_STATUS','CONFIG_INCOMPLETE');return;
  }
  try{
    const response=await fetch('http://127.0.0.1:'+port+'/v1/status',{
      method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:'{}',signal:AbortSignal.timeout(3500)
    });
    const json=await response.json();
    if(!response.ok||json.ok!==true){log('MAC_BRIDGE_STATUS','NOT_READY');return;}
    const data=json.data;
    log('MAC_BRIDGE_STATUS','CONNECTED');
    log('TRUSTED_NOTICE_ENABLED',boolean(data?.trusted_delegation_notice?.enabled===true));
    log('TRUSTED_MAX_MINUTES',data?.trusted_delegation_notice?.max_minutes??'UNKNOWN');
    log('TRUSTED_UNLIMITED_ACTIONS',
      boolean(data?.trusted_delegation_notice?.unlimited_actions===true));
    log('EDU_NOTICE_SECONDS',data?.trusted_delegation_notice?.seconds??'UNKNOWN');
    log('MUTATION_ALLOWLIST_ONLY',
      boolean(data?.mutation_policy==='allowlist_only'));
  }catch{log('MAC_BRIDGE_STATUS','UNREACHABLE');}
}
async function main(){
  log('MODE','READ_ONLY_NO_CLI_EXECUTION');
  let info;
  try{info=fs.lstatSync(inspectRoot);}
  catch{log('SANDBOX_CLI','NOT_FOUND');return;}
  const resolved=fs.realpathSync(inspectRoot);
  const st=fs.statSync(resolved);
  log('SANDBOX_CLI','FOUND');
  log('ENTRY_PATH',redactPath(inspectRoot));
  log('SYMLINK',boolean(info.isSymbolicLink()));
  log('RESOLVED_PATH',redactPath(resolved));
  if(!st.isFile()){log('ENTRY_TYPE','NOT_FILE');return;}
  let source='';
  let fileType='BINARY_OR_OVERSIZE';
  if(st.size<=1_000_000){
    const buf=fs.readFileSync(resolved);
    const hasNull=buf.subarray(0,4096).includes(0);
    if(!hasNull){
      const candidate=buf.toString('utf8');
      // UTF-8 replacement glyphs indicate content that should not be parsed
      // as an ordinary shell/Node/Python script.
      if(!candidate.includes('\uFFFD')){
        source=candidate;
        fileType=source.startsWith('#!')?'SCRIPT_WITH_SHEBANG':'TEXT_WRAPPER';
      }
    }
  }
  log('ENTRY_TYPE',fileType);
  if(source){
    const shebang=source.split(/\r?\n/,1)[0];
    log('INTERPRETER',shebang.startsWith('#!')?
      (/(?:zsh|bash|sh|node|python|ruby|env)/i.exec(shebang)?.[0]||'OTHER'):
      'UNSPECIFIED');
    for(const [key,pattern] of Object.entries(indicators))log(key,boolean(pattern.test(source)));
    log('FOUND_CLI_REFERENCE_TO_BRIDGE',
      boolean(indicators.MAC_BRIDGE_REFERENCE.test(source)&&indicators.MCP_REFERENCE.test(source)));
    log('FOUND_AGENT_POLICY_REFERENCE',
      boolean(indicators.AGENT_INSTRUCTIONS_REFERENCE.test(source)));
  }
  log('STATIC_INSPECTION_LIMIT',
    'Flags, subcommands and runtime MCP routing are NOT guaranteed by text matching');
  await localBridgeStatus();
  log('VERDICT','Mac Bridge status and CLI path inspected separately; CLI-to-MCP integration unverified until command behavior is tested');
}
main().catch(e=>{
  log('DIAG_ERROR',String(e?.code||e?.name||'UNKNOWN').slice(0,80));
  process.exitCode=2;
});
