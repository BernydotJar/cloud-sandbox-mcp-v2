import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import {URL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  checkedStage,checkOldMounts,classifyMacSsd,
  MAC_UUID,MAC_VOLUME,TARGET,REL_WORKSPACE
} from './cutover-readiness-on-mac.mjs';

const source=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const code=path.join(os.homedir(),
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const marker={
  schema:'sandbox-v3.toshiba-stage.v1',volumeUuid:MAC_UUID,
  externalVolume:MAC_VOLUME,targetRoot:TARGET,
  dataSource:source,controllerSource:code,
  canCutover:false,sourceDeleted:false
};
const receipt={
  operation:'LIVE_STAGING_COPY_COMPLETED',volumeUuid:MAC_UUID,
  sourcePathsPreserved:true,migrationCutoverExecuted:false,
  dockerBindMountsRetargeted:false,
  activeDataMayHaveChangedDuringCopy:true,
  requireColdFinalSync:true,requireStrongVerification:true,
  initialPersistentCopyXattrsFullyPreserved:false,
  xattrAndAclParityVerificationPending:true,
  components:[
    {component:'controller',status:'STAGED_NON_AUTHORITATIVE',exitCode:0},
    {component:'persistent',status:'STAGED_NON_AUTHORITATIVE',exitCode:0}
  ]
};
const containers=[
  {Name:'/cloud-sandbox-mcp',State:{Running:true},Mounts:[
    {Type:'bind',Source:source,Destination:'/data'}
  ],Config:{Labels:{'com.docker.compose.project.working_dir':code}}},
  {Name:'/cloud-sandbox-dev-main',State:{Running:true},Mounts:[
    {Type:'bind',Source:source+'/'+REL_WORKSPACE+'/repo',Destination:'/workspace'},
    {Type:'bind',Source:source+'/'+REL_WORKSPACE+'/home',Destination:'/home/agent'},
    {Type:'bind',Source:source+'/shared-auth',Destination:'/shared-auth'},
    {Type:'bind',Source:source+'/'+REL_WORKSPACE+'/docker',Destination:'/var/lib/docker'}
  ]}
];
test('recognizes user-reported r3 success only if not cut over',()=>{
  assert(checkedStage(marker,receipt));
  for(const diff of [
    {operation:'STAGED_COPY_ONLY_NOT_CUTOVER'},
    {migrationCutoverExecuted:true},
    {requireColdFinalSync:false},
    {initialPersistentCopyXattrsFullyPreserved:true},
    {xattrAndAclParityVerificationPending:false}
  ]){
    assert.throws(()=>checkedStage(marker,{...receipt,...diff}));
  }
  assert.throws(()=>checkedStage({...marker,volumeUuid:'WRONG'},receipt));
});
test('refuses the wrong active Mac docker mounts or labels',()=>{
  assert(checkOldMounts(containers));
  const bad=JSON.parse(JSON.stringify(containers));
  bad[1].Mounts[3].Source='/Volumes/SSD/Sandbox';
  assert.throws(()=>checkOldMounts(bad),/OLD_BIND_SOURCE_CHANGED/);
  const badCode=JSON.parse(JSON.stringify(containers));
  badCode[0].Config.Labels['com.docker.compose.project.working_dir']='/tmp/old';
  assert.throws(()=>checkOldMounts(badCode),/WRONG_COMPOSE_CHECKOUT/);
});
test('readiness inspector never executes Mac mutations or writes',()=>{
  const s=fs.readFileSync(new URL('./cutover-readiness-on-mac.mjs',import.meta.url),'utf8');
  assert(!s.includes('writeFile'));
  assert(!s.includes('rm -rf'));
  assert(!s.includes('chmodSync'));
  assert(!s.includes('renameSync'));
  assert(!s.includes('docker stop'));
  assert(!s.includes('docker compose up'));
  assert(!s.includes('rsync'));
  assert(!s.includes('sudo'));
  if(process.platform!=='darwin'){
    const run=spawnSync(process.execPath,[
      path.join(import.meta.dirname,'cutover-readiness-on-mac.mjs'),'--inspect'
    ],{encoding:'utf8',timeout:6000});
    assert.equal(run.status,2);
    assert.match(run.stderr,/MACOS_HOST_REQUIRED/);
  }
});

test('Mac APFS UUID guard accepts positive writable variations used by stage',()=>{
  const base={FileSystemPersonality:'APFS (Case-insensitive)',
    MountPoint:MAC_VOLUME,Internal:false,VolumeUUID:MAC_UUID};
  assert.deepEqual(classifyMacSsd({...base,VolumeReadOnly:false}),
    {valid:true,reason:'PASS'});
  assert.equal(classifyMacSsd({...base,ReadOnlyVolume:false}).valid,true);
  assert.equal(classifyMacSsd({...base,Writable:true}).valid,true);
  assert.equal(classifyMacSsd({...base,FilesystemType:'APFS'}).valid,false);
  assert.equal(classifyMacSsd({
    ...base,FileSystemPersonality:'',FilesystemType:'apfs',
    ReadOnlyVolume:false,VolumeUUID:MAC_UUID.toLowerCase()
  }).valid,true);
});
test('Mac SSD guard remains fail-closed against wrong device and readonly media',()=>{
  const good={FilesystemType:'APFS',MountPoint:MAC_VOLUME,
    VolumeUUID:MAC_UUID,Internal:false,ReadOnlyVolume:false};
  for(const patch of [
    {MountPoint:'/Volumes/SSD 1'}, {VolumeUUID:'WRONG'},
    {Internal:true},{FileSystemPersonality:'exFAT',FilesystemType:'exFAT'},
    {ReadOnlyVolume:true},{VolumeReadOnly:true},{WriteProtected:true},
    {ReadOnlyMedia:true}
  ]){
    assert.equal(classifyMacSsd({...good,...patch}).valid,false);
  }
  assert.equal(classifyMacSsd({...good,ReadOnlyVolume:undefined}).valid,false);
  assert.equal(classifyMacSsd(good).valid,true);
});
