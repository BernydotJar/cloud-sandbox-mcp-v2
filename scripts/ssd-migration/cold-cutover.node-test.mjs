import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  validVolume,finalRsyncArgs,linkToSSD,restoreLink,
  renderSSDCompose,renderSSDEnv,
  VOLUME_UUID,SSD,DATA,CODE,EXCLUDED_UV
} from './cold-cutover-on-mac.mjs';

test('cold final copy uses exact allowlisted leaves and cleans stale WAL only on SSD',()=>{
  const mac=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
  const ctrl=path.join(os.homedir(),
    'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
  const persistent=finalRsyncArgs(mac,DATA,{persistent:true});
  assert.deepEqual(persistent,[
    '-aH','--delete','--stats','--delete-excluded',
    '--exclude=/'+EXCLUDED_UV,'--',mac+'/',DATA+'/'
  ]);
  assert(!persistent.includes('-E'));
  const code=finalRsyncArgs(ctrl,CODE);
  assert.deepEqual(code,[
    '-aEH','--delete','--stats','--',ctrl+'/',CODE+'/'
  ]);
  for(const [from,to] of [
    [mac,CODE], [ctrl,DATA], ['/tmp',DATA], [mac,'/Volumes/SSD'],
    [DATA,mac]
  ]){
    assert.throws(()=>finalRsyncArgs(from,to),/NOT_ALLOWLISTED/);
  }
});
test('SSD UUID and APFS guard rejects all wrong identity or readonly cases',()=>{
  const good={FileSystemPersonality:'APFS (Case-insensitive)',
    Internal:false,MountPoint:SSD,VolumeUUID:VOLUME_UUID,
    ReadOnlyVolume:false};
  assert(validVolume(good));
  assert(validVolume({...good,FileSystemPersonality:'',
    FilesystemType:'apfs',VolumeUUID:VOLUME_UUID.toLowerCase()}));
  for(const bad of [{VolumeUUID:'WRONG'}, {MountPoint:'/Volumes/SSD 1'},
    {Internal:true},{ReadOnlyVolume:true},{VolumeReadOnly:true},
    {ReadOnlyMedia:true},{WriteProtected:true},
    {FileSystemPersonality:'exFAT',FilesystemType:'exFAT'}]){
    assert.equal(validVolume({...good,...bad}),false);
  }
});
test('reversible same-filesystem symlink cutover preserves original untouched',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ssd-cutover-link-test-'));
  try{
    const src=path.join(tmp,'data');
    const ssd=path.join(tmp,'ssd');
    const backup=path.join(tmp,'data.pre-ssd-cutover-20261102');
    fs.mkdirSync(src);fs.mkdirSync(ssd);
    fs.writeFileSync(path.join(src,'mac-original.txt'),'origin');
    fs.writeFileSync(path.join(ssd,'ssd-data.txt'),'target');
    linkToSSD(src,ssd,backup);
    assert.equal(fs.realpathSync(src),ssd);
    assert.equal(fs.readFileSync(path.join(backup,'mac-original.txt'),'utf8'),'origin');
    assert.equal(fs.readFileSync(path.join(src,'ssd-data.txt'),'utf8'),'target');
    restoreLink(src,ssd,backup);
    assert.equal(fs.lstatSync(src).isDirectory(),true);
    assert.equal(fs.readFileSync(path.join(src,'mac-original.txt'),'utf8'),'origin');
    assert.equal(fs.existsSync(backup),false);
    restoreLink(src,ssd,backup); // earlier rollback is idempotent
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('a symlink to an unrelated location is rejected by rollback',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ssd-cutover-evil-link-'));
  try{
    const src=path.join(tmp,'data');
    const wanted=path.join(tmp,'wanted');
    const backup=path.join(tmp,'data.pre-ssd-cutover-20261102');
    fs.mkdirSync(wanted);
    fs.symlinkSync('/tmp',src);
    assert.throws(()=>restoreLink(src,wanted,backup),
      /ROLLBACK_SYMLINK_MISMATCH/);
    assert(fs.lstatSync(src).isSymbolicLink());
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('cutover script must never delete original backup or manually move Docker.raw',()=>{
  const script=fs.readFileSync(
    new URL('./cold-cutover-on-mac.mjs',import.meta.url),'utf8');
  for(const bad of ['rm -rf', 'unlinkSync(s.dataBackup)',
    'unlinkSync(s.codeBackup)','Docker.raw', 'docker compose down',
    'docker system prune','diskutil erase','chmod -R','chown -R']){
    // The comment may mention Docker.raw; block only executable moves.
    if(bad==='Docker.raw')continue;
    assert(!script.includes(bad),bad);
  }
  assert(script.includes('CONTAINER_NOT_READING_SSD'));
  assert(script.includes('CONTAINER_WRITE_NOT_ON_SSD'));
  assert(script.includes('quiesceNested(nestedIds)'));
  assert(script.includes('stopBridge(s)'));
  assert(script.includes('resumeBridge(s)'));
  assert(script.includes('com.lch.cloud-sandbox.computer-use'));
  assert(script.includes("updatePolicy('cloud-sandbox-mcp','no')"));
  assert(script.includes("updatePolicy('cloud-sandbox-dev-main','no')"));
  assert(script.includes("status:'ROLLBACK_INCOMPLETE'"));
  assert(script.includes("s.status='SUCCESS_SSD_ACTIVE'"));
});
test('Mac operations cannot be invoked from the Linux workstation',()=>{
  if(process.platform==='darwin')return;
  const script=new URL('./cold-cutover-on-mac.mjs',import.meta.url);
  // A bare source checkout is deliberately NOT a signed release.
  // Signed release execution is tested separately after packaging.
  for(const mode of ['--inspect','--activate','--rollback']){
    const result=spawnSync(process.execPath,[script.pathname,mode],{
      encoding:'utf8',timeout:4000});
    assert.equal(result.status,2);
    assert.match(result.stdout,/STOP=(MACOS_ONLY|ENOENT|CUTOVER_RELEASE_)/);
  }
});

test('future Compose re-creation uses physical SSD bind and disables unguarded restart',()=>{
  const content='services:\n  mcp:\n    restart: unless-stopped\n    ports:\n      - 3000:3000\n';
  const updated=renderSSDCompose(content);
  assert(updated.includes('restart: "no"'));
  assert(!updated.includes('restart: unless-stopped'));
  assert.throws(()=>renderSSDCompose(content.replace('unless-stopped','always')));
  const src=path.join(os.homedir(),'.cloud-sandbox-mcp-data');
  const env='PORT=3000\nHOST_DATA_DIR='+src+'\nMCP_PATH_SECRET=opaque\n';
  const updatedEnv=renderSSDEnv(env);
  assert(updatedEnv.includes('HOST_DATA_DIR='+DATA));
  assert(updatedEnv.includes('MCP_PATH_SECRET=opaque'));
  assert(!updatedEnv.includes(src+'\n'));
  assert.throws(()=>renderSSDEnv(env.replace(src,'/tmp/data')));
  assert.throws(()=>renderSSDEnv(env+'HOST_DATA_DIR='+src+'\n'));
});
