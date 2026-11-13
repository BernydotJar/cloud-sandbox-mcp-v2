import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {activate,validatePlan} from './install-on-mac.mjs';
import {applyTaskEdits} from './patch.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const actual={a:'previous bridge',b:'previous controller'},payload={a:'scoped bridge',b:'scoped controller'};
const manifest={files:Object.fromEntries(Object.keys(actual).map(n=>[n,{before:sha(actual[n]),after:sha(payload[n])}]))};
test('installer refuses live code drift and active delegations without changing anything',async()=>{
 assert.throws(()=>validatePlan(manifest,{...actual,a:'unrelated edit'}),/LIVE_CODE_DRIFT/);
 let writes=0;
 await assert.rejects(activate({manifest,actual,payload,status:async()=>({active:true}),write:async()=>writes++}),/ACTIVE_TASK_SESSION/);
 assert.equal(writes,0);
});
test('install failure restores all touched files before restarting the same services',async()=>{
 const disk={...actual},restarts=[];
 await assert.rejects(activate({manifest,actual,payload,status:async()=>({active:false}),
  write:async(n,v)=>disk[n]=v,restart:async()=>restarts.push(true),verify:async()=>{throw Error('HEALTH_FAILED');}}),/ROLLED_BACK_HEALTH_FAILED/);
 assert.deepEqual(disk,actual);assert.equal(restarts.length,2);
});
test('successful promotion is idempotent and does not need a second restart',async()=>{
 const disk={...actual};let restarts=0;
 await activate({manifest,actual,payload,status:async()=>({active:false}),write:async(n,v)=>disk[n]=v,restart:async()=>restarts++,verify:async()=>{}});
 assert.deepEqual(disk,payload);assert.equal(restarts,1);
 assert.deepEqual(await activate({manifest,actual:disk,payload,status:async()=>({active:false})}),{already_installed:true});
});
test('unknown source cannot be patched into a permission bypass',()=>{
 assert.throws(()=>applyTaskEdits('unknown code','bridge.mjs'),/UNKNOWN_INSTALLED_BASELINE/);
});
