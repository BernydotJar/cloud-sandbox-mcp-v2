import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyCapacity,captureCapacity} from './storage-alert.mjs';

test('critical when either free space or utilization exceeds safe thresholds',()=>{
  assert.equal(classifyCapacity({availableGiB:23,usedPercent:96}).level,'CRITICAL');
  assert.equal(classifyCapacity({availableGiB:300,usedPercent:96}).level,'CRITICAL');
  assert.equal(classifyCapacity({availableGiB:25,usedPercent:70}).level,'CRITICAL');
});
test('warning avoids unnecessary hard stops in healthy circumstances',()=>{
  assert.equal(classifyCapacity({availableGiB:50,usedPercent:70}).level,'WARNING');
  assert.equal(classifyCapacity({availableGiB:120,usedPercent:91}).level,'WARNING');
  assert.equal(classifyCapacity({availableGiB:140,usedPercent:75}).level,'OK');
});
test('capacity input validation is fail closed',()=>{
  for(const input of [{availableGiB:-1,usedPercent:50},
     {availableGiB:20,usedPercent:101},{availableGiB:NaN,usedPercent:20}]){
    assert.throws(()=>classifyCapacity(input),/INVALID_CAPACITY_MEASUREMENT/);
  }
});
test('workspace and shared-auth same mount are counted once, without mutation',async()=>{
  const data=await captureCapacity();
  assert.equal(data.read_only,true);
  assert.equal(data.automatic_cleanup,false);
  assert(data.filesystems.length>=1 && data.filesystems.length<=2);
  assert(data.filesystems[0].available_gib>=0);
});
