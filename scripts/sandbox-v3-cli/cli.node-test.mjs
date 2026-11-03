import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import os from 'node:os';
import {parseContainerStatus,DEFAULT_CONTROLLER,DEFAULT_WORKSTATION,
  externalSSDClass,EXPECTED_EXTERNAL_SSD_UUID,
  classifyDirectSSDState,directSSDBindMatch,EXPECTED_EXTERNAL_DATA} from './cli.mjs';

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

test('direct SSD startup guard treats incomplete cutover as fail closed',()=>{
  assert.equal(classifyDirectSSDState(null),
    'NO_DIRECT_SSD_CUTOVER_STATE');
  const base={schema:'sandbox-v3.ssd-direct-cutover.v1',
    ssdUuid:EXPECTED_EXTERNAL_SSD_UUID};
  for(const phase of ['PREPARED','STOPPING','COLD_SYNC',
    'RENAMING','CREATING','VALIDATING','ROLLBACK_INCOMPLETE']){
    assert.throws(()=>classifyDirectSSDState({...base,phase}),
      /INCOMPLETE_FAIL_CLOSED/);
  }
  assert.equal(classifyDirectSSDState({...base,phase:'ROLLBACK_COMPLETE'}),
    'MAC_ORIGINAL_DATA');
  assert.equal(classifyDirectSSDState({...base,phase:'SUCCEEDED'}),
    'DIRECT_SSD_REQUIRED');
  assert.throws(()=>classifyDirectSSDState({...base,ssdUuid:'WRONG',
    phase:'SUCCEEDED'}),/UNTRUSTED/);
});
test('direct SSD mount guard checks physical paths for both existing containers',()=>{
  const data=EXPECTED_EXTERNAL_DATA;
  const workspace=data+'/workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
  const c=[{
    Name:'/cloud-sandbox-mcp',
    Mounts:[{Destination:'/data',Type:'bind',Source:data}]
  },{
    Name:'/cloud-sandbox-dev-main',
    Mounts:[
      {Destination:'/workspace',Type:'bind',Source:workspace+'/repo'},
      {Destination:'/home/agent',Type:'bind',Source:workspace+'/home'},
      {Destination:'/shared-auth',Type:'bind',Source:data+'/shared-auth'},
      {Destination:'/var/lib/docker',Type:'bind',Source:workspace+'/docker'}
    ]
  }];
  assert(directSSDBindMatch(c));
  const wrong=JSON.parse(JSON.stringify(c));
  wrong[1].Mounts[2].Source='/Users/mac/.cloud-sandbox-mcp-data/shared-auth';
  assert.throws(()=>directSSDBindMatch(wrong),
    /DIRECT_SSD_CONTAINER_BIND_DRIFT/);
  assert.throws(()=>directSSDBindMatch(c.slice(0,1)),
    /RUNNING_CONTAINERS_MISSING/);
});
test('direct SSD guard runs before opening Docker and verifies binds before start',()=>{
  const first=code.indexOf('const directStatus=directSSDPreStartupGuard()');
  const opening=code.indexOf('await ensureDocker()');
  const verify=code.indexOf("if(directStatus==='DIRECT_SSD_REQUIRED')verifyDirectDockerMounts()");
  const existing=code.indexOf('await ensureExisting(DEFAULT_CONTROLLER)');
  assert(first>=0&&opening>first&&verify>opening&&existing>verify);
});
