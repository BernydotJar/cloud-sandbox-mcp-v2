import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {bridgeIdentity,inspectBridgeLaunchd,
  validateExistingBridgePlist,ensureMacBridge,MAC_BRIDGE_LABEL
} from './bridge-launchd.mjs';

const identity=bridgeIdentity({uid:501,home:'/Users/fixture'});
const status=code=>({status:code===403?'ok':'warn',
  code:code===403?'AUTH_GATE_403':'BRIDGE_CONNECTION'});
const state=(mode='running')=>({
  ok:mode!=='missing',
  stdout:mode==='missing'?'':[
    'service = {',
    ' state = '+mode,
    ...(mode==='running'?[' pid = 873']:[]),
    '}'].join('\n')
});
test('exact current-user LaunchAgent identity and executable location',()=>{
  assert.equal(MAC_BRIDGE_LABEL,'com.lch.cloud-sandbox.computer-use');
  assert.equal(identity.label,'gui/501/com.lch.cloud-sandbox.computer-use');
  assert.equal(identity.bridge,
    '/Users/fixture/Library/Application Support/LCH/CloudSandboxComputerUse/bridge.mjs');
});
test('an active Bridge is left untouched: no Chrome restarts and no launchctl mutation',async()=>{
  const calls=[];
  const exec=(cmd,args)=>{calls.push([cmd,...args]);return state();};
  const result=await ensureMacBridge({exec,identity,probe:async()=>status(403)});
  assert.equal(result.code,'ALREADY_RUNNING');
  assert.equal(result.changed,false);
  assert.equal(calls.filter(args=>args.includes('kickstart')).length,0);
  assert.equal(calls.filter(args=>args.includes('bootstrap')).length,0);
});
test('loaded but stopped Bridge is started via non-force kickstart',async()=>{
  let running=false;const calls=[];
  const exec=(cmd,args)=>{
    calls.push([cmd,...args]);
    if(args[0]==='kickstart'){running=true;return {ok:true,stdout:''};}
    return state(running?'running':'waiting');
  };
  const result=await ensureMacBridge({
    exec,identity,probe:async()=>status(running?403:0),attempts:3});
  assert.equal(result.code,'STARTED_EXISTING_LAUNCHAGENT');
  assert.equal(result.changed,true);
  const action=calls.filter(c=>c.includes('kickstart'));
  assert.deepEqual(action,[['/bin/launchctl','kickstart',identity.label]]);
  assert.equal(action.flat().includes('-k'),false);
});
test('registered and alive but unreachable Bridge is not force-restarted',async()=>{
  const calls=[];
  const exec=(cmd,args)=>{calls.push(args);return state();};
  await assert.rejects(ensureMacBridge({exec,identity,attempts:2,
    probe:async()=>status(0)}),
    /MAC_BRIDGE_RUNNING_BUT_HTTP_NOT_READY_NO_FORCED_RESTART/);
  assert.equal(calls.filter(args=>args[0]==='kickstart').length,0);
});
test('unloaded service with missing/untrusted plist fails closed',async()=>{
  const calls=[];
  const exec=(cmd,args)=>{calls.push(args);return state('missing');};
  const noFile=()=>{const error=new Error('missing');error.code='ENOENT';throw error;};
  await assert.rejects(ensureMacBridge({exec,identity,
    stat:noFile,probe:async()=>status(0)}),
    /MAC_BRIDGE_LAUNCHAGENT_NOT_INSTALLED/);
  assert.equal(calls.filter(args=>args[0]==='bootstrap').length,0);
});
test('valid existing user LaunchAgent allows exact verified bootstrap',async()=>{
  let phase='missing';const calls=[];
  const exec=(cmd,args)=>{
    calls.push([cmd,...args]);
    if(cmd==='/usr/bin/plutil'&&args.includes('Label'))
      return {ok:true,stdout:MAC_BRIDGE_LABEL};
    if(cmd==='/usr/bin/plutil'&&args.includes('ProgramArguments'))
      return {ok:true,stdout:JSON.stringify(['/opt/homebrew/bin/node',identity.bridge])};
    if(cmd==='/bin/launchctl'&&args[0]==='bootstrap'){
      phase='waiting';return {ok:true,stdout:''};
    }
    if(cmd==='/bin/launchctl'&&args[0]==='kickstart'){
      phase='running';return {ok:true,stdout:''};
    }
    return state(phase);
  };
  const stat=()=>({isFile:()=>true,isSymbolicLink:()=>false,
    uid:process.getuid(),mode:0o100600});
  const result=await ensureMacBridge({exec,identity,stat,
    probe:async()=>status(phase==='running'?403:0),attempts:3});
  assert.equal(result.code,'STARTED_EXISTING_LAUNCHAGENT');
  assert.deepEqual(calls.filter(x=>x.includes('bootstrap')),
    [['/bin/launchctl','bootstrap','gui/501',identity.plist]]);
});
test('unexpected LaunchAgent program is not bootstrapped or trusted',()=>{
  const exec=(cmd,args)=>{
    if(args.includes('Label'))return {ok:true,stdout:MAC_BRIDGE_LABEL};
    if(args.includes('ProgramArguments'))
      return {ok:true,stdout:JSON.stringify(['/bin/sh','/tmp/malicious.sh'])};
    return {ok:false,stdout:''};
  };
  assert.throws(()=>validateExistingBridgePlist({
    exec,identity,
    stat:()=>({isFile:()=>true,isSymbolicLink:()=>false,
      uid:process.getuid(),mode:0o100600})
  }),/MAC_BRIDGE_LAUNCHAGENT_EXECUTABLE_UNRECOGNIZED/);
});
test('port reachable without a loaded known service never launches a duplicate',async()=>{
  let count=0;
  const exec=()=>{count++;return state('missing');};
  const result=await ensureMacBridge({exec,identity,
    probe:async()=>status(403)});
  assert.equal(result.changed,false);
  assert.equal(result.code,'LISTENER_REACHABLE_NO_RESTART');
  assert.equal(count,1);
});
test('inspect is read-only and distinguishes loaded/running/stopped',()=>{
  const running=inspectBridgeLaunchd({identity,exec:()=>state('running')});
  assert.equal(running.running,true);
  const waiting=inspectBridgeLaunchd({identity,exec:()=>state('waiting')});
  assert.equal(waiting.loaded,true);
  assert.equal(waiting.running,false);
  assert.equal(inspectBridgeLaunchd({identity,
    exec:()=>state('missing')}).code,'NOT_LOADED');
});
