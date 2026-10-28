import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const MAC_BRIDGE_LABEL='com.lch.cloud-sandbox.computer-use';
export function bridgeIdentity({uid=process.getuid(),home=os.homedir()}={}){
  return {label:'gui/'+uid+'/'+MAC_BRIDGE_LABEL,
    plist:path.join(home,'Library/LaunchAgents/'+MAC_BRIDGE_LABEL+'.plist'),
    bridge:path.join(home,'Library/Application Support/LCH/CloudSandboxComputerUse/bridge.mjs')};
}
export function inspectBridgeLaunchd({exec,identity=bridgeIdentity()}){
  const result=exec('/bin/launchctl',['print',identity.label],6000);
  if(!result.ok)return {loaded:false,running:false,code:'NOT_LOADED'};
  const data=String(result.stdout??'');
  if(data.length>140000)throw Error('MAC_BRIDGE_LAUNCHD_OVERSIZED');
  const state=data.match(/^\s*state\s*=\s*([a-z_-]+)\s*$/mi)?.[1]??'unknown';
  const pid=Number(data.match(/^\s*pid\s*=\s*(\d+)\s*$/m)?.[1]??0);
  const running=state==='running'&&pid>0;
  return {loaded:true,running,code:running?'RUNNING':'STOPPED',
    pid:running?pid:null};
}
export function validateExistingBridgePlist({exec,stat=fs.lstatSync,
  identity=bridgeIdentity()}){
  let info;
  try{info=stat(identity.plist);}catch(error){
    if(error.code==='ENOENT')throw Error('MAC_BRIDGE_LAUNCHAGENT_NOT_INSTALLED');
    throw error;
  }
  if(!info.isFile()||info.isSymbolicLink()||
     info.uid!==process.getuid()||(info.mode&0o022)!==0)
    throw Error('MAC_BRIDGE_LAUNCHAGENT_UNTRUSTED');
  const label=exec('/usr/bin/plutil',
    ['-extract','Label','raw','-o','-',identity.plist],6000);
  if(!label.ok||label.stdout.trim()!==MAC_BRIDGE_LABEL)
    throw Error('MAC_BRIDGE_LAUNCHAGENT_LABEL_MISMATCH');
  const args=exec('/usr/bin/plutil',
    ['-extract','ProgramArguments','json','-o','-',identity.plist],6000);
  let parsed;
  try{parsed=JSON.parse(args.stdout);}catch{
    throw Error('MAC_BRIDGE_LAUNCHAGENT_ARGUMENTS_UNREADABLE');
  }
  if(!args.ok||!Array.isArray(parsed)||parsed.length!==2||
     typeof parsed[0]!=='string'||!path.isAbsolute(parsed[0])||
     parsed[1]!==identity.bridge)
    throw Error('MAC_BRIDGE_LAUNCHAGENT_EXECUTABLE_UNRECOGNIZED');
  return identity;
}
function listenerReady(status){
  return status?.status==='ok'&&
    ['AUTH_GATE_401','AUTH_GATE_403'].includes(status.code);
}
export async function ensureMacBridge({exec,probe,identity=bridgeIdentity(),
  sleep=async()=>{},stat=fs.lstatSync,attempts=14}){
  if(typeof exec!=='function'||typeof probe!=='function')
    throw Error('MAC_BRIDGE_DEPENDENCY_INVALID');
  const current=inspectBridgeLaunchd({exec,identity});
  const listener=await probe();
  if(listenerReady(listener)){
    return {code:current.running?'ALREADY_RUNNING':'LISTENER_REACHABLE_NO_RESTART',
      changed:false,listener:true,launchd:current.code};
  }
  if(current.running){
    // Never use kickstart -k on a live Bridge, because this could revoke
    // another agent's delegated browsing session or lose an action ledger.
    for(let i=0;i<attempts;i++){
      if(listenerReady(await probe()))
        return {code:'ALREADY_RUNNING',changed:false,
          listener:true,launchd:'RUNNING'};
      if(i+1<attempts)await sleep(550);
    }
    throw Error('MAC_BRIDGE_RUNNING_BUT_HTTP_NOT_READY_NO_FORCED_RESTART');
  }
  if(!current.loaded)validateExistingBridgePlist({exec,stat,identity});
  const command=current.loaded?
    ['kickstart',identity.label]:
    ['bootstrap',identity.label.split('/').slice(0,2).join('/'),identity.plist];
  const start=exec('/bin/launchctl',command,12000);
  if(!start.ok)throw Error('MAC_BRIDGE_EXISTING_LAUNCHAGENT_START_FAILED');
  if(!current.loaded){
    const loaded=inspectBridgeLaunchd({exec,identity});
    if(loaded.loaded&&!loaded.running){
      const kick=exec('/bin/launchctl',['kickstart',identity.label],9000);
      if(!kick.ok)throw Error('MAC_BRIDGE_KICKSTART_AFTER_BOOTSTRAP_FAILED');
    }
  }
  for(let i=0;i<attempts;i++){
    if(listenerReady(await probe())){
      const after=inspectBridgeLaunchd({exec,identity});
      return {code:'STARTED_EXISTING_LAUNCHAGENT',changed:true,
        listener:true,launchd:after.code};
    }
    if(i+1<attempts)await sleep(550);
  }
  throw Error('MAC_BRIDGE_STARTED_BUT_HTTP_NOT_READY');
}
