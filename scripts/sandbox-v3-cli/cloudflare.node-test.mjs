import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCloudflare,ensureCloudflare,
  parseLaunchdPrint,validateExistingCloudflarePlist,EXISTING_TUNNEL} from './cloudflare.mjs';

const canonical='system/com.cloud-sandbox.cloudflared';
const alternative='system/com.cloudflare.cloudflared';
const canonicalPlist='/Library/LaunchDaemons/com.cloud-sandbox.cloudflared.plist';
const printed=(label,state='running',pid='1217')=>
  label+' = {\n  state = '+state+'\n  pid = '+pid+'\n  runs = 2\n}\n';
function harness({current='running',fallback=false}={}){
  let phase=current;
  const events=[];
  const exec=(cmd,args)=>{
    events.push({cmd,args});
    if(cmd==='/bin/launchctl'&&args[0]==='print'){
      if(args[1]===(fallback?alternative:canonical)){
        if(phase==='not-loaded')return {ok:false,stdout:''};
        return {ok:true,stdout:printed(args[1],phase,'332')};
      }
      return {ok:false,stdout:''};
    }
    return {ok:false,stdout:''};
  };
  const privileged=(args)=>{
    events.push({cmd:'PRIVILEGED',args});
    if(args[0]==='kickstart')phase='running';
    return true;
  };
  return {exec,privileged,events};
}
test('canonical existing system LaunchDaemon has strict allowlisted identity',()=>{
  assert.equal(EXISTING_TUNNEL,'cloud-sandbox-mac');
  assert.deepEqual(parseLaunchdPrint(printed(canonical),canonical),
    {state:'running',pid:1217,running:true});
  assert.equal(parseLaunchdPrint(printed(canonical,'waiting','0'),canonical).running,false);
  assert.throws(()=>parseLaunchdPrint(printed('system/untrusted'),'system/untrusted'),
    /CLOUDFLARE_LAUNCHD_LABEL_NOT_ALLOWED/);
});
test('running Cloudflare service is reused without sudo, restart or duplication',async()=>{
  const h=harness();
  const status=inspectCloudflare(h);
  assert.equal(status.running,true);
  assert.equal(status.selected.label,canonical);
  const started=await ensureCloudflare({...h,attempts:2});
  assert.equal(started.state,'ALREADY_RUNNING');
  assert.equal(started.service,canonical);
  assert.equal(started.changed,false);
  assert.equal(h.events.filter(x=>x.cmd==='PRIVILEGED').length,0);
});
test('stopped loaded launchd service kickstarts without force-killing running daemon',async()=>{
  const h=harness({current:'waiting'});
  const state=await ensureCloudflare({...h,attempts:3,sleep:async()=>{}});
  assert.equal(state.state,'STARTED_EXISTING_SERVICE');
  const privileged=h.events.filter(x=>x.cmd==='PRIVILEGED');
  assert.deepEqual(privileged[0].args,['kickstart',canonical]);
  assert.equal(privileged.length,1);
  assert(!privileged[0].args.includes('-k'));
});
test('alternate known legacy Cloudflare LaunchDaemon is reused, never duplicated',async()=>{
  const h=harness({fallback:true});
  const state=await ensureCloudflare({...h,attempts:2});
  assert.equal(state.service,alternative);
  assert.equal(h.events.filter(x=>x.cmd==='PRIVILEGED').length,0);
});
test('missing loaded service and no verified plist blocks new tunnel creation',async()=>{
  const h=harness({current:'not-loaded'});
  const noFile=()=>{
    const error=new Error('not present');error.code='ENOENT';throw error;
  };
  await assert.rejects(ensureCloudflare({...h,stat:noFile}),
    /EXISTING_CLOUDFLARE_LAUNCHDAEMON_NOT_FOUND/);
  assert.equal(h.events.filter(x=>x.cmd==='PRIVILEGED').length,0);
});
test('only root-owned nonwritable known Cloudflare plist can be bootstrapped',()=>{
  const exec=(cmd,args)=>{
    if(cmd==='/usr/bin/plutil'&&args.includes('Label'))
      return {ok:true,stdout:'com.cloud-sandbox.cloudflared'};
    if(cmd==='/usr/bin/plutil'&&args.includes('ProgramArguments'))
      return {ok:true,stdout:JSON.stringify([
        '/opt/homebrew/bin/cloudflared','--config',
        '/etc/cloudflared/config.yml','tunnel','run'])};
    return {ok:false,stdout:''};
  };
  const rootFile=()=>({isFile:()=>true,isSymbolicLink:()=>false,
    uid:0,mode:0o100644});
  assert.equal(validateExistingCloudflarePlist({
    exec,stat:rootFile,filename:canonicalPlist,label:canonical
  }).label,canonical);
  assert.throws(()=>validateExistingCloudflarePlist({
    exec,stat:()=>({...rootFile(),uid:501}),
    filename:canonicalPlist,label:canonical
  }),/CLOUDFLARE_PLIST_UNTRUSTED/);
  assert.throws(()=>validateExistingCloudflarePlist({
    exec,stat:rootFile,
    filename:'/Users/operator/custom-tunnel.plist',label:canonical
  }),/CLOUDFLARE_PLIST_PATH_NOT_ALLOWED/);
});
test('bootstraps only existing validated system plist when daemon is not loaded',async()=>{
  let phase='not-loaded';
  const calls=[];
  const exec=(cmd,args)=>{
    calls.push({cmd,args});
    if(cmd==='/bin/launchctl'){
      if(phase==='not-loaded')return {ok:false,stdout:''};
      if(args[1]===canonical)return {ok:true,
        stdout:printed(canonical,'running','715')};
      return {ok:false,stdout:''};
    }
    if(cmd==='/usr/bin/plutil'&&args.includes('Label')){
      return {ok:true,stdout:'com.cloud-sandbox.cloudflared'};
    }
    if(cmd==='/usr/bin/plutil'&&args.includes('ProgramArguments')){
      return {ok:true,stdout:JSON.stringify(['/opt/homebrew/bin/cloudflared','tunnel','run'])};
    }
    return {ok:false,stdout:''};
  };
  const state=await ensureCloudflare({exec,attempts:2,
    stat:()=>({isFile:()=>true,isSymbolicLink:()=>false,
      uid:0,mode:0o100644}),
    privileged:args=>{
      calls.push({cmd:'PRIVILEGED',args});phase='running';return true;
    }});
  assert.equal(state.state,'STARTED_EXISTING_SERVICE');
  assert.deepEqual(calls.filter(x=>x.cmd==='PRIVILEGED').map(x=>x.args),[
    ['bootstrap','system',canonicalPlist]
  ]);
});
test('missing privilege fails closed and never reports Cloudflare as started',async()=>{
  const h=harness({current:'waiting'});
  await assert.rejects(ensureCloudflare({...h,privileged:()=>false,attempts:1}),
    /CLOUDFLARE_LAUNCHD_START_NEEDS_ADMIN/);
});
test('status is strictly observational, even if no Cloudflare service is loaded',()=>{
  const h=harness({current:'not-loaded'});
  const state=inspectCloudflare({exec:h.exec});
  assert.equal(state.running,false);
  assert.equal(state.selected,null);
  assert.equal(h.events.filter(x=>x.cmd==='PRIVILEGED').length,0);
});

test('a bootstrapped existing plist that stays waiting gets non-force kickstart',async()=>{
  let phase='not-loaded';
  const calls=[];
  const exec=(cmd,args)=>{
    if(cmd==='/bin/launchctl'&&args[0]==='print'){
      if(phase==='not-loaded')return {ok:false,stdout:''};
      if(args[1]===canonical)return {ok:true,
        stdout:printed(canonical,phase,'771')};
      return {ok:false,stdout:''};
    }
    if(cmd==='/usr/bin/plutil'&&args.includes('Label'))
      return {ok:true,stdout:'com.cloud-sandbox.cloudflared'};
    if(cmd==='/usr/bin/plutil'&&args.includes('ProgramArguments'))
      return {ok:true,stdout:JSON.stringify(['/opt/homebrew/bin/cloudflared','tunnel','run'])};
    return {ok:false,stdout:''};
  };
  const result=await ensureCloudflare({exec,attempts:3,
    stat:()=>({isFile:()=>true,isSymbolicLink:()=>false,
      uid:0,mode:0o100644}),
    privileged:args=>{
      calls.push(args);
      phase=args[0]==='bootstrap'?'waiting':'running';
      return true;
    }});
  assert.equal(result.state,'STARTED_EXISTING_SERVICE');
  assert.deepEqual(calls,[
    ['bootstrap','system',canonicalPlist],
    ['kickstart',canonical]
  ]);
  assert(!calls.flat().includes('-k'));
});
