import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import {URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  validateVolume,verifyArgs,inspectPaths,backupName,atomicSwitchKeepingBackup,SSD,
  EXPECTED_UUID,SRC,STAGING,FINAL
} from './finish-on-mac.mjs';

const disk={MountPoint:SSD,FileSystemPersonality:'APFS',
  Internal:false,Writable:true,VolumeUUID:EXPECTED_UUID,
  Encrypted:false};
test('pinned Toshiba APFS read/write volume permits unencrypted disk',()=>{
  assert.deepEqual(validateVolume(disk),
    {volumeUUID:EXPECTED_UUID,readWrite:true,apfs:true});
  assert.equal(FINAL,'/Volumes/SSD/MacStorage/Games-nxnative');
  assert.equal(STAGING,
    '/Volumes/SSD/MacStorage/.migration-staging/Games-nxnative-20261101-225027');
  assert.equal(SRC,path.join(os.homedir(),'Games/nxnative'));
});
test('identity mismatch, wrong mount, read-only, internal, exFAT refuse writes',()=>{
  const examples=[
    {VolumeUUID:'WRONG'},
    {MountPoint:'/Volumes/SSD 1'},
    {Writable:false},
    {Internal:true},
    {FileSystemPersonality:'exFAT'}
  ];
  for(const sample of examples){
    assert.throws(()=>validateVolume({...disk,...sample}),
      /TOSHIBA_SSD_IDENTITY_OR_MOUNT_CHANGED/);
  }
});
test('rsync full checksum verification is always dry-run and data is never copied',()=>{
  const args=verifyArgs();
  assert.deepEqual(args,['-rclni','--delete','--',SRC+'/',STAGING+'/']);
  assert(args[0].includes('n'),'rsync dry-run flag required');
  assert(args[0].includes('c'),'checksum flag required');
  assert.throws(()=>verifyArgs('/tmp/other',STAGING),
    /VERIFY_SOURCE_TARGET_NOT_ALLOWLISTED/);
});
test('cannot override source, staging or destination',()=>{
  assert.throws(()=>inspectPaths({src:'/tmp/other',stage:STAGING,dest:FINAL}),
    /PATH_OVERRIDE_DENIED/);
  assert.throws(()=>inspectPaths({src:SRC,stage:'/tmp/other',dest:FINAL}),
    /PATH_OVERRIDE_DENIED/);
  assert.throws(()=>inspectPaths({src:SRC,stage:STAGING,dest:'/tmp/other'}),
    /PATH_OVERRIDE_DENIED/);
});
test('backup path is stable, dated, and does not overwrite original',()=>{
  const name=backupName(new Date('2026-11-02T15:40:35.123Z'));
  assert.equal(name,SRC+'.pre-ssd-migration-20261102-154035');
  assert(name!==SRC&&name!==STAGING&&name!==FINAL);
});
test('finalization explicitly retains original backup and never prunes game data',()=>{
  const code=fs.readFileSync(new URL('./finish-on-mac.mjs',import.meta.url),'utf8');
  assert(code.includes('filesystem.renameSync(source,backup)'));
  assert(code.includes("filesystem.symlinkSync(dest,source,'dir')"));
  assert(code.includes('requiresGameLaunchAcceptance:true'));
  assert(code.includes('safeToDeleteBackup:false'));
  assert(code.includes('copiedDataDeleted:false'));
  assert(code.includes('originalDataDeleted:false'));
  assert(!code.includes('rm -rf'));
  assert(!code.includes('fs.rmSync('));
  assert(!code.includes('fs.rmdirSync('));
  assert(!code.includes('shutil.rmtree('));
  assert(!code.includes('docker system prune'));
});
test('Linux cannot execute Mac finalizer, regardless of flag',()=>{
  if(process.platform==='darwin')return;
  const script=new URL('./finish-on-mac.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[script.pathname,'--finalize'],
    {encoding:'utf8',timeout:7000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/ENOENT|RELEASE_MANIFEST_HASH_INVALID|MACOS_ONLY/);
});

test('atomic switch leaves timestamped original intact and source symlinked',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nxnative-finalizer-test-'));
  try{
    const original=path.join(home,'nxnative');
    const stage=path.join(home,'stage');
    const destination=path.join(home,'ssd-nxnative');
    const backup=original+'.pre-ssd-migration-test';
    fs.mkdirSync(original);fs.mkdirSync(stage);
    fs.writeFileSync(path.join(original,'sample.bin'),'original');
    fs.writeFileSync(path.join(stage,'sample.bin'),'new-on-ssd');
    const status=atomicSwitchKeepingBackup({
      source:original,stage,dest:destination,backup
    });
    assert.equal(status.originalBackup,backup);
    assert.equal(fs.readlinkSync(original),destination);
    assert.equal(fs.readFileSync(path.join(backup,'sample.bin'),'utf8'),'original');
    assert.equal(fs.readFileSync(path.join(original,'sample.bin'),'utf8'),'new-on-ssd');
    assert.equal(fs.existsSync(stage),false);
    assert.equal(fs.existsSync(destination),true);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('atomic switch rolls back source directory if symlink creation fails',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nxnative-failure-test-'));
  try{
    const original=path.join(home,'nxnative');
    const stage=path.join(home,'stage');
    const destination=path.join(home,'ssd-nxnative');
    const backup=original+'.pre-ssd-migration-test';
    fs.mkdirSync(original);fs.mkdirSync(stage);
    fs.writeFileSync(path.join(original,'original'),'unique');
    const fakeFS={...fs,symlinkSync:()=>{throw Error('SYMLINK_SIMULATED_FAILURE');}};
    assert.throws(()=>atomicSwitchKeepingBackup({
      source:original,stage,dest:destination,backup,filesystem:fakeFS
    }),/SYMLINK_SIMULATED_FAILURE/);
    assert.equal(fs.existsSync(path.join(original,'original')),true);
    assert.equal(fs.existsSync(destination),true);
    assert.equal(fs.lstatSync(original).isSymbolicLink(),false);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('pre-existing final folder prevents atomic switch without mutation',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nxnative-collision-test-'));
  try{
    for(const name of ['original','stage','final'])fs.mkdirSync(path.join(home,name));
    const backup=path.join(home,'original-bak');
    assert.throws(()=>atomicSwitchKeepingBackup({
      source:path.join(home,'original'),stage:path.join(home,'stage'),
      dest:path.join(home,'final'),backup
    }),/ATOMIC_SWITCH_TARGET_OR_BACKUP_ALREADY_EXISTS/);
    assert(fs.existsSync(path.join(home,'original')));
    assert(fs.existsSync(path.join(home,'stage')));
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('failed Mac source rename reverts SSD final destination to original stage',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nxnative-source-rename-test-'));
  try{
    const source=path.join(home,'original');
    const stage=path.join(home,'stage');
    const dest=path.join(home,'final');
    const backup=path.join(home,'backup');
    fs.mkdirSync(source);fs.mkdirSync(stage);
    const fake={...fs,renameSync:(from,to)=>{
      if(from===source&&to===backup)throw Error('SIMULATED_MAC_RENAME_FAILURE');
      return fs.renameSync(from,to);
    }};
    assert.throws(()=>atomicSwitchKeepingBackup({
      source,stage,dest,backup,filesystem:fake
    }),/SIMULATED_MAC_RENAME_FAILURE/);
    assert(fs.existsSync(source));
    assert(fs.existsSync(stage));
    assert(!fs.existsSync(dest));
    assert(!fs.existsSync(backup));
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
