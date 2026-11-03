import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import process from 'node:process';
import {URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {classifyError,sanitizeError,diskEvidence} from
  './ssd-worker-prestart-diagnostic-on-mac.mjs';

test('safe engine diagnostic message classification covers startup failure families',()=>{
  assert.equal(classifyError(
    'OCI runtime create failed: containerd task failed'),
    'OCI_RUNTIME_OR_CONTAINERD');
  assert.equal(classifyError(
    'failed mount /var/lib/docker: permission denied'),
    'BIND_MOUNT_OR_PERMISSIONS');
  assert.equal(classifyError(
    'address already allocated to network endpoint'),
    'NETWORK_ALLOCATION_OR_ENDPOINT');
  assert.equal(classifyError(
    'bind: address already in use'),'HOST_PORT_COLLISION');
  assert.equal(classifyError('no space left on device'),'STORAGE_SPACE');
  assert.equal(classifyError('unexpected response'),
    'UNCLASSIFIED_DOCKER_ENGINE_FAILURE');
});
test('sanitizer hides real secret values and original machine paths',()=>{
  const home=os.homedir();
  const raw='failed mount '+home+
    '/.cloud-sandbox-mcp-data, token=abc123XYZ abc123XYZ';
  const value=sanitizeError(raw,
    ['AUTH_TOKEN=abc123XYZ','PATH='+home+'/.cloud-sandbox-mcp-data']);
  assert(!value.includes(home));
  assert(!value.includes('abc123XYZ'));
  assert(value.includes('[REDACTED_ENV_VALUE]')||
    value.includes('[REDACTED]'));
  assert(value.includes('[HOME]')||
    value.includes('[ORIGINAL_DATA]')||
    value.includes('[REDACTED_ENV_VALUE]'));
});
test('diagnostic cannot activate cutover and refuses running outside the Mac',()=>{
  const file=new URL('./ssd-worker-prestart-diagnostic-on-mac.mjs',
    import.meta.url);
  const source=fs.readFileSync(file,'utf8');
  for(const disallowed of [
    'docker stop cloud-sandbox-dev-main',
    "'/containers/'+old.id+'/stop'",
    'rsync -a',
    'docker compose down',
    'unlinkSync(SOURCE)',
    'rm -rf',
    'removeNewCandidate(ctx'
  ])assert(!source.includes(disallowed));
  assert(source.includes("body.Entrypoint=['/bin/sh','-c']"));
  assert(source.includes("body.Cmd=['exec sleep infinity']"));
  assert(source.includes("'/containers/'+temp+'?force=1'"));
  assert(source.includes("j.phase!=='ROLLBACK_COMPLETE'"));
  assert(source.includes("after[0].Id!==c.Id"));
  if(process.platform!=='darwin'){
    const r=spawnSync(process.execPath,[file.pathname,'--test'],
      {encoding:'utf8',timeout:5000});
    assert.equal(r.status,2);
    assert.match(r.stdout,/STOP=MACOS_ONLY/);
  }
});

test('macOS APFS physical disk guard supports FilesystemType field, keeps UUID pinned',()=>{
  const base={VolumeUUID:'a6268296-0330-4a69-9be3-059be8e4016a',
    Internal:false,MountPoint:'/Volumes/SSD',FilesystemType:'apfs',
    ReadOnlyVolume:false};
  assert.deepEqual(diskEvidence(base),{
    apfs:true,writable:true,uuidMatch:true,external:true,mount:true
  });
  const personalityOnly={...base,
    FilesystemType:undefined,FileSystemPersonality:'APFS',
    Writable:true};
  assert(Object.values(diskEvidence(personalityOnly)).every(Boolean));
  assert.equal(diskEvidence({...base,VolumeUUID:'WRONG'}).uuidMatch,false);
  assert.equal(diskEvidence({...base,MountPoint:'/Volumes/Other'}).mount,false);
  assert.equal(diskEvidence({...base,Internal:true}).external,false);
  assert.equal(diskEvidence({...base,
    ReadOnlyVolume:true}).writable,false);
  assert.equal(diskEvidence({...base,FilesystemType:'ExFAT'}).apfs,false);
  assert.equal(diskEvidence({...base,Writable:false,
    ReadOnlyVolume:undefined,VolumeReadOnly:undefined}).writable,false);
});

test('reproduces network attach stage without altering original container',()=>{
  const file=new URL('./ssd-worker-prestart-diagnostic-on-mac.mjs',
    import.meta.url);
  const source=fs.readFileSync(file,'utf8');
  assert(source.includes('/networks/cloud-sandbox-edge/connect'));
  assert(source.includes("spec.secondary.length!==1"));
  assert(source.includes('SECONDARY_EXACT'));
  assert(source.includes('SECONDARY_WITHOUT_IPAM'));
  assert(source.includes('SECONDARY_CLEAN'));
  assert(source.includes('ALL_TEMP_SECONDARY_NETWORK_ATTACH_MODES_FAILED'));
  assert(source.includes('FULL_RUNTIME_AND_SECONDARY_NETWORK_COMPATIBLE'));
  assert(source.includes("body.Cmd=['exec sleep infinity']"));
});
