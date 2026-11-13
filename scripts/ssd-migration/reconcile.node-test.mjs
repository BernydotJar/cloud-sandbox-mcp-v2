import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVolumeAccess,summarizeLegacy,
  EXISTING_SSD,LEGACY_CHECKOUT,VERSION_FREE_CHECKOUT,
  PREFERRED_VOLUME,STABLE_CHECKOUT_NAME,
  PINNED_EXISTING_VOLUME_UUID
} from './reconcile-on-mac.mjs';

const rwMount='/dev/disk5s1 on /Volumes/SSD (apfs, local, journaled)';
const roMount='/dev/disk5s1 on /Volumes/SSD (apfs, local, read-only)';
const stat=()=>({isDirectory:()=>true,isSymbolicLink:()=>false,
  mtime:new Date('2026-10-25T12:00:00Z')});

test('distinguishes missing diskutil writable key from actual read-only filesystem',()=>{
  const status=classifyVolumeAccess({info:{ReadOnlyMedia:false},
    mountOutput:rwMount,userWritable:true});
  assert.equal(status.code,'MOUNT_RW_PERMISSION_OK_NO_WRITE_PERFORMED');
  assert.equal(status.verifiedWriteOperation,false);
  assert.equal(status.originalPreflightWasConservative,true);
});
test('rejects actual read-only mount even when user permission W_OK says yes',()=>{
  const status=classifyVolumeAccess({info:{ReadOnlyVolume:false},
    mountOutput:roMount,userWritable:true});
  assert.equal(status.code,'READ_ONLY');
  assert.equal(status.mountReadOnly,true);
});
test('explicit read-only diskutil field overrides mount rw hints',()=>{
  const status=classifyVolumeAccess({info:{ReadOnlyVolume:true},
    mountOutput:rwMount,userWritable:true});
  assert.equal(status.code,'READ_ONLY');
  assert.equal(status.readOnlyFields.ReadOnlyVolume,true);
});
test('no mount entry or no write permission produces actionable non-PASS',()=>{
  assert.equal(classifyVolumeAccess({info:{},mountOutput:'',
    userWritable:true}).code,'MOUNT_NOT_FOUND');
  assert.equal(classifyVolumeAccess({info:{},mountOutput:rwMount,
    userWritable:false}).code,'USER_WRITE_PERMISSION_NOT_CONFIRMED');
});
test('future naming never hardcodes a major release number into SSD paths',()=>{
  assert.equal(EXISTING_SSD,'/Volumes/SSD');
  assert.equal(PREFERRED_VOLUME,'/Volumes/Sandbox');
  assert.equal(STABLE_CHECKOUT_NAME,'cloud-sandbox-workstation');
  assert.equal(VERSION_FREE_CHECKOUT,
    '/Volumes/Sandbox/source/cloud-sandbox-workstation');
  assert(!VERSION_FREE_CHECKOUT.includes('v0.2.0'));
  assert(!VERSION_FREE_CHECKOUT.includes('SandboxV3'));
  assert.match(PINNED_EXISTING_VOLUME_UUID,/^[0-9A-F-]{36}$/);
});
test('different paths with matching Git commit never mean a safe deletion',()=>{
  const old=summarizeLegacy({
    stat,links:p=>p,activePath:'/Users/mac/Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation',
    names:['src','README.md','AGENTS.md','.git','.env'],
    bindSources:['/Users/mac/.cloud-sandbox-mcp-data'],
    gitCandidate:{head:'a'.repeat(40)},
    gitActive:{head:'a'.repeat(40)}
  });
  assert.equal(old.exists,true);
  assert.equal(old.gitHeadsMatch,true);
  assert.equal(old.safeToDelete,false);
  assert.equal(old.recommendedAction,'ARCHIVE_UNTIL_FULL_DIFF_BACKUP_AND_FINAL_CUTOVER');
  assert.deepEqual(old.knownProjectMarkers,['AGENTS.md','.env','.git','src','README.md']
    .filter(x=>['src','README.md','AGENTS.md','.git','.env'].includes(x)));
});
test('active container bind on historical path prevents deletion absolutely',()=>{
  const legacy=summarizeLegacy({
    stat,links:p=>p,activePath:'/Users/mac/work',
    names:['src','compose.yaml'],
    bindSources:[LEGACY_CHECKOUT+'/data']
  });
  assert.equal(legacy.anyDockerBindUnderCandidate,true);
  assert.equal(legacy.safeToDelete,false);
  assert.equal(legacy.recommendedAction,'LIVE_REFERENCE_DO_NOT_DELETE');
});
test('symlink pointing to active source is not safe to remove or rename',()=>{
  const fakeStat=location=>({
    isDirectory:()=>true,isSymbolicLink:()=>location===LEGACY_CHECKOUT,
    mtime:new Date('2026-10-25T12:00:00Z')
  });
  const data=summarizeLegacy({
    stat:fakeStat,activePath:'/Users/mac/Dev/source',
    links:()=>'/Users/mac/Dev/source',names:[],bindSources:[]
  });
  assert.equal(data.sameRealPathAsLive,true);
  assert.equal(data.isSymlink,true);
  assert.equal(data.recommendedAction,'LIVE_REFERENCE_DO_NOT_DELETE');
  assert.equal(data.safeToDelete,false);
});
test('missing old external repo means there is nothing to delete',()=>{
  const legacy=summarizeLegacy({
    stat:()=>null,names:null,bindSources:[]
  });
  assert.equal(legacy.exists,false);
  assert.equal(legacy.safeToDelete,false);
  assert.equal(legacy.recommendedAction,'NOT_PRESENT_NOTHING_TO_DELETE');
});
