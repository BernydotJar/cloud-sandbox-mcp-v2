/* global fetch, AbortSignal */
/**
 * Read-only CDP check on the operator's Mac. No CLI/control actions on browser,
 * no tab navigation, no browser creation/restarts, no raw CDP URL output.
 *
 * Checks actual Playwright channel attach to already running Edge and
 * compares safely sanitized page identifiers against the existing JXA
 * inventory. Uses the installed Mac host Playwright library only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {inspectDebugMarker,matchingTabs} from './provider-config.mjs';
import {edgeCdpVerdict} from './edge-cdp-diagnosis.mjs';

const say=(key,value)=>process.stdout.write('[Edge CDP Doctor] '+key+'='+String(value)+'\n');
function inspectEnv(){
  let raw;
  try{
    const info=JSON.parse(execFileSync('docker',['inspect','cloud-sandbox-mcp'],{
      encoding:'utf8',timeout:8000,stdio:['ignore','pipe','pipe']
    }))[0];
    if(!info?.State?.Running ||
      info?.Config?.Labels?.['com.docker.compose.service']!=='mcp')
      return {code:'CONTROLLER_NOT_RUNNING'};
    const base=info.Config.Labels['com.docker.compose.project.working_dir'];
    if(typeof base!=='string'||!base.startsWith('/'))
      return {code:'CONTROLLER_PATH_UNKNOWN'};
    const file=path.join(fs.realpathSync(base),'.env');
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
      st.size>2000000)return {code:'UNSAFE_CONFIG'};
    raw=fs.readFileSync(file,'utf8');
  }catch{return {code:'CONTROLLER_CONFIG_UNAVAILABLE'};}
  const get=key=>{
    const list=raw.split(/\r?\n/).filter(line=>line.startsWith(key+'='));
    if(list.length!==1)return null;
    const v=list[0].slice(key.length+1).trim();
    return v.startsWith('"')&&v.endsWith('"') ||
      v.startsWith("'")&&v.endsWith("'") ?v.slice(1,-1):v;
  };
  const token=get('COMPUTER_USE_BRIDGE_TOKEN');
  const port=Number(get('COMPUTER_USE_BRIDGE_PORT')||9764);
  if(!token||token.length<32||!Number.isInteger(port)||port<1024||port>65535)
    return {code:'BRIDGE_TOKEN_OR_PORT_INVALID'};
  return {token,port,code:'READY'};
}
async function bridgePost(env,route,input={}){
  const r=await fetch('http://127.0.0.1:'+env.port+route,{
    method:'POST',
    headers:{authorization:'Bearer '+env.token,'content-type':'application/json'},
    body:JSON.stringify(input),signal:AbortSignal.timeout(5000)
  });
  const json=await r.json();
  if(!r.ok || json?.ok!==true)throw Error('BRIDGE_REPLY_NOT_READY');
  return json.data;
}
function markerStatus(){
  const file=path.join(os.homedir(),
    'Library/Application Support/Microsoft Edge/DevToolsActivePort');
  try{
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>256)return 'invalid';
    inspectDebugMarker(fs.readFileSync(file));
    return 'valid';
  }catch(error){return error?.code==='ENOENT'?'missing':'invalid';}
}
async function main(){
  say('MODE','READ_ONLY_NO_BROWSER_CHANGES');
  if(process.platform!=='darwin'){say('STOP','MACOS_ONLY');process.exitCode=2;return;}
  const state={
    edgeRunning:null,marker:markerStatus(),packageReady:false,
    attached:null,identityVerified:false,bridgeConfigured:false,
    browserRouting:'unknown'
  };
  let nativeUrls=[];
  const env=inspectEnv();
  say('BRIDGE_CONFIG',env.code);
  if(env.code==='READY'){
    try{
      const [native,runtime]=await Promise.all([
        bridgePost(env,'/v1/state',{browser:'edge'}),
        bridgePost(env,'/v2/browser/status')
      ]);
      const edge=native?.browsers?.find(b=>b.browser==='edge');
      state.edgeRunning=edge?.running===true;
      nativeUrls=(edge?.windows||[]).flatMap(w=>(w.tabs||[]).map(t=>t.url));
      const prov=runtime?.providers?.find(p=>p.browser==='edge');
      state.bridgeConfigured=Boolean(prov?.configured&&prov.protocol==='cdp');
      state.browserRouting=typeof runtime?.browser_routing==='object'
        ?runtime.browser_routing.edge:runtime?.browser_routing;
      say('BRIDGE_EDGE_PROVIDER',prov?.connected?'CONNECTED':prov?.configured?'CONFIGURED_NOT_CONNECTED':'UNCONFIGURED');
      say('BRIDGE_EDGE_ATTACH_FAILURE',prov?.attach_failure_code||'NONE');
      say('BRIDGE_EDGE_ROUTING',state.browserRouting||'UNKNOWN');
      say('EDGE_RUNNING',edge?.running===true?'YES':'NO_OR_UNKNOWN');
    }catch{
      say('BRIDGE_QUERY','UNAVAILABLE');
    }
  }
  say('EDGE_REMOTE_DEBUGGING_MARKER',state.marker.toUpperCase());
  if(state.marker==='missing'){
    say('EDGE_ENABLEMENT','edge://inspect/#remote-debugging');
    say('OPERATOR_ACTION','CHECK_ALLOW_REMOTE_DEBUGGING_FOR_THIS_BROWSER_INSTANCE');
  }
  const hostRoot=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxComputerUse');
  const packageFile=path.join(hostRoot,'node_modules','playwright-core','package.json');
  const library=path.join(hostRoot,'node_modules','playwright-core','index.mjs');
  try{
    const st=fs.lstatSync(packageFile);
    if(!st.isFile()||st.isSymbolicLink())throw Error('UNSAFE_PACKAGE');
    const version=JSON.parse(fs.readFileSync(packageFile,'utf8')).version;
    state.packageReady=version==='1.64.0' && fs.existsSync(library);
    say('MAC_PLAYWRIGHT_CORE',state.packageReady?'1.64.0_READY':'MISMATCH_OR_MISSING');
  }catch{say('MAC_PLAYWRIGHT_CORE','NOT_AVAILABLE');}
  if(state.marker==='valid' && state.packageReady && state.edgeRunning!==false){
    let browser;
    try{
      const {chromium}=await import(pathToFileURL(library).href);
      browser=await chromium.connectOverCDP('msedge',{timeout:11000,noDefaults:true});
      state.attached=browser.isConnected();
      if(state.attached){
        const urls=browser.contexts().flatMap(ctx=>
          ctx.pages().filter(page=>!page.isClosed()).map(page=>page.url()));
        const matched=matchingTabs(urls,nativeUrls);
        state.identityVerified=matched.verified;
        say('CDP_ATTACHED','YES');
        say('MATCHED_EXISTING_TABS',matched.matched_pages);
        say('PROFILE_IDENTITY',matched.verified?'VERIFIED':'NOT_VERIFIED');
      }else say('CDP_ATTACHED','NO');
    }catch(error){
      state.attached=false;
      const raw=String(error?.message||'');
      // Only an allowlisted error CATEGORY is emitted, never the original
      // message, WebSocket URL or browser-managed local port.
      const category=/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(raw)
        ?'CONNECTION_REFUSED':/timeout|ETIMEDOUT/i.test(raw)
          ?'TIMEOUT':/permission|EACCES/i.test(raw)
            ?'PERMISSION_OR_POLICY':'CHANNEL_ATTACH_FAILED';
      say('CDP_ATTACHED','NO');
      say('CDP_ERROR_CLASS',category);
    }finally{if(browser)await browser.close().catch(()=>{});}
  }else{
    say('CDP_ATTACHED','NOT_ATTEMPTED');
  }
  const verdict=edgeCdpVerdict(state);
  say('VERDICT',verdict);
  say('DISCLOSURE','NO_PAGE_URLS_NO_TITLES_NO_TOKENS_NO_BROWSER_MUTATIONS');
  say('NEXT',verdict==='CDP_IDENTITY_PASS_RETRY_BROWSER_TABS'
    ?'CALL_MCP_BROWSER_TABS_EDGE_AND_REQUIRE_PROVIDER_PERSISTENT'
    :'DO_NOT_CLAIM_GH04_GH05_PASS_WITHOUT_INDEPENDENT_EVIDENCE');
}
main().catch(error=>{
  say('STOP',String(error?.code||error?.name||'UNKNOWN').slice(0,80));
  process.exitCode=2;
});
