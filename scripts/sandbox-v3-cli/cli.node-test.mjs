import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import os from 'node:os';
import {parseContainerStatus,DEFAULT_CONTROLLER,DEFAULT_WORKSTATION,
  externalSSDClass,EXPECTED_EXTERNAL_SSD_UUID} from './cli.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const code=fs.readFileSync(path.join(dir,'cli.mjs'),'utf8');

test('sandbox defaults to the singular persistent Sandbox V3 workstation',()=>{
  assert.equal(DEFAULT_CONTROLLER,'cloud-sandbox-mcp');
  assert.equal(DEFAULT_WORKSTATION,'cloud-sandbox-dev-main');
  assert.match(code,/process\.argv\[2\]\?\?'start'/);
  assert.match(code,/CONNECTOR_PREFERENCE','Sandbox_V3'/);
  assert.match(code,/LEGACY_MCP_V2_START','DISABLED'/);
});
test('the CLI never invokes ngrok, legacy multiproject startup or destructive docker actions',()=>{
  assert.match(code,/docker.*start/);
  assert.match(code,/EXISTING_CONTAINER_NOT_FOUND/);
  assert.doesNotMatch(code,/docker\.compose|['"]compose['"]\s*,\s*['"]up['"]/);
  assert.doesNotMatch(code,/['"]run['"]\s*,\s*['"]-d['"]|docker\.prune|docker\.system\.prune/);
  assert.doesNotMatch(code,/start-all\.sh['"]\s*[,)]|ngrok\s+http|\.activate\(/);
  assert.match(code,/CLOUDFLARE_TUNNEL',tunnel.state/);
  assert.match(code,/EXISTING_CLOUDFLARE_REUSED','YES'/);
  assert.match(code,/BROWSER_BRIDGE_RESTARTED','NO'/);
});
test('exact container identity and health are required by the runtime status parser',()=>{
  assert.deepEqual(parseContainerStatus('/cloud-sandbox-dev-main|true|healthy',
    'cloud-sandbox-dev-main'),{
    name:'cloud-sandbox-dev-main',active:true,health:'healthy'
  });
  assert.deepEqual(parseContainerStatus('/cloud-sandbox-mcp|false|none',
    'cloud-sandbox-mcp'),{
    name:'cloud-sandbox-mcp',active:false,health:'none'
  });
  assert.throws(()=>parseContainerStatus('/legacy-v2|true|healthy',
    'cloud-sandbox-dev-main'),/UNEXPECTED_CONTAINER_IDENTITY/);
  assert.throws(()=>parseContainerStatus('invalid','cloud-sandbox-dev-main'));
});
test('sandbox help remains available on Linux for cross-platform verification',()=>{
  const result=spawnSync(process.execPath,[path.join(dir,'cli.mjs'),'--help'],{
    encoding:'utf8',timeout:5000
  });
  assert.equal(result.status,0);
  assert.match(result.stdout,/Usage: sandbox/);
  assert.match(result.stdout,/No argument means start/);
});

test('Node follows realpath of installed sandbox symbolic link and does not exit silently',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sandbox-v3-link-test-'));
  try{
    const shortcut=path.join(temp,'sandbox');
    fs.symlinkSync(path.join(dir,'cli.mjs'),shortcut);
    const help=spawnSync(process.execPath,[shortcut,'--help'],{
      encoding:'utf8',timeout:5000
    });
    assert.equal(help.status,0);
    assert.match(help.stdout,/Usage: sandbox/);
    const cats=spawnSync(process.execPath,[shortcut,'art','cats'],{
      encoding:'utf8',timeout:5000
    });
    assert.equal(cats.status,0);
    assert(cats.stdout.includes('C O S M I C   C A T S'));
    assert.match(cats.stdout,/\\_\//);
    const planet=spawnSync(process.execPath,[shortcut,'art','jupiter'],{
      encoding:'utf8',timeout:5000
    });
    assert.equal(planet.status,0);
    assert.match(planet.stdout,/J U P I T E R/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('plain sandbox never returns silently even when not on a Mac',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sandbox-v3-plain-test-'));
  try{
    const shortcut=path.join(temp,'sandbox');
    fs.symlinkSync(path.join(dir,'cli.mjs'),shortcut);
    if(process.platform==='darwin')return;
    const plain=spawnSync(process.execPath,[shortcut],{
      encoding:'utf8',timeout:5000
    });
    assert.equal(plain.status,2);
    assert(plain.stdout.includes('C O S M I C   C A T S'));
    assert.match(plain.stdout,/STOP=MACOS_OPERATOR_HOST_REQUIRED/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('Cloudflare uses only the existing system launchd service, never starts ngrok or a new tunnel',()=>{
  assert.match(code,/ensureCloudflare\(\{exec/);
  assert.match(code,/inspectCloudflare\(\{exec\}\)/);
  assert.match(code,/printCloudflareStatus\(\)/);
  assert.match(code,/CLOUDFLARE_NETWORK_HEALTH','CHECK_PUBLIC_HTTPS_ROWS'/);
  assert.doesNotMatch(code,/cloudflared.*tunnel.*create/);
  assert.doesNotMatch(code,/launchctl.*-k/);
});

test('external SSD guard accepts verified APFS diskutil variants',()=>{
  const base={FileSystemPersonality:'APFS (Case-insensitive)',
    MountPoint:'/Volumes/SSD',Internal:false,
    VolumeUUID:EXPECTED_EXTERNAL_SSD_UUID,ReadOnlyVolume:false};
  assert.equal(externalSSDClass(base).valid,true);
  assert.equal(externalSSDClass({...base,Writable:true}).valid,true);
  assert.equal(externalSSDClass({...base,ReadOnlyVolume:true}).valid,false);
  assert.equal(externalSSDClass({...base,Internal:true}).valid,false);
  assert.equal(externalSSDClass({...base,VolumeUUID:'WRONG'}).valid,false);
  assert.equal(externalSSDClass({...base,MountPoint:'/Volumes/SSD 1'}).valid,false);
  assert.equal(externalSSDClass({...base,FileSystemPersonality:'exFAT'}).valid,false);
});
test('sandbox checks SSD before Docker Desktop or existing containers start',()=>{
  const idx=code.indexOf('const rootStatus=guardExternalPersistentStorage()');
  const docker=code.indexOf('await ensureDocker();');
  const containers=code.indexOf('await ensureExisting(DEFAULT_CONTROLLER);');
  assert(idx>0&&docker>idx&&containers>docker);
  assert(code.includes('SSD_VOLUME_UUID_OR_APFS_RW_MISMATCH'));
  assert(code.includes('SSD_VOLUME_MOUNT_MISSING'));
  assert(!code.includes('mkdirSync(root'));
});
