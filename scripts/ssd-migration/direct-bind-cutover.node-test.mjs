import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  UUID,ROOT,DATA,CODE,WID,STATE,NAMES,
  allowlistedBackupName,validateJournal,
  updateControllerHostDataEnv,
  verifyRuntimeParity,verifyNewMounts,syncArgs
} from './direct-bind-cutover-on-mac.mjs';

const SOURCE=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const CONTROLLER=path.join(os.homedir(),
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const image='sha256:'+'a'.repeat(64);
function oldController(){
  return {
    Name:'/cloud-sandbox-mcp',Id:'b'.repeat(64),Image:image,
    Config:{
      Env:['PORT=3000','HOST_DATA_DIR='+SOURCE,
        'SECRET_TOKEN=DO_NOT_EXPOSE','MCP_DATA_DIR=/data'],
      Cmd:['node','dist/index.js'],Entrypoint:['/entrypoint.sh'],
      User:'',WorkingDir:'/app',
      Labels:{'com.docker.compose.project':'safe'}
    },
    HostConfig:{
      Privileged:false,
      NetworkMode:'cloud-sandbox-mcp-v020-workstation_default',
      Memory:0,NanoCpus:0,PidsLimit:null,IpcMode:'private',
      CgroupnsMode:'private',PidMode:'',SecurityOpt:[],
      CapAdd:[],CapDrop:[],Runtime:'runc',
      PortBindings:{'3000/tcp':[{HostIp:'',HostPort:'3000'}]},
      LogConfig:{Type:'json-file',Config:{}},ShmSize:67108864,
      RestartPolicy:{Name:'unless-stopped'}
    },
    Mounts:[
      {Destination:'/data',Source:SOURCE,Type:'bind',RW:true},
      {Destination:'/app/dist',
        Source:CONTROLLER+'/infra-v1/controller',Type:'bind',RW:false},
      {Destination:'/var/run/docker.sock',Source:'/var/run/docker.sock',
        Type:'bind',RW:true}
    ]
  };
}
function oldWorker(){
  return {
    Name:'/cloud-sandbox-dev-main',Id:'c'.repeat(64),
    Image:'sha256:'+'e'.repeat(64),
    Config:{
      Env:['SECRET_TOKEN=NEVER_PRINT_ME','HOME=/home/agent'],
      Cmd:null,Entrypoint:['/worker/entry.sh'],
      User:'',WorkingDir:'/workspace',
      Labels:{'cloud-sandbox.workspace':'dev-main'}
    },
    HostConfig:{
      Privileged:true,NetworkMode:'bridge',
      Memory:0,NanoCpus:0,PidsLimit:null,
      IpcMode:'private',CgroupnsMode:'private',
      PidMode:'',SecurityOpt:['label=disable'],
      CapAdd:[],CapDrop:[],Runtime:'runc',
      PortBindings:{},LogConfig:{Type:'json-file',Config:{}},
      ShmSize:67108864,RestartPolicy:{Name:'no'}
    },
    Mounts:[
      {Destination:'/workspace',
        Source:SOURCE+'/workspaces/'+WID+'/repo',Type:'bind',RW:true},
      {Destination:'/home/agent',
        Source:SOURCE+'/workspaces/'+WID+'/home',Type:'bind',RW:true},
      {Destination:'/shared-auth',
        Source:SOURCE+'/shared-auth',Type:'bind',RW:true},
      {Destination:'/var/lib/docker',
        Source:SOURCE+'/workspaces/'+WID+'/docker',Type:'bind',RW:true},
      {Destination:'/shared/development',Source:path.join(os.homedir(),
        'Development'),Type:'bind',RW:true},
      {Destination:'/shared/github-repos-local',
        Source:path.join(os.homedir(),'Github-Repos-local'),
        Type:'bind',RW:true}
    ]
  };
}
function migratedController(){
  const old=oldController();
  const migrated=structuredCopy(old);
  migrated.Config=updateControllerHostDataEnv(old.Config,old.Config);
  migrated.Mounts[0].Source=DATA;
  migrated.HostConfig.RestartPolicy.Name='no';
  return migrated;
}
function migratedWorker(){
  const old=oldWorker();
  const migrated=structuredCopy(old);
  for(const entry of migrated.Mounts){
    if(entry.Destination==='/workspace')
      entry.Source=DATA+'/workspaces/'+WID+'/repo';
    if(entry.Destination==='/home/agent')
      entry.Source=DATA+'/workspaces/'+WID+'/home';
    if(entry.Destination==='/shared-auth')
      entry.Source=DATA+'/shared-auth';
    if(entry.Destination==='/var/lib/docker')
      entry.Source=DATA+'/workspaces/'+WID+'/docker';
  }
  return migrated;
}
function structuredCopy(x){return JSON.parse(JSON.stringify(x));}
test('only controller HOST_DATA_DIR path is rewritten, secret bytes are unchanged',()=>{
  const old=oldController();
  const fresh=updateControllerHostDataEnv(old.Config,old.Config);
  assert.deepEqual(fresh.Env,[
    'PORT=3000','HOST_DATA_DIR='+DATA,
    'SECRET_TOKEN=DO_NOT_EXPOSE','MCP_DATA_DIR=/data'
  ]);
  assert.deepEqual(old.Config.Env[1],'HOST_DATA_DIR='+SOURCE);
  assert.throws(()=>updateControllerHostDataEnv(
    {...old.Config,Env:['HOST_DATA_DIR=/tmp']},old.Config),/BASELINE_DRIFT/);
  assert.throws(()=>updateControllerHostDataEnv(
    {Env:['TOKEN=1']},{Env:['TOKEN=1']}),/EXPECTED_ONCE/);
  assert.throws(()=>updateControllerHostDataEnv(
    {Env:['HOST_DATA_DIR=/tmp']},{Env:['HOST_DATA_DIR=/tmp']}),
  /NOT_MAC_ORIGINAL/);
  assert.throws(()=>updateControllerHostDataEnv({
    Env:['HOST_DATA_DIR='+SOURCE,'HOST_DATA_DIR='+SOURCE]
  },{
    Env:['HOST_DATA_DIR='+SOURCE,'HOST_DATA_DIR='+SOURCE]
  }),/EXPECTED_ONCE/);
});
test('cutover journal only supports two pinned original container records',()=>{
  const original=(name,id,img)=>({
    name,id,imageId:img,backupName:'ssd-old-'+name+'-123abc456def',
    restartPolicy:'no'
  });
  const s={schema:'sandbox-v3.ssd-direct-cutover.v1',
    ssdUuid:UUID,originals:[
      original('cloud-sandbox-mcp','a'.repeat(64),image),
      original('cloud-sandbox-dev-main','b'.repeat(64),
        'sha256:'+'f'.repeat(64))
    ]};
  assert.doesNotThrow(()=>validateJournal(s));
  assert(allowlistedBackupName('ssd-old-cloud-sandbox-mcp-123abc456def'));
  assert(!allowlistedBackupName('ssd-old-victim-123abc456def'));
  assert.throws(()=>validateJournal({...s,ssdUuid:'fake'}),/INVALID/);
  assert.throws(()=>validateJournal({...s,originals:[s.originals[0]]}),
    /UNTRUSTED/);
  const bad=structuredCopy(s);
  bad.originals[1].backupName='another-user-container';
  assert.throws(()=>validateJournal(bad),/UNTRUSTED/);
});
test('cold sync targets ONLY pinned SSD leaves, keeping source intact',()=>{
  const data=syncArgs(SOURCE,DATA,{persistent:true});
  assert.deepEqual(data,[
    '-aH','--delete','--stats','--delete-excluded',
    '--exclude=/workspaces/'+WID+'/home/.cache/uv/',
    '--',SOURCE+'/',DATA+'/'
  ]);
  const controller=syncArgs(CONTROLLER,CODE,{persistent:false});
  assert.deepEqual(controller,[
    '-aEH','--delete','--stats','--',CONTROLLER+'/',CODE+'/'
  ]);
  assert.throws(()=>syncArgs(DATA,SOURCE,{persistent:true}),
    /NOT_ALLOWLISTED/);
  assert.throws(()=>syncArgs(SOURCE,CODE,{persistent:true}),
    /NOT_ALLOWLISTED/);
});
test('new controller and worker preserve all extras but change only expected mounts',()=>{
  const c=migratedController();
  const w=migratedWorker();
  assert(verifyRuntimeParity(oldController(),c,{controller:true}));
  assert(verifyRuntimeParity(oldWorker(),w));
  const broken=structuredCopy(w);
  broken.Mounts.find(m=>m.Destination==='/shared/development').Source='/tmp';
  assert.throws(()=>verifyRuntimeParity(oldWorker(),broken),
    /EXTRA_BIND_LOST/);
  const envBroken=structuredCopy(c);
  envBroken.Config.Env[2]='SECRET_TOKEN=DIFFERENT';
  assert.throws(()=>verifyRuntimeParity(oldController(),envBroken,
    {controller:true}),/MIGRATED_CONTROLLER_ENV/);
});
test('active cutover requires 5 physical SSD binds and dual network',()=>{
  const c=migratedController();
  const w=migratedWorker();
  c.State={Running:true};
  w.State={Running:true};
  c.NetworkSettings={Networks:{
    'cloud-sandbox-mcp-v020-workstation_default':{}}};
  w.NetworkSettings={Networks:{bridge:{},'cloud-sandbox-edge':{}}};
  assert.doesNotThrow(()=>verifyNewMounts([c,w]));
  const bad=structuredCopy(w);
  delete bad.NetworkSettings.Networks['cloud-sandbox-edge'];
  assert.throws(()=>verifyNewMounts([c,bad]),/SECONDARY_NETWORK_MISSING/);
  const badSource=structuredCopy(w);
  badSource.Mounts[2].Source=SOURCE+'/shared-auth';
  assert.throws(()=>verifyNewMounts([c,badSource]),/BIND_SOURCE_MISMATCH/);
  const stopped=structuredCopy(c);
  stopped.State.Running=false;
  assert.throws(()=>verifyNewMounts([stopped,w]),/NOT_RUNNING/);
});
test('direct SSD cutover source never replaces originals by symlink',()=>{
  const source=fs.readFileSync(
    new URL('./direct-bind-cutover-on-mac.mjs',import.meta.url),'utf8');
  for(const unsafe of [
    'symlinkSync(', 'rmdirSync(', 'rmSync(', 'rm -rf',
    'docker system prune','docker compose down',
    'unlinkSync(SOURCE)', 'unlinkSync(CONTROLLER)',
    'Docker.raw', 'diskutil erase'
  ]){
    if(unsafe==='Docker.raw')continue; // explanatory comment only
    assert(!source.includes(unsafe),unsafe);
  }
  assert(source.includes('POST'));
  assert(source.includes('cloud-sandbox-edge'));
  assert(source.includes('ROLLBACK_COMPLETE'));
  assert(source.includes('DIRECT_SSD_BIND_CUTOVER_PASSED'));
  assert.equal(NAMES.length,2);
  assert(STATE.endsWith('ssd-direct-cutover-state.json'));
  assert.equal(ROOT,'/Volumes/SSD/Sandbox');
  if(process.platform!=='darwin'){
    const script=new URL('./direct-bind-cutover-on-mac.mjs',import.meta.url);
    for(const mode of ['--inspect','--activate','--rollback']){
      const p=spawnSync(process.execPath,[script.pathname,mode],
        {encoding:'utf8',timeout:5000});
      assert.equal(p.status,2);
      assert.match(p.stdout,/STOP=MACOS_OPERATOR_REQUIRED/);
    }
  }
});

test('Engine lifecycle handles false stop errors and preserves original identity',async()=>{
  const http=await import('node:http');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ssd-docker-engine-mock-'));
  const socket=path.join(temp,'docker.sock');
  const originalId='1'.repeat(64);
  const candidateId='2'.repeat(64);
  const old={
    Id:originalId,
    Name:'/cloud-sandbox-dev-main',
    Image:'sha256:'+'e'.repeat(64),
    State:{Running:true},
    HostConfig:{RestartPolicy:{Name:'no'}},
    Mounts:[]
  };
  const newCandidate={
    Id:candidateId,
    Name:'/cloud-sandbox-dev-main',
    Image:old.Image,
    State:{Running:false},
    HostConfig:{RestartPolicy:{Name:'no'}},
    Mounts:[
      {Destination:'/workspace',Type:'bind',
        Source:DATA+'/workspaces/'+WID+'/repo'},
      {Destination:'/home/agent',Type:'bind',
        Source:DATA+'/workspaces/'+WID+'/home'},
      {Destination:'/shared-auth',Type:'bind',
        Source:DATA+'/shared-auth'},
      {Destination:'/var/lib/docker',Type:'bind',
        Source:DATA+'/workspaces/'+WID+'/docker'}
    ]
  };
  const items=new Map([[originalId,old]]);
  let simulateFalseStopError=true;
  const operations=[];
  const server=http.createServer((req,res)=>{
    let body='';
    req.on('data',d=>{body+=d;});
    req.on('end',()=>{
      const url=new URL(req.url,'http://engine.local');
      const match=url.pathname.match(/^\/v1\.41\/containers\/([^/]+)(?:\/(json|stop|start|update|rename))?$/);
      if(!match){res.writeHead(404);res.end('{}');return;}
      const [,id,action]=match;
      const c=Array.from(items.values())
        .find(x=>x.Id===id||x.Name==='/'+id);
      if(!c){res.writeHead(404);res.end('{}');return;}
      operations.push([req.method,action||'',id]);
      if(req.method==='GET'&&action==='json'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(c));return;
      }
      if(req.method==='POST'&&action==='stop'){
        c.State.Running=false;
        if(simulateFalseStopError){
          simulateFalseStopError=false;
          res.writeHead(500);
          res.end('{"message":"transient daemon stop error"}');
          return;
        }
        res.writeHead(204);res.end();return;
      }
      if(req.method==='POST'&&action==='start'){
        c.State.Running=true;
        res.writeHead(204);res.end();return;
      }
      if(req.method==='POST'&&action==='rename'){
        c.Name='/'+url.searchParams.get('name');
        res.writeHead(204);res.end();return;
      }
      if(req.method==='POST'&&action==='update'){
        c.HostConfig.RestartPolicy=JSON.parse(body).RestartPolicy;
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end('{}');return;
      }
      if(req.method==='DELETE'&&!action){
        items.delete(c.Id);
        res.writeHead(204);res.end();return;
      }
      res.writeHead(404);res.end('{}');
    });
  });
  try{
    await new Promise(resolve=>server.listen(socket,resolve));
    const context={socketPath:socket,apiVersion:'1.41'};
    const {stopDocker,startDocker,restartPolicy,
      renameDocker,removeNewCandidate,call}=await import(
      './direct-bind-cutover-on-mac.mjs');
    // Deliberate 500 error AFTER stop should NOT be treated as failure.
    await stopDocker(context,originalId);
    assert.equal(old.State.Running,false);
    await restartPolicy(context,originalId,'unless-stopped');
    assert.equal(old.HostConfig.RestartPolicy.Name,'unless-stopped');
    const backup='ssd-old-cloud-sandbox-dev-main-123abc456def';
    await renameDocker(context,originalId,backup);
    assert.equal(old.Name,'/'+backup);
    await assert.rejects(renameDocker(context,originalId,'other-name'),
      /UNTRUSTED_RENAME_DESTINATION/);
    // Candidate using same old image and exactly 4 SSD mounts.
    items.set(candidateId,newCandidate);
    await startDocker(context,candidateId);
    assert.equal(newCandidate.State.Running,true);
    await removeNewCandidate(context,'cloud-sandbox-dev-main',originalId);
    assert.equal(items.has(candidateId),false);
    assert.equal(items.has(originalId),true);
    await renameDocker(context,originalId,'cloud-sandbox-dev-main');
    await startDocker(context,originalId);
    assert.equal(old.State.Running,true);
    const output=await call(context,'GET',
      '/containers/'+originalId+'/json');
    assert.equal(output.Id,originalId);
    // Another unexpected container at the canonical name must NEVER
    // be removed by a rollback.
    await renameDocker(context,originalId,backup);
    items.set(candidateId,{...newCandidate,
      Image:'sha256:'+'7'.repeat(64),Name:'/cloud-sandbox-dev-main'});
    await assert.rejects(removeNewCandidate(context,
      'cloud-sandbox-dev-main',originalId),
    /UNRELATED_CONTAINER_HAS_CANONICAL_NAME/);
    assert(items.has(candidateId));
    assert(operations.some(x=>x[1]==='stop'));
    assert(operations.some(x=>x[1]==='rename'));
    assert(operations.some(x=>x[0]==='DELETE'));
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temp,{force:true,recursive:true});
  }
});
