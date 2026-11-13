import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  candidateConfig,validateSource
} from './direct-bind-rehearsal-on-mac.mjs';

const home=os.homedir();
const source=path.join(home,'.cloud-sandbox-mcp-data');
const target='/Volumes/SSD/Sandbox/persistent/cloud-sandbox-mcp-data';
const wid='6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
const image='sha256:'+'a'.repeat(64);
const entry=(src,dst,rw=true)=>({
  Type:'bind',Source:src,Destination:dst,RW:rw,Propagation:'rprivate'
});
function worker(){
  const repo=source+'/workspaces/'+wid+'/repo';
  const homePath=source+'/workspaces/'+wid+'/home';
  const docker=source+'/workspaces/'+wid+'/docker';
  const shared=source+'/shared-auth';
  const dev=path.join(home,'Development');
  const github=path.join(home,'Github-Repos-local');
  const volumes=[
    [repo,'/workspace'],
    [homePath,'/home/agent'],
    [shared,'/shared-auth'],
    [docker,'/var/lib/docker'],
    [dev,'/shared/development'],
    [github,'/shared/github-repos-local']
  ];
  return {
    Name:'/cloud-sandbox-dev-main',
    Image:image,State:{Running:true},
    Config:{
      Image:'cloud-sandbox-workstation:latest',
      Env:['TOKEN_1=SECRET','AWS_SECRET_ACCESS_KEY=NOT_VISIBLE'],
      Labels:{'cloud-sandbox.workspace':'dev-main'},Entrypoint:['/entry.sh'],
      Cmd:null,WorkingDir:'/workspace',User:'',ExposedPorts:null,Volumes:null
    },
    HostConfig:{
      Privileged:true,NetworkMode:'bridge',RestartPolicy:{Name:'no'},
      Binds:volumes.map(([src,dst])=>src+':'+dst+':rw'),
      Mounts:[],
      IpcMode:'private',CgroupnsMode:'private',
      CapAdd:[],CapDrop:[],SecurityOpt:['label=disable'],
      ShmSize:67108864,Memory:0,NanoCpus:0,
      PidsLimit:null
    },
    NetworkSettings:{Networks:{
      bridge:{Aliases:null,IPAMConfig:null,DriverOpts:null},
      'cloud-sandbox-edge':{
        Aliases:['dev-main','cloud-sandbox-dev-main'],
        IPAMConfig:null,DriverOpts:null
      }
    }},
    Mounts:volumes.map(([src,dst])=>entry(src,dst))
  };
}
function controller(){
  const code=path.join(home,'Development/Workspaces',
    'cloud-sandbox-mcp-v0.2.0-workstation','infra-v1/controller');
  const volumes=[
    [source,'/data',true],
    [code,'/app/dist',false],
    ['/var/run/docker.sock','/var/run/docker.sock',true]
  ];
  return {
    Name:'/cloud-sandbox-mcp',Image:'sha256:'+'b'.repeat(64),
    State:{Running:true},
    Config:{
      Image:'cloud-sandbox-mcp-v020-workstation-mcp:mac-fixed',
      Env:['PATH_SECRET=VERY_PRIVATE','DOCKER_SOCKET=/var/run/docker.sock'],
      Labels:{'com.docker.compose.project':'cloud-sandbox'},
      Entrypoint:['docker-entrypoint.sh'],Cmd:['node','/app/main.js']
    },
    HostConfig:{
      Privileged:false,NetworkMode:'cloud-sandbox-mcp-v020-workstation_default',
      RestartPolicy:{Name:'unless-stopped'},
      Mounts:volumes.map(([src,dst,rw])=>({
        Type:'bind',Source:src,Target:dst,ReadOnly:!rw
      })),
      Binds:[]
    },
    NetworkSettings:{Networks:{
      'cloud-sandbox-mcp-v020-workstation_default':{
        Aliases:['cloud-sandbox-mcp'],IPAMConfig:null,DriverOpts:null
      }
    }},
    Mounts:volumes.map(([src,dst,rw])=>entry(src,dst,rw))
  };
}
test('worker candidate pins image and rewrites exactly 4 persistent binds',()=>{
  const original=worker();
  assert.equal(validateSource(original),'cloud-sandbox-dev-main');
  const item=candidateConfig(original);
  const binds=item.body.HostConfig.Binds;
  assert.equal(item.name,'cloud-sandbox-dev-main');
  assert.equal(item.body.Image,original.Image);
  assert.deepEqual(item.secondary.map(n=>n.network),['cloud-sandbox-edge']);
  for(const value of ['repo','home','docker']){
    assert(binds.some(x=>x.startsWith(target+'/workspaces/'+wid+'/'+value+':')));
  }
  assert(binds.some(x=>x.startsWith(target+'/shared-auth:/shared-auth:')));
  assert(binds.some(x=>x.startsWith(path.join(home,'Development')+':/shared/development:')));
  assert(binds.some(x=>x.startsWith(path.join(home,'Github-Repos-local')+':/shared/github-repos-local:')));
  assert.equal(item.body.HostConfig.Privileged,true);
  assert.equal(item.body.HostConfig.NetworkMode,'bridge');
  assert.deepEqual(item.body.Env,original.Config.Env);
  assert.equal(item.body.HostConfig.RestartPolicy.Name,'no');
  assert.equal(original.HostConfig.Binds[0].startsWith(source),true);
});
test('controller candidate retains custom code RO overlay and Docker socket',()=>{
  const item=candidateConfig(controller());
  assert.equal(item.secondary.length,0);
  assert.equal(item.body.HostConfig.Mounts.length,3);
  const bindings=item.body.HostConfig.Mounts;
  assert.equal(bindings.find(m=>m.Target==='/data').Source,target);
  const overlay=bindings.find(m=>m.Target==='/app/dist');
  assert.equal(overlay.ReadOnly,true);
  assert(overlay.Source.endsWith('/infra-v1/controller'));
  const socket=bindings.find(m=>m.Target==='/var/run/docker.sock');
  assert.equal(socket.Source,'/var/run/docker.sock');
  assert.equal(item.body.HostConfig.NetworkMode,
    'cloud-sandbox-mcp-v020-workstation_default');
  assert.equal(item.body.HostConfig.RestartPolicy.Name,'no');
  assert.equal(item.body.Config,undefined);
});
test('explicitly fails closed on drift or dropped mounts and networks',()=>{
  const missing=worker();
  missing.Mounts[0].Source='/tmp/wrong';
  assert.throws(()=>candidateConfig(missing),/ORIGINAL_BIND_SOURCE_DRIFT/);
  const bad=worker();
  bad.NetworkSettings.Networks={bridge:{}};
  assert.throws(()=>candidateConfig(bad),/WORKSTATION_DUAL_NETWORK/);
  const badPort=worker();
  badPort.HostConfig.Binds[0]='/tmp/other:/workspace:rw';
  assert.throws(()=>candidateConfig(badPort),/REPLACE_BIND_MISMATCH/);
  const missingBinds=worker();
  missingBinds.HostConfig.Binds=[];
  assert.throws(()=>candidateConfig(missingBinds),
    /INSPECT_DOES_NOT_EXPOSE_ORIGINAL_BIND_SPECS/);
  const wrongImg=controller();
  wrongImg.Image='latest';
  assert.throws(()=>candidateConfig(wrongImg),/IMAGE_ID_MUST_BE_PINNED/);
  const wrongExtra=controller();
  wrongExtra.Mounts[1].RW=true;
  assert.throws(()=>candidateConfig(wrongExtra),
    /CONTROLLER_CUSTOM_OVERLAY_OR_SOCKET/);
});
test('candidate rehearsal does not start or stop original containers or read secrets aloud',()=>{
  const script=fs.readFileSync(
    new URL('./direct-bind-rehearsal-on-mac.mjs',import.meta.url),'utf8');
  assert(!script.includes('docker stop'));
  assert(!script.includes('docker start'));
  assert(!script.includes('docker compose up'));
  assert(!script.includes("command('rsync'"));
  assert(!script.includes("command('/usr/bin/rsync'"));
  assert(!script.includes('rm -rf'));
  assert(!script.includes('sudo'));
  assert(!script.includes('echo(c.Config.Env'));
  assert(!script.includes('echo(item.body.Env'));
  assert(!script.includes('console.log(JSON.stringify(item.body)'));
  assert(script.includes("'/containers/create?name='"));
  assert(script.includes('SECONDARY_NETWORKS_DEFERRED'));
  assert(script.includes("'DELETE'"));
  assert(!script.includes("'/containers/'+encodeURIComponent(created.Id)+'/start'"));
  if(process.platform!=='darwin'){
    const scriptPath=new URL('./direct-bind-rehearsal-on-mac.mjs',
      import.meta.url);
    for(const mode of ['--inspect','--rehearse']){
      const res=spawnSync(process.execPath,[scriptPath.pathname,mode],
        {encoding:'utf8',timeout:6000});
      assert.equal(res.status,2);
      assert.match(res.stdout,/STOP=MACOS_HOST_ONLY/);
    }
  }
});
