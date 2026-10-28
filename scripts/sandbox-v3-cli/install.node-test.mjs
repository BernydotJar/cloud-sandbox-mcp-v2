import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import {fileURLToPath} from 'node:url';
import {activateCli,upgradeCli,rollbackCli,locations,entryInfo,verifyRelease} from './install-on-mac.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sandbox-v3-cli-fixture-'));
  const home=path.join(temp,'home');
  fs.mkdirSync(home,{mode:0o700});
  const release=path.join(temp,'release');
  fs.mkdirSync(release,{mode:0o700});
  const names=['cli.mjs','install-on-mac.mjs','art.mjs','cloudflare.mjs','health.mjs'];
  const hashes={};
  for(const name of names){
    const payload=fs.readFileSync(path.join(root,name));
    fs.writeFileSync(path.join(release,name),payload);
    hashes[name]=sha(payload);
  }
  const metadata={schema:'sandbox-v3.primary-cli.v1',
    primary_plugin:'Sandbox_V3',source_git_sha:'abcdef0123456789',
    files_sha256:hashes};
  const m=(JSON.stringify(metadata,null,2)+'\n');
  fs.writeFileSync(path.join(release,'manifest.json'),m);
  fs.writeFileSync(path.join(release,'manifest.sha256'),sha(m)+'\n');
  const loc=locations(home);
  fs.mkdirSync(path.dirname(loc.bin),{recursive:true});
  fs.mkdirSync(loc.bin,{recursive:true});
  return {temp,home,release,loc,
    clean:()=>fs.rmSync(temp,{recursive:true,force:true})};
}
test('V3 activation preserves an existing relative symbolic-link legacy command',()=>{
  const f=fixture();
  try{
    const oldDir=path.join(f.home,'.local','share','cloud-sandbox');
    fs.mkdirSync(oldDir,{recursive:true});
    fs.writeFileSync(path.join(oldDir,'start-all.sh'),'#!/bin/sh\necho legacy\n');
    fs.symlinkSync('../share/cloud-sandbox/start-all.sh',f.loc.entry);
    const activated=activateCli({home:f.home,release:f.release});
    assert.equal(activated.status,'ACTIVATED');
    assert.equal(entryInfo(f.loc.entry).kind,'SYMLINK');
    assert.equal(path.resolve(f.loc.bin,fs.readlinkSync(f.loc.entry)),f.loc.cli);
    assert.equal(entryInfo(activated.backup).kind,'SYMLINK');
    assert(fs.existsSync(path.join(f.loc.install,'cloudflare.mjs')));
    assert(fs.existsSync(path.join(f.loc.install,'health.mjs')));
    assert.equal(fs.readlinkSync(activated.backup),'../share/cloud-sandbox/start-all.sh');
    const result=activateCli({home:f.home,release:f.release});
    assert.equal(result.status,'ALREADY_ACTIVE');
    const restored=rollbackCli({home:f.home});
    assert.equal(restored.status,'LEGACY_ENTRY_RESTORED');
    assert.equal(fs.readlinkSync(f.loc.entry),'../share/cloud-sandbox/start-all.sh');
    const again=activateCli({home:f.home,release:f.release});
    assert.equal(again.status,'ACTIVATED');
    const againRoll=rollbackCli({home:f.home});
    assert.equal(againRoll.status,'LEGACY_ENTRY_RESTORED');
    assert.equal(fs.readlinkSync(f.loc.entry),'../share/cloud-sandbox/start-all.sh');
    assert.equal(fs.readFileSync(path.join(oldDir,'start-all.sh'),'utf8'),
      '#!/bin/sh\necho legacy\n');
  }finally{f.clean();}
});
test('existing executable legacy wrapper is backed up without execution',()=>{
  const f=fixture();
  try{
    const old='#!/bin/sh\nexit 99\n';
    fs.writeFileSync(f.loc.entry,old,{mode:0o700});
    const applied=activateCli({home:f.home,release:f.release});
    assert.equal(fs.readFileSync(applied.backup,'utf8'),old);
    assert.equal(fs.readFileSync(f.loc.cli,'utf8'),
      fs.readFileSync(path.join(root,'cli.mjs'),'utf8'));
    rollbackCli({home:f.home});
    assert.equal(fs.readFileSync(f.loc.entry,'utf8'),old);
  }finally{f.clean();}
});
test('activation from no previous sandbox creates a standalone V3 CLI',()=>{
  const f=fixture();
  try{
    assert.equal(entryInfo(f.loc.entry).kind,'ABSENT');
    const applied=activateCli({home:f.home,release:f.release});
    assert.equal(applied.backup,null);
    assert.equal(fs.readlinkSync(f.loc.entry),'../share/sandbox-v3/cli.mjs');
    const output=rollbackCli({home:f.home});
    assert.equal(output.status,'LEGACY_ENTRY_RESTORED');
    assert.equal(entryInfo(f.loc.entry).kind,'ABSENT');
  }finally{f.clean();}
});
test('tampered release is refused without changing pre-existing command',()=>{
  const f=fixture();
  try{
    fs.writeFileSync(f.loc.entry,'#!/bin/sh\nexit 0\n',{mode:0o700});
    fs.appendFileSync(path.join(f.release,'cli.mjs'),'\n# tampered\n');
    assert.throws(()=>activateCli({home:f.home,release:f.release}),
      /RELEASE_FILE_DRIFT/);
    assert.equal(fs.readFileSync(f.loc.entry,'utf8'),'#!/bin/sh\nexit 0\n');
  }finally{f.clean();}
});
test('binary or unrecognized launcher is not overwritten',()=>{
  const f=fixture();
  try{
    fs.writeFileSync(f.loc.entry,Buffer.from([0,12,18,0,12]));
    assert.throws(()=>activateCli({home:f.home,release:f.release}),
      /SANDBOX_ENTRY_BINARY_REFUSED/);
  }finally{f.clean();}
});
test('release manifest validates all referenced file checksums',()=>{
  const f=fixture();
  try{
    const meta=verifyRelease(f.release);
    assert.equal(meta.primary_plugin,'Sandbox_V3');
    fs.writeFileSync(path.join(f.release,'manifest.sha256'),'0'.repeat(64));
    assert.throws(()=>verifyRelease(f.release),/RELEASE_MANIFEST_HASH_MISMATCH/);
  }finally{f.clean();}
});

test('upgrade existing Mac V3 CLI in place, preserve original legacy backup and previous V3 binary',()=>{
  const f=fixture();
  try{
    const previousEntry='#!/bin/sh\necho previous-v2\n';
    fs.writeFileSync(f.loc.entry,previousEntry,{mode:0o700});
    const installed=activateCli({home:f.home,release:f.release});
    const oldV3='#!/usr/bin/env node\n// old version has broken symlink guard\n';
    fs.writeFileSync(f.loc.cli,oldV3,{mode:0o700});
    const record=JSON.parse(fs.readFileSync(f.loc.record,'utf8'));
    record.cli_sha256=sha(oldV3);
    delete record.art_sha256; // previous release did not include artwork
    fs.writeFileSync(f.loc.record,JSON.stringify(record));
    const upgraded=upgradeCli({home:f.home,release:f.release});
    assert.equal(upgraded.status,'UPGRADED');
    assert.equal(fs.readFileSync(upgraded.previousV3Backup,'utf8'),oldV3);
    assert.equal(fs.readFileSync(installed.backup,'utf8'),previousEntry);
    assert.equal(fs.readlinkSync(f.loc.entry),'../share/sandbox-v3/cli.mjs');
    assert.equal(fs.readFileSync(f.loc.cli,'utf8'),
      fs.readFileSync(path.join(root,'cli.mjs'),'utf8'));
    assert.equal(fs.readFileSync(path.join(f.loc.install,'art.mjs'),'utf8'),
      fs.readFileSync(path.join(root,'art.mjs'),'utf8'));
    assert.equal(fs.readFileSync(path.join(f.loc.install,'cloudflare.mjs'),'utf8'),
      fs.readFileSync(path.join(root,'cloudflare.mjs'),'utf8'));
    assert.equal(fs.readFileSync(path.join(f.loc.install,'health.mjs'),'utf8'),
      fs.readFileSync(path.join(root,'health.mjs'),'utf8'));
    assert.equal(upgradeCli({home:f.home,release:f.release}).status,'ALREADY_CURRENT');
    rollbackCli({home:f.home});
    assert.equal(fs.readFileSync(f.loc.entry,'utf8'),previousEntry);
  }finally{f.clean();}
});
test('upgrade fails closed on current V3 binary drift, preserving original entry',()=>{
  const f=fixture();
  try{
    activateCli({home:f.home,release:f.release});
    fs.appendFileSync(f.loc.cli,'\n// modified externally');
    assert.throws(()=>upgradeCli({home:f.home,release:f.release}),
      /INSTALLED_V3_CLI_HASH_DRIFT/);
    assert.equal(fs.readlinkSync(f.loc.entry),'../share/sandbox-v3/cli.mjs');
  }finally{f.clean();}
});

test('unrecorded foreign Cloudflare module cannot be overwritten on CLI upgrade',()=>{
  const f=fixture();
  try{
    activateCli({home:f.home,release:f.release});
    const installed=path.join(f.loc.install,'cloudflare.mjs');
    fs.writeFileSync(installed,'// unknown and not signed');
    assert.throws(()=>upgradeCli({home:f.home,release:f.release}),
      /INSTALLED_CLOUDFLARE_MODULE_HASH_DRIFT/);
    assert.equal(fs.readFileSync(installed,'utf8'),'// unknown and not signed');
  }finally{f.clean();}
});

test('unknown health module cannot be overwritten by an upgrade',()=>{
  const f=fixture();
  try{
    activateCli({home:f.home,release:f.release});
    const health=path.join(f.loc.install,'health.mjs');
    fs.writeFileSync(health,'// local unrelated script');
    assert.throws(()=>upgradeCli({home:f.home,release:f.release}),
      /INSTALLED_HEALTH_MODULE_HASH_DRIFT/);
    assert.equal(fs.readFileSync(health,'utf8'),'// local unrelated script');
  }finally{f.clean();}
});

test('in-place upgrade from the installed Cloudflare-era V3 adds health.mjs safely',()=>{
  const f=fixture();
  try{
    const oldLegacy='#!/bin/sh\\necho legacy\\n';
    fs.writeFileSync(f.loc.entry,oldLegacy,{mode:0o700});
    const first=activateCli({home:f.home,release:f.release});
    const oldV3='#!/usr/bin/env node\\n// earlier V3 before public HTTPS probe\\n';
    fs.writeFileSync(f.loc.cli,oldV3,{mode:0o700});
    const file=path.join(f.loc.install,'health.mjs');
    fs.unlinkSync(file);
    const record=JSON.parse(fs.readFileSync(f.loc.record,'utf8'));
    record.cli_sha256=sha(oldV3);
    delete record.health_sha256;
    fs.writeFileSync(f.loc.record,JSON.stringify(record));
    const upgraded=upgradeCli({home:f.home,release:f.release});
    assert.equal(upgraded.status,'UPGRADED');
    assert.equal(fs.readFileSync(file,'utf8'),
      fs.readFileSync(path.join(root,'health.mjs'),'utf8'));
    assert.equal(fs.readFileSync(first.backup,'utf8'),oldLegacy);
    assert.equal(fs.readFileSync(upgraded.previousV3Backup,'utf8'),oldV3);
    const next=JSON.parse(fs.readFileSync(f.loc.record,'utf8'));
    assert.equal(next.health_sha256,sha(fs.readFileSync(file)));
    assert.equal(upgradeCli({home:f.home,release:f.release}).status,'ALREADY_CURRENT');
  }finally{f.clean();}
});
