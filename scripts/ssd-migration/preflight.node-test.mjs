import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDiskutil,filesystemSummary,selectMounts,buildReport,
  VOLUME,DESTINATION,EXPECTED_CONTAINERS
} from './preflight-on-mac.mjs';

const goodDisk={
  FilesystemType:'apfs',FileSystemPersonality:'APFS',Internal:false,
  ReadOnlyVolume:false,Encrypted:true,MountPoint:'/Volumes/SSD',
  VolumeUUID:'5F36DE0C-7DF1-4829-8B63-2FA046AD599E',
  VolumeName:'SSD',DeviceIdentifier:'disk6s1'
};
const source={
  path:'/Users/test/.cloud-sandbox-mcp-data',
  exists:true,isSymlink:false,
  subdirectories:[
    {name:'workspaces',exists:true,isSymlink:false},
    {name:'shared-auth',exists:true,isSymlink:false}
  ]
};
const containers=EXPECTED_CONTAINERS.map(name=>({
  name,found:true,running:true,mounts:[]
}));

test('matches only existing SSD APFS external rw volume and pins UUID',()=>{
  const actual=classifyDiskutil(goodDisk);
  assert.equal(actual.valid,true);
  assert.equal(actual.external,true);
  assert.equal(actual.fileSystem,'APFS');
  assert.equal(actual.encryption,'CONFIRMED');
  assert.equal(actual.uuid,goodDisk.VolumeUUID);
  assert.equal(actual.mountedCorrectly,true);
  assert.equal(actual.volumeName,'SSD');
});
test('rejects an internal disk impersonating /Volumes/SSD',()=>{
  assert.equal(classifyDiskutil({...goodDisk,Internal:true}).valid,false);
});
test('rejects missing mount or renamed volume, unknown filesystem and readonly',()=>{
  assert.equal(classifyDiskutil({...goodDisk,MountPoint:'/Volumes/SSD 1'}).valid,false);
  assert.equal(classifyDiskutil({...goodDisk,FilesystemType:'exfat',
    FileSystemPersonality:'ExFAT'}).valid,false);
  assert.equal(classifyDiskutil({...goodDisk,ReadOnlyVolume:true}).valid,false);
  assert.equal(classifyDiskutil({...goodDisk,VolumeUUID:null}).valid,false);
  assert.equal(classifyDiskutil({...goodDisk,Encrypted:false}).encryption,
    'NOT_ENCRYPTED');
  const withoutFlag={...goodDisk};
  delete withoutFlag.Encrypted;
  assert.equal(classifyDiskutil(withoutFlag).encryption,'NOT_VERIFIED');
  assert.equal(VOLUME,'/Volumes/SSD');
  assert.equal(DESTINATION,'/Volumes/SSD/SandboxV3');
});
test('statfs capacity reported in GiB and preserves enough free margin',()=>{
  const result=filesystemSummary({location:'/Volumes/SSD',statfs:()=>({
    bsize:4096,blocks:524288000,bavail:419430400
  })});
  assert.equal(result.totalGiB,2000);
  assert.equal(result.availableGiB,1600);
  assert.equal(result.usedPercent,20);
});
test('only allowed bind mounts are returned and no secret ENV is exposed',()=>{
  const mocked=[
    {Name:'/cloud-sandbox-mcp',State:{Running:true},
      Config:{Env:['PASSWORD=top-secret'],Labels:{
        'com.docker.compose.project.working_dir':'/Users/test/Development/cloud-sandbox-mcp-v2'}},
      Mounts:[{Type:'bind',Destination:'/data',
        Source:'/Users/test/.cloud-sandbox-mcp-data',RW:true},
        {Type:'bind',Destination:'/super-secret',
          Source:'/Users/test/.ssh',RW:true}]},
    {Name:'/cloud-sandbox-dev-main',State:{Running:true},
      Config:{Labels:{},Env:['TOKEN=hidden']},
      Mounts:[{Type:'bind',Destination:'/workspace',
        Source:'/Users/test/.cloud-sandbox-mcp-data/workspaces/abc/repo',RW:true},
        {Type:'bind',Destination:'/shared-auth',
          Source:'/Users/test/.cloud-sandbox-mcp-data/shared-auth',RW:true},
        {Type:'bind',Destination:'/var/lib/docker',
          Source:'/Users/test/.cloud-sandbox-mcp-data/workspaces/abc/docker',RW:true}]}
  ];
  const selected=selectMounts(mocked);
  assert.equal(selected.length,2);
  assert(selected[0].mounts.length===1);
  assert(selected[1].mounts.length===3);
  assert(!JSON.stringify(selected).includes('top-secret'));
  assert(!JSON.stringify(selected).includes('hidden'));
  assert(!JSON.stringify(selected).includes('.ssh'));
});
test('preflight shows NO_GO if wrong SSD or missing Docker and does not assume SSD migration',()=>{
  const report=buildReport({mac:true,ssd:{...classifyDiskutil(goodDisk),availableGiB:1600},
    internal:{availableGiB:26,usedPercent:95},source,
    docker:{available:true,foundBoth:true,containers},
    image:{defaultImageFiles:[]},
    destinationState:'ABSENT',previousDataMarkers:['Documents','Downloads','Development']});
  assert.equal(report.readiness,'PREPARED_NEEDS_CUTOVER');
  assert.equal(report.migrationExecuted,false);
  assert.equal(report.guaranteedNoDelete,true);
  assert.equal(report.guaranteedNoDataMove,true);
  assert(!JSON.stringify(report).includes('password'));
  const blocked=buildReport({...{
    mac:true,ssd:{...classifyDiskutil({...goodDisk,Internal:true}),availableGiB:1600},
    internal:{availableGiB:26},source,docker:{available:true,foundBoth:true},
    image:{},destinationState:'ABSENT',previousDataMarkers:[]}});
  assert.equal(blocked.readiness,'BLOCKED');
});
test('existing target folder always needs manual reconciliation to preserve prior files',()=>{
  for(const state of ['EXISTS_REQUIRES_INVENTORY','SYMLINK_UNTRUSTED',
    'EXISTS_NOT_DIRECTORY']){
    const report=buildReport({mac:true,
      ssd:{...classifyDiskutil(goodDisk),availableGiB:1600},
      internal:{availableGiB:26},source,
      docker:{available:true,foundBoth:true},image:{},destinationState:state,
      previousDataMarkers:['MacStorage']});
    assert.equal(report.readiness,'MANUAL_REVIEW_REQUIRED');
  }
});

test('an unencrypted removable SSD requires review before migrating secrets',()=>{
  const ssd={...classifyDiskutil({...goodDisk,Encrypted:false}),
    availableGiB:1600};
  const report=buildReport({mac:true,ssd,internal:{availableGiB:26},
    source,docker:{available:true,foundBoth:true,bindPathsOnSSD:0},
    image:{},destinationState:'ABSENT',previousDataMarkers:[]});
  assert.equal(report.readiness,'MANUAL_REVIEW_REQUIRED');
  assert(report.checks.some(x=>x.id==='SSD_SECRET_STORAGE_ENCRYPTION'&&
    x.status==='REVIEW_REQUIRED'));
});
