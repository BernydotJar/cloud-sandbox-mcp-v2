import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  EXPECTED_UUID,ROOT,SSD_DATA,WID,validateDisk,
  containerSummary,migrationBlockers
} from './direct-bind-audit-on-mac.mjs';

const source=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
function containers(){
  return [{
    Name:'/cloud-sandbox-mcp',
    State:{Running:true},
    Config:{
      Image:'cloud-sandbox-mcp:latest',
      Env:['MCP_PATH_SECRET=SHOULD_NOT_PRINT','OTHER_TOKEN=PRIVATE'],
      Cmd:['node','dist/index.js'],
      Labels:{
        'com.docker.compose.project':'sandbox',
        'com.docker.compose.project.working_dir':
          path.join(os.homedir(),'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation')
      }
    },
    HostConfig:{
      NetworkMode:'sandbox_default',
      PortBindings:{'3000/tcp':[{HostIp:'',HostPort:'3000'}]},
      RestartPolicy:{Name:'unless-stopped'}
    },
    NetworkSettings:{Networks:{sandbox_default:{
      Aliases:['cloud-sandbox-mcp','mcp']}}},
    Mounts:[
      {Type:'bind',Destination:'/data',Source:source,RW:true},
      {Type:'bind',Destination:'/var/run/docker.sock',
        Source:'/var/run/docker.sock',RW:true}
    ]
  },{
    Name:'/cloud-sandbox-dev-main',State:{Running:true},
    Config:{
      Image:'cloud-sandbox-workstation:latest',
      Env:['AWS_SHARED_CREDENTIALS_FILE=/shared-auth/aws/credentials',
        'VERY_SECRET_TOKEN=NEVER_PRINT_ME'],
      Cmd:[],Labels:{'cloud-sandbox-mcp':'true'}
    },
    HostConfig:{
      NetworkMode:'bridge',RestartPolicy:{Name:'no'},
      Privileged:true,Memory:17179869184,NanoCpus:3000000000,
      PidsLimit:2048
    },
    NetworkSettings:{Networks:{bridge:{Aliases:null}}},
    Mounts:[
      {Type:'bind',Destination:'/workspace',
        Source:source+'/workspaces/'+WID+'/repo',RW:true},
      {Type:'bind',Destination:'/home/agent',
        Source:source+'/workspaces/'+WID+'/home',RW:true},
      {Type:'bind',Destination:'/shared-auth',
        Source:source+'/shared-auth',RW:true},
      {Type:'bind',Destination:'/var/lib/docker',
        Source:source+'/workspaces/'+WID+'/docker',RW:true}
    ]
  }];
}
test('pins real APFS external volume UUID with alternative writable key',()=>{
  const base={
    FileSystemPersonality:'APFS (Case-insensitive)',
    Internal:false,MountPoint:'/Volumes/SSD',
    VolumeUUID:EXPECTED_UUID,ReadOnlyVolume:false
  };
  assert.equal(validateDisk(base),true);
  assert.equal(validateDisk({...base,VolumeUUID:'different'}),false);
  assert.equal(validateDisk({...base,MountPoint:'/Volumes/SSD 1'}),false);
  assert.equal(validateDisk({...base,Internal:true}),false);
  assert.equal(validateDisk({...base,ReadOnlyVolume:true}),false);
  assert.equal(validateDisk({...base,FileSystemPersonality:'exFAT'}),false);
});
test('grounded controller and workstation mount projection is exact',()=>{
  const [c,w]=containers();
  const controller=containerSummary(c);
  const worker=containerSummary(w);
  assert.equal(controller.name,'cloud-sandbox-mcp');
  assert.equal(controller.primaryMounts[0].directSSDTarget,SSD_DATA);
  assert.equal(controller.extraMounts[0].destination,'/var/run/docker.sock');
  assert.equal(controller.labelKeys.includes('com.docker.compose.project'),true);
  assert.equal(worker.name,'cloud-sandbox-dev-main');
  assert.equal(worker.primaryMounts.length,4);
  assert.equal(worker.primaryMounts[1].directSSDTarget,
    SSD_DATA+'/workspaces/'+WID+'/home');
  assert.equal(worker.privileged,true);
  assert.equal(worker.memory,17179869184);
  assert.equal(worker.nanoCpus,3000000000);
  for(const entry of [controller,worker]){
    assert.equal(JSON.stringify(entry).includes('SHOULD_NOT_PRINT'),false);
    assert.equal(JSON.stringify(entry).includes('NEVER_PRINT_ME'),false);
    assert.equal(entry.envCount,2);
  }
  assert.deepEqual(migrationBlockers(worker),[]);
  assert(migrationBlockers(controller)
    .includes('ADDITIONAL_BIND_MOUNTS_REQUIRE_EXPLICIT_MAPPING'));
});
test('refuses mutated or unrecognized active data mounts',()=>{
  const a=containers();
  const wrong=JSON.parse(JSON.stringify(a));
  wrong[1].Mounts[1].Source='/tmp/untrusted';
  assert.throws(()=>containerSummary(wrong[1]),
    /ORIGINAL_MOUNT_DRIFT:cloud-sandbox-dev-main:\/home\/agent/);
  const stale=JSON.parse(JSON.stringify(a));
  stale[0].State.Running=false;
  assert.throws(()=>containerSummary(stale[0]),/CONTAINER_NOT_RUNNING/);
  stale[0].Name='/wrong';
  assert.throws(()=>containerSummary(stale[0]),/UNRECOGNIZED_CONTAINER_NAME/);
});
test('raises complexity flags instead of silently discarding container options',()=>{
  const [a]=containers();
  const s=containerSummary(a);
  s.volumesFrom=['other'];
  s.namedMountCount=1;
  s.networks=['first','second'];
  s.extraMounts=[{sourceKind:'volume',destination:'/data2'}];
  s.pidMode='host';
  s.deviceRequestsCount=1;
  const b=migrationBlockers(s);
  for(const problem of ['VOLUMES_FROM_REQUIRES_RECONCILIATION',
    'NAMED_VOLUME_REQUIRES_RECONCILIATION',
    'MULTIPLE_NETWORK_ATTACHMENTS_REQUIRE_RECONCILIATION',
    'NAMESPACE_MODE_REQUIRES_RECONCILIATION',
    'DEVICE_MAPPING_REQUIRES_RECONCILIATION']){
    assert(b.includes(problem),problem);
  }
});
test('Mac readiness audit has no Docker writes or filesystem mutations',()=>{
  const src=fs.readFileSync(
    new URL('./direct-bind-audit-on-mac.mjs',import.meta.url),'utf8');
  for(const forbidden of ['docker stop','docker rm','docker run',
    'docker create','docker start','rsync','unlinkSync(',
    'renameSync(','writeFileSync(','sudo','rm -rf',
    'mkdirSync(','chmodSync(','--delete']){
    assert(!src.includes(forbidden),forbidden);
  }
  assert(src.includes("'inspect','cloud-sandbox-mcp','cloud-sandbox-dev-main'"));
  assert(!src.includes('console.log(JSON.stringify(containers'));
  if(process.platform!=='darwin'){
    const target=new URL('./direct-bind-audit-on-mac.mjs',import.meta.url);
    const run=spawnSync(process.execPath,[target.pathname,'--inspect'],{
      encoding:'utf8',timeout:4500
    });
    assert.equal(run.status,2);
    assert.match(run.stdout,/STOP=MACOS_HOST_REQUIRED/);
  }
  assert.equal(ROOT,'/Volumes/SSD/Sandbox');
});
