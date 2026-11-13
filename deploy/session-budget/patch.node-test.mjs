import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL} from 'node:url';
import {applyBudgetEdits} from './patch.mjs';
const fixture=(filename,version)=>fs.readFileSync(new URL('./fixtures/'+filename.split('/').at(-1).replace('.mjs','-'+version+'.mjs.fixture'),import.meta.url),'utf8');
const readOld=filename=>fixture(filename,'before');
test('surgical bridge patch exactly matches reviewed and unit-tested bounded implementation',()=>{
 for(const [kind,filename] of [['bridge','mac-host/bridge.mjs'],
   ['store','mac-host/autonomy-session.mjs']]){
   const before=readOld(filename);
   const result=applyBudgetEdits(before,kind);
   assert.equal(result.source,fixture(filename,'bounded'));
   assert(result.editsApplied>=4);
   assert.equal(applyBudgetEdits(result.source,kind).editsApplied,0);
 }
});
test('unsupported Mac host drift fails closed and never invents a permission bypass',()=>{
 assert.throws(()=>applyBudgetEdits('unrecognized custom source','bridge'),
   /UNKNOWN_MAC_BRIDGE_BASELINE/);
 assert.throws(()=>applyBudgetEdits('','store'),/UNKNOWN_MAC_BRIDGE_BASELINE/);
});
