import {test} from 'node:test';
import assert from 'node:assert/strict';
import {platformUuidFromIoreg,machineDigest,assertDistinctMachines,capacityStatus} from './identity.mjs';
import {parseDf} from './preflight.mjs';
test('machine identity is privacy-safe and refuses operator == worker',()=>{
 const a='01234567-89AB-CDEF-0123-456789ABCDEF';
 const b='01234567-89AB-CDEF-0123-456789ABCDE0';
 assert.equal(platformUuidFromIoreg('"IOPlatformUUID" = "'+a+'"'),a);
 const x=machineDigest(a),y=machineDigest(b);
 assert.notEqual(x,y);
 assert.equal(x.length,64);
 assert.throws(()=>assertDistinctMachines(x,x),/WORKER_IS_OPERATOR_MAC/);
 assert.equal(assertDistinctMachines(x,y),true);
});
test('VM provisioning is blocked by physical resource constraints',()=>{
 assert.equal(capacityStatus({arm64:false,virtualization:true,availableGiB:200,ramGiB:32}).vmEligible,false);
 assert.equal(capacityStatus({arm64:true,virtualization:true,availableGiB:16,ramGiB:32}).reason,'LOCAL_VM_STORAGE_BELOW_80_GIB');
 assert.equal(capacityStatus({arm64:true,virtualization:true,availableGiB:200,ramGiB:8}).vmEligible,false);
 assert.equal(capacityStatus({arm64:true,virtualization:true,availableGiB:200,ramGiB:32}).vmEligible,true);
});
test('df reports free capacity in GiB using KiB not f_bsize',()=>{
 assert.deepEqual(parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 450000000 430000000 16777216 97% /Users'),
  {freeGiB:16,usedPercent:97});
 assert.throws(()=>parseDf('broken'),/INVALID_DF_CAPACITY/);
});
