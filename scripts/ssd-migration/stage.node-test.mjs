import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import {URL} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  classifyVolume,selectedDockerMounts,stageMarker,validateStageMarker,
  rsyncArgs,VOLUME,VOLUME_UUID,ROOT,DATA_DEST,CODE_DEST,
  LEGACY_SSD_WORKTREE
} from './stage-on-mac.mjs';

const macData='/Users/test/.cloud-sandbox-mcp-data';
const goodInfo={FileSystemPersonality:'APFS',Internal:false,
  VolumeUUID:VOLUME_UUID,MountPoint:VOLUME,Writable:true,Encrypted:false};
function sampleContainers(source=macData){
  return [
    {Name:'/cloud-sandbox-mcp',State:{Running:true},Mounts:[
      {Type:'bind',Destination:'/data',Source:source}]},
    {Name:'/cloud-sandbox-dev-main',State:{Running:true},Mounts:[
      {Type:'bind',Destination:'/workspace',
        Source:source+'/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/repo'},
      {Type:'bind',Destination:'/shared-auth',Source:source+'/shared-auth'},
      {Type:'bind',Destination:'/home/agent',
        Source:source+'/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/home'},
      {Type:'bind',Destination:'/var/lib/docker',
        Source:source+'/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/docker'}
    ]}
  ];
}
test('unencrypted APFS SSD with original UUID and writable permission is accepted',()=>{
  const result=classifyVolume(goodInfo,1663.56);
  assert.equal(result.valid,true);
  assert.equal(result.reason,'PASS');
  assert.equal(result.encryptionOptional,true);
  assert.equal(result.encrypted,false);
  assert.equal(ROOT,'/Volumes/SSD/Sandbox');
  assert(!ROOT.includes('SandboxV3'));
  assert(!ROOT.includes('Encrypted'));
});
test('refuses a mismatched SSD UUID, wrong mount, internal disk, read-only or low space',()=>{
  const examples=[
    [{...goodInfo,VolumeUUID:'BAD'},1663.56,'SSD_UUID_CHANGED'],
    [{...goodInfo,MountPoint:'/Volumes/SSD 1'},1663.56,'UNEXPECTED_VOLUME_PATH'],
    [{...goodInfo,Internal:true},1663.56,'NOT_EXTERNAL'],
    [{...goodInfo,ReadOnlyVolume:true},1663.56,'SSD_NOT_CONFIRMED_WRITABLE'],
    [{...goodInfo,Writable:false},1663.56,'SSD_NOT_CONFIRMED_WRITABLE'],
    [goodInfo,10,'SSD_CAPACITY_INSUFFICIENT'],
    [{...goodInfo,FileSystemPersonality:'exFAT'},1663.56,'NOT_APFS']
  ];
  for(const [info,free,reason] of examples){
    const result=classifyVolume(info,free);
    assert.equal(result.valid,false);
    assert.equal(result.reason,reason);
  }
});
test('Mac Docker source identity must match exact live names and original mounts',()=>{
  const result=selectedDockerMounts(sampleContainers(),macData);
  assert.equal(result.mountSourceValidated,true);
  assert.equal(result.expectedContainerCount,2);
  const invalid=sampleContainers();
  invalid[0].Mounts[0].Source='/Volumes/SSD/Sandbox/mismatched';
  assert.throws(()=>selectedDockerMounts(invalid,macData),
    /MAC_BIND_SOURCE_CHANGED/);
  const down=sampleContainers();
  down[1].State.Running=false;
  assert.throws(()=>selectedDockerMounts(down,macData),
    /EXPECTED_MAC_CONTAINER_NOT_RUNNING/);
});
test('staging marker never asserts consistency or authorizes deleting originals',()=>{
  const marker=stageMarker();
  assert.equal(marker.targetRoot,ROOT);
  assert.equal(marker.consistentSnapshot,false);
  assert.equal(marker.canCutover,false);
  assert.equal(marker.sourceDeleted,false);
  assert.equal(marker.legacySsdWorktreePreserved,true);
  assert(validateStageMarker(marker));
  assert.throws(()=>validateStageMarker({...marker,canCutover:true}),
    /STAGE_FOLDER_UNRECOGNIZED_OR_CHANGED/);
  assert.throws(()=>validateStageMarker({...marker,volumeUuid:'different'}),
    /STAGE_FOLDER_UNRECOGNIZED_OR_CHANGED/);
});
test('rsync command preserves attributes and forbids deletion or overwriting old SSD checkout',()=>{
  const testHome=process.env.HOME||os.homedir();
  const root=path.join(testHome,'.cloud-sandbox-mcp-data');
  const args=rsyncArgs(root,DATA_DEST);
  assert.deepEqual(args,['-aEH','--stats','--',root+'/',DATA_DEST+'/']);
  assert(!args.includes('--delete'));
  assert(!args.some(arg=>arg.includes(LEGACY_SSD_WORKTREE)));
  const controller=path.join(testHome,
    'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
  assert.deepEqual(rsyncArgs(controller,CODE_DEST),
    ['-aEH','--stats','--',controller+'/',CODE_DEST+'/']);
  assert.throws(()=>rsyncArgs('/etc',DATA_DEST),/SOURCE_OR_TARGET_NOT_ALLOWLISTED/);
  assert.throws(()=>rsyncArgs(root,'/Volumes/SSD/Development'),
    /SOURCE_OR_TARGET_NOT_ALLOWLISTED/);
});
test('Linux execution cannot create SSD directory even when --stage is requested',()=>{
  if(process.platform==='darwin')return;
  const script=new URL('./stage-on-mac.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[script.pathname,'--stage'],{
    encoding:'utf8',timeout:7000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/MACOS_HOST_ONLY/);
});
test('staging source contains no destructive operations or Docker mutation commands',()=>{
  const src=fs.readFileSync(new URL('./stage-on-mac.mjs',import.meta.url),'utf8');
  assert(!src.includes('--delete'));
  assert(!src.includes('rm -rf'));
  assert(!src.includes('docker system prune'));
  assert(!src.includes('docker container stop'));
  assert(!src.includes('cloudflared tunnel'));
  assert(!src.includes('diskutil erase'));
  assert(src.includes('requireColdFinalSync:true'));
  assert(src.includes('mac_installed_cli')===false);
});
