import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSameMacWorker,createLedger,validObservation} from './server.mjs';
const bundle='com.microsoft.edgemac',machine='a'.repeat(64),hash='c'.repeat(64);
function fixture(enabled=true) {
 const calls=[];const raw={provider:'same_mac_background_ax',revision:'b'.repeat(64),frontmost_unchanged:true,nodes:[{path:Array(20).fill(0),role:'AXTextArea',name:'Type a message',enabled:true,fingerprint:'d'.repeat(64),press_available:true,value_observation:{kind:'text_digest',length:15,sha256:hash,has_value:true}}]};
 const worker=createSameMacWorker({runner:r=>{calls.push(r);if(r.operation==='windows')return {windows:['Own chat'],frontmost_unchanged:true};if(r.operation==='snapshot')return raw;return {dispatched:true,frontmost_unchanged:true,input_backend:r.text_method==='process_unicode'?'process_unicode':'native_ax'};},ledger:createLedger('unused',{persist:false}),allowedBundles:[bundle],pressBundles:[bundle],processTextEnabled:enabled,machineDigest:machine,expectedMachineDigest:machine});
 return {worker,calls,raw};
}
const target={bundle_id:bundle,window_title:'Own chat'};
test('text observations expose a digest rather than message content',()=>{
 assert.deepEqual(validObservation({kind:'text_digest',length:15,sha256:hash,has_value:true},'AXTextArea'),{kind:'text_digest',length:15,sha256:hash,has_value:true});
 assert.throws(()=>validObservation({kind:'text_digest',length:1,sha256:hash,has_value:true,value:'private'},'AXTextArea'),/INVALID_VALUE/);
});
test('deep browser AX nodes remain bounded and opaque',()=>{
 const f=fixture();const s=f.worker.snapshot(target);assert.equal(s.nodes[0].fill_backend,'process_unicode');assert(!('path' in s.nodes[0]));f.raw.nodes[0].path=Array(31).fill(0);assert.throws(()=>f.worker.snapshot(target),/INVALID_NODE/);
});
test('process text requires configured certification and passes fresh expected digest',()=>{
 const f=fixture();assert.equal(f.worker.status().background_scope,'AX_WITH_CERTIFIED_PROCESS_TEXT');const s=f.worker.snapshot(target);const a={...target,action:'set_value',node_ref:s.nodes[0].node_ref,expected_revision:s.revision,request_id:'e'.repeat(64),value:'',text_method:'process_unicode'};
 const r=f.worker.action(a);assert.equal(r.input_backend,'process_unicode');assert.deepEqual(f.calls[1].expected_text,s.nodes[0].value_observation);assert.equal(f.calls[1].value,'');
 const g=fixture(false),snap=g.worker.snapshot(target);assert.equal(snap.nodes[0].fill_backend,undefined);assert.throws(()=>g.worker.action({...a,node_ref:snap.nodes[0].node_ref}),/NOT_CERTIFIED/);
});
test('window discovery is restricted to allowed application bundles',()=>{
 const f=fixture();assert.deepEqual(f.worker.windows({bundle_id:bundle}).windows,['Own chat']);assert.throws(()=>f.worker.windows({bundle_id:'com.apple.Terminal'}),/TARGET_DENIED/);
});
