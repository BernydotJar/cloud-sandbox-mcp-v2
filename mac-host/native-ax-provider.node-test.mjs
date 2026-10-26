import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL} from 'node:url';
import {AxNodeReferences} from './native-ax-provider.mjs';
const bounds={x:100,y:80,width:600,height:400};
const target={browser:'edge',expected_url:'https://example.test/week',expected_title:'HCL iTime'};
const row={provider:'native_ax',revision:'a'.repeat(64),nodes:[
 {path:[0,1],role:'AXButton',name:'Next Week',enabled:true,
   fingerprint:'b'.repeat(64),frame_points:{x:500,y:120,width:40,height:22}},
 {path:[0,2],role:'AXTextField',name:'Monday 19 Development',
   enabled:true,fingerprint:'c'.repeat(64),
   frame_points:{x:220,y:210,width:56,height:34}}
]};
test('opaque AX references preserve role and parent without exposing internal path',()=>{
 const refs=new AxNodeReferences();
 const result=refs.snapshot(row,target,bounds);
 assert.equal(result.provider,'native_ax');
 assert.equal(result.ax_revision,'a'.repeat(64));
 assert.equal(result.nodes.length,2);
 assert.match(result.nodes[0].node_ref,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(result).includes('fingerprint'),false);
 assert.equal(JSON.stringify(result).includes('"path"'),false);
 const button=refs.resolve(result.nodes[0].node_ref,result.ax_revision,target,bounds,'ax_press');
 assert.deepEqual(button.path,[0,1]);
});
test('AX element refs expire and revoke safely',()=>{
 let now=1000;const refs=new AxNodeReferences(()=>now);
 const r=refs.snapshot(row,target,bounds);
 now=32001;
 assert.throws(()=>refs.resolve(r.nodes[0].node_ref,r.ax_revision,target,bounds,'ax_press'),/STALE_AX_NODE/);
 const fresh=refs.snapshot(row,target,bounds);
 refs.revokeAll();
 assert.throws(()=>refs.resolve(fresh.nodes[0].node_ref,fresh.ax_revision,target,bounds,'ax_press'),/STALE_AX_NODE/);
});
test('revision, browser and window bounds must match',()=>{
 const refs=new AxNodeReferences(),r=refs.snapshot(row,target,bounds);
 const id=r.nodes[0].node_ref;
 assert.throws(()=>refs.resolve(id,'d'.repeat(64),target,bounds,'ax_press'),/STALE_AX_NODE/);
 assert.throws(()=>refs.resolve(id,r.ax_revision,{...target,browser:'chrome'},bounds,'ax_press'),/AX_TARGET_MISMATCH/);
 assert.throws(()=>refs.resolve(id,r.ax_revision,target,{...bounds,width:640},'ax_press'),/AX_WINDOW_CHANGED/);
});
test('node role/action is enforced and node consumed once',()=>{
 const refs=new AxNodeReferences(),r=refs.snapshot(row,target,bounds);
 assert.throws(()=>refs.resolve(r.nodes[0].node_ref,r.ax_revision,target,bounds,'ax_set_value'),/AX_ACTION_NOT_SUPPORTED/);
 assert.throws(()=>refs.resolve(r.nodes[1].node_ref,r.ax_revision,target,bounds,'ax_press'),/AX_ACTION_NOT_SUPPORTED/);
 const n=refs.resolve(r.nodes[1].node_ref,r.ax_revision,target,bounds,'ax_set_value');
 assert.equal(n.name,'Monday 19 Development');
 refs.consume(r.nodes[1].node_ref);
 assert.throws(()=>refs.resolve(r.nodes[1].node_ref,r.ax_revision,target,bounds,'ax_set_value'),/STALE_AX_NODE/);
});
test('AX rejected disabled/offscreen/credential/ambiguous path snapshots',()=>{
 for(const bad of [
  {...row,nodes:[{...row.nodes[0],enabled:false}]},
  {...row,nodes:[{...row.nodes[0],frame_points:{x:9000,y:9000,width:25,height:25}}]},
  {...row,nodes:[{...row.nodes[1],name:'Password'}]},
  {...row,nodes:[row.nodes[0],{...row.nodes[0]}]}
 ]){
   const refs=new AxNodeReferences();
   if(bad.nodes[0].enabled===false){
     const res=refs.snapshot(bad,target,bounds);
     assert.throws(()=>refs.resolve(res.nodes[0].node_ref,res.ax_revision,target,bounds,'ax_press'),/AX_NODE_UNSAFE/);
   }else if(bad.nodes[0].frame_points?.x===9000) {
     const res=refs.snapshot(bad,target,bounds);
     assert.throws(()=>refs.resolve(res.nodes[0].node_ref,res.ax_revision,target,bounds,'ax_press'),/AX_NODE_UNSAFE/);
   }else assert.throws(()=>refs.snapshot(bad,target,bounds),/AX_INVALID_SNAPSHOT/);
 }
});

test('native AX can read back narrowly permitted hour values without exposing arbitrary text',()=>{
 const refs=new AxNodeReferences();
 const safe={...row,nodes:[
   {...row.nodes[1],value_observation:{
     kind:'hours_numeric',value:'8',has_value:true}}
 ]};
 const inspected=refs.snapshot(safe,target,bounds);
 assert.deepEqual(inspected.nodes[0].value_observation,
   {kind:'hours_numeric',value:'8',has_value:true});
 assert.equal(JSON.stringify(inspected).includes('value_observation'),true);
 assert.equal(JSON.stringify(inspected).includes('fingerprint'),false);
 const redacted=refs.snapshot({...row,nodes:[{
   ...row.nodes[1],value_observation:{kind:'redacted',has_value:true}
 }]},target,bounds);
 assert.deepEqual(redacted.nodes[0].value_observation,
   {kind:'redacted',has_value:true});
});
test('native AX accepts boolean and empty field observations',()=>{
 const refs=new AxNodeReferences();
 const state=refs.snapshot({...row,nodes:[
   {...row.nodes[0],role:'AXCheckBox',value_observation:{
     kind:'boolean',value:false}},
   {...row.nodes[1],value_observation:{kind:'empty',has_value:false}}
 ]},target,bounds);
 assert.equal(state.nodes[0].value_observation.value,false);
 assert.equal(state.nodes[1].value_observation.kind,'empty');
});
test('AX readback rejects raw values, unexpected fields, large numbers or forged role',()=>{
 for(const bad of [
  {...row.nodes[1],value:'candidate@example.com'},
  {...row.nodes[1],AXValue:'secret'},
  {...row.nodes[1],value_observation:{kind:'hours_numeric',value:'123456',has_value:true}},
  {...row.nodes[1],value_observation:{kind:'hours_numeric',value:'200',has_value:true}},
  {...row.nodes[1],value_observation:{kind:'hours_numeric',value:'8',has_value:true,extra:'raw'}},
  {...row.nodes[0],value_observation:{kind:'hours_numeric',value:'8',has_value:true}},
  {...row.nodes[1],value_observation:{kind:'redacted',value:'private note',has_value:true}}
 ]){
  const refs=new AxNodeReferences();
  assert.throws(()=>refs.snapshot({...row,nodes:[bad]},target,bounds),
    /AX_INVALID_VALUE_OBSERVATION/);
 }
});
test('Swift AX helper is readback-only for approved safe values and never sends blind keys',()=>{
 const source=fs.readFileSync(new URL('./native-ax/AXBrowserHelper.swift',import.meta.url),'utf8');
 assert.match(source,/func observeValue\(/);
 assert.match(source,/kAXValueAttribute/);
 assert.match(source,/hours_numeric/);
 assert.match(source,/value_observation/);
 assert.match(source,/redacted/);
 assert.match(source,/NSWorkspace.shared.frontmostApplication/);
 assert(!source.includes('CGEventPost') && !source.includes('keyCode('));
});
