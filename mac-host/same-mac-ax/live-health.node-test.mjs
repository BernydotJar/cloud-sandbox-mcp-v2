import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSameMacWorker,readNativeHealth} from './server.mjs';
function setup(){
 let health={ax_permission:true,process_text_ready:true};const runs=[];
 const worker=createSameMacWorker({runner:request=>{runs.push(request);return {windows:['Test'],frontmost_unchanged:true};},
  ledger:{get:()=>undefined,append:()=>{}},allowedBundles:['com.microsoft.edgemac'],
  machineDigest:'a'.repeat(64),expectedMachineDigest:'a'.repeat(64),
  guiSession:true,axPermission:true,processTextEnabled:true,
  healthProbe:()=>{if(health instanceof Error)throw health;return health;}});
 return {worker,runs,set:v=>{health=v;}};
}
test('permission loss after startup is reported live and prevents native execution',()=>{
 const f=setup();assert.equal(f.worker.status().ready,true);
 f.set({ax_permission:false,process_text_ready:false});
 const status=f.worker.status();assert.equal(status.ready,false);assert.equal(status.ax_permission,false);assert.equal(status.process_scoped_keyboard,false);
 assert.throws(()=>f.worker.windows({bundle_id:'com.microsoft.edgemac'}),/SAME_MAC_AX_NOT_READY/);
 assert.equal(f.runs.length,0);
});
test('restored consent is detected without an unnecessary service restart',()=>{
 const f=setup();f.set({ax_permission:false});assert.equal(f.worker.status().ready,false);
 f.set({ax_permission:true,process_text_ready:true});
 assert.equal(f.worker.status().ready,true);
 assert.equal(f.worker.status().process_scoped_keyboard,true);
 f.worker.windows({bundle_id:'com.microsoft.edgemac'});assert.equal(f.runs.length,1);
});
test('failed health probe fails closed and process text has its own readiness',()=>{
 const f=setup();f.set(new Error('helper unavailable'));assert.equal(f.worker.status().ready,false);
 f.set({ax_permission:true,process_text_ready:false});const status=f.worker.status();
 assert.equal(status.ready,true);assert.equal(status.background_scope,'AX_SEMANTIC_ONLY');assert(!status.supported.includes('process_unicode'));
});

test('an unavailable text helper does not falsely revoke ordinary AX health',()=>{
 const result=readNativeHealth({runner:()=>({ax_permission:true}),textRunner:()=>{throw Error('ENOENT');},processTextEnabled:true});
 assert.deepEqual(result,{ax_permission:true,process_text_ready:false});
});
