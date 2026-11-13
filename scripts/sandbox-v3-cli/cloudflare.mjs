import fs from 'node:fs';

const services=Object.freeze([
  {label:'system/com.cloud-sandbox.cloudflared',
    plist:'/Library/LaunchDaemons/com.cloud-sandbox.cloudflared.plist'},
  {label:'system/com.cloudflare.cloudflared',
    plist:'/Library/LaunchDaemons/com.cloudflare.cloudflared.plist'},
]);

export const EXISTING_TUNNEL='cloud-sandbox-mac';

export function parseLaunchdPrint(raw,label){
  if(!services.some(entry=>entry.label===label))
    throw Error('CLOUDFLARE_LAUNCHD_LABEL_NOT_ALLOWED');
  const text=String(raw);
  if(text.length>180000)throw Error('CLOUDFLARE_LAUNCHD_STATUS_OVERSIZE');
  const state=text.match(/^\s*state\s*=\s*([A-Za-z_-]+)\s*$/m)?.[1]??'unknown';
  const pidString=text.match(/^\s*pid\s*=\s*(\d+)\s*$/m)?.[1];
  const pid=pidString?Number(pidString):null;
  return {state,pid,running:state==='running'&&Number.isInteger(pid)&&pid>0};
}

export function inspectCloudflare({exec}){
  if(typeof exec!=='function')throw Error('CLOUDFLARE_EXEC_REQUIRED');
  const loaded=[];
  for(const service of services){
    const result=exec('/bin/launchctl',['print',service.label],7500);
    if(result.ok){
      loaded.push({...service,...parseLaunchdPrint(result.stdout,service.label)});
    }
  }
  const active=loaded.find(s=>s.running);
  const selected=active??loaded[0]??null;
  return {running:Boolean(active),selected,loaded,knownLabels:services.map(s=>s.label)};
}

export function validateExistingCloudflarePlist({exec,stat=fs.lstatSync,filename,label}){
  const service=services.find(x=>x.label===label&&x.plist===filename);
  if(!service)throw Error('CLOUDFLARE_PLIST_PATH_NOT_ALLOWED');
  let fileInfo;
  try{fileInfo=stat(filename);}
  catch(error){
    if(error.code==='ENOENT')throw Error('CLOUDFLARE_EXISTING_PLIST_MISSING');
    throw error;
  }
  if(!fileInfo.isFile()||fileInfo.isSymbolicLink()||
     fileInfo.uid!==0||(fileInfo.mode&0o022)!==0)
    throw Error('CLOUDFLARE_PLIST_UNTRUSTED');
  const actualLabel=exec('/usr/bin/plutil',
    ['-extract','Label','raw','-o','-',filename],7000);
  if(!actualLabel.ok||actualLabel.stdout.trim()!==label.split('/')[1])
    throw Error('CLOUDFLARE_PLIST_LABEL_MISMATCH');
  const args=exec('/usr/bin/plutil',
    ['-extract','ProgramArguments','json','-o','-',filename],7000);
  let parsed;
  try{parsed=JSON.parse(args.stdout);}catch{
    throw Error('CLOUDFLARE_PLIST_ARGUMENTS_UNREADABLE');
  }
  if(!args.ok||!Array.isArray(parsed)||parsed.length<1||
     parsed.length>30||!parsed.some(value=>
       typeof value==='string'&&/(^|\/)cloudflared$/.test(value)))
    throw Error('CLOUDFLARE_PLIST_NOT_CLOUDFLARED');
  return service;
}

export async function ensureCloudflare({
  exec,
  privileged,
  stat=fs.lstatSync,
  sleep=async()=>{},
  attempts=12,
}){
  if(typeof privileged!=='function')throw Error('CLOUDFLARE_PRIVILEGED_EXEC_REQUIRED');
  const first=inspectCloudflare({exec});
  if(first.running){
    return {state:'ALREADY_RUNNING',service:first.selected.label,
      tunnel:EXISTING_TUNNEL,changed:false};
  }
  let chosen=first.selected;
  if(chosen){
    // Without -k: never kill an already running Cloudflare daemon.
    const operation=['kickstart',chosen.label];
    if(!privileged(operation))throw Error('CLOUDFLARE_LAUNCHD_START_NEEDS_ADMIN');
  }else{
    let found=false;
    for(const service of services){
      try{
        validateExistingCloudflarePlist({exec,stat,
          filename:service.plist,label:service.label});
        chosen=service;found=true;break;
      }catch(error){
        if(error.message==='CLOUDFLARE_EXISTING_PLIST_MISSING')continue;
        throw error;
      }
    }
    if(!found)throw Error('EXISTING_CLOUDFLARE_LAUNCHDAEMON_NOT_FOUND');
    // Load only the preexisting root-owned approved LaunchDaemon.
    if(!privileged(['bootstrap','system',chosen.plist]))
      throw Error('CLOUDFLARE_BOOTSTRAP_NEEDS_ADMIN');
    // A pre-existing plist may lack RunAtLoad. Non-force kickstart
    // is safe after bootstrap and does not terminate an active daemon.
    const afterLoad=inspectCloudflare({exec});
    if(!afterLoad.running &&
       !privileged(['kickstart',chosen.label]))
      throw Error('CLOUDFLARE_LAUNCHD_START_NEEDS_ADMIN');
  }
  for(let attempt=0;attempt<attempts;attempt++){
    const status=inspectCloudflare({exec});
    if(status.running)return {state:'STARTED_EXISTING_SERVICE',
      service:status.selected.label,tunnel:EXISTING_TUNNEL,changed:true};
    if(attempt<attempts-1)await sleep(800);
  }
  throw Error('CLOUDFLARE_SERVICE_NOT_RUNNING_AFTER_START');
}
