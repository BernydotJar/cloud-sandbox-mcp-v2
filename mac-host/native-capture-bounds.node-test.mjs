import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const driver=process.env.NATIVE_DRIVER_PATH ?? new URL('./native.jxa',import.meta.url);
const code=fs.readFileSync(driver,'utf8');
function capture({browser='edge',rect={x:434,y:98,width:1342,height:687},changed=false}={}) {
  let axReads=0,activated=0,moved=false;
  const tab={title:()=> 'Support',url:()=> 'https://example.test/support'};
  const otherTab={title:()=> 'Other',url:()=> 'https://example.test/other'};
  const other={activeTab:()=>otherTab};
  const window={tabs:()=>[tab],activeTab:()=>tab,bounds(){
    if(rect instanceof Error)throw rect;
    moved=changed;return rect;
  }};
  const app={running:()=>true,windows:()=>moved?[other,window]:[window],activate(){activated++;}};
  const proc={exists:()=>true,frontmost:()=>true,
    windows:[{position(){axReads++;return [600,500];},size(){axReads++;return [66,20];}}]};
  const context={Application(name){
    if(name===(browser==='edge'?'Microsoft Edge':'Google Chrome'))return app;
    if(name==='System Events')return {processes:{[browser==='edge'?'Microsoft Edge':'Google Chrome']:proc}};
    throw Error('Unexpected application');
  }};
  vm.runInNewContext(code,context);
  const result=JSON.parse(context.run(['bounds',browser,'1','1','https://example.test/support','Support']));
  return {result,axReads,activated};
}
for(const browser of ['edge','chrome']) {
  for(const rect of [{x:434,y:98,width:1342,height:687},[434,98,1776,785]]) {
    test(browser+' capture ignores a 66x20 AX auxiliary window ('+(Array.isArray(rect)?'rectangle':'object')+')',()=>{
      const {result,axReads,activated}=capture({browser,rect});
      assert.equal(result.ok,true);
      assert.deepEqual(result.data,{x:434,y:98,width:1342,height:687});
      assert.equal(axReads,0);assert.equal(activated,0);
    });
  }
}
test('invalid browser rectangle fails closed instead of using unrelated AX window',()=>{
  for(const rect of [null,[],[0,0,0,0],{x:0,y:0,width:NaN,height:600},{x:-1,y:0,width:800,height:600},{x:0,y:0,width:6000,height:600}]) {
    const {result,axReads}=capture({rect});
    assert.equal(result.error,'INVALID_BOUNDS');assert.equal(axReads,0);
  }
});
test('unavailable browser rectangle never falls back to auxiliary AX geometry',()=>{
  const {result,axReads}=capture({rect:Error('unavailable')});
  assert.equal(result.ok,false);assert.equal(axReads,0);
});
test('focus changes while reading browser bounds refuse screenshot region',()=>{
  const {result,axReads}=capture({changed:true});
  assert.equal(result.error,'TARGET_CHANGED');assert.equal(axReads,0);
});
