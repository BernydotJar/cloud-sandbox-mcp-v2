import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {URL} from 'node:url';
import {
  deltaCutoffMs,isExcluded,scanMetadataTree,
  scanRecentMetadata,collectMissingDirectEntries
} from './ssd-recent-delta-on-mac.mjs';

function fixture(){
  const top=fs.mkdtempSync(path.join(os.tmpdir(),'ssd-recent-fixture-'));
  const source=path.join(top,'src');
  const target=path.join(top,'dst');
  fs.mkdirSync(source);fs.mkdirSync(target);
  return {source,target,pair:{source,target,name:'controller'}};
}
test('cutoff selects ten minutes before last previous cold sync',()=>{
  const a=Date.now()-180000;
  const b=Date.now()-60000;
  assert.equal(deltaCutoffMs(a,b),a-600000);
  assert.throws(()=>deltaCutoffMs(a,b+3600000),/UNTRUSTED/);
  assert.throws(()=>deltaCutoffMs(
    Date.now()-48*3600000,Date.now()-48*3600000),/TOO_OLD/);
});
test('only original uv cache subtree is excluded',()=>{
  const prefix='workspaces/6544ba3e-e124-4ca5-adc7-62c6dd47ba86/home/.cache/uv';
  assert(isExcluded(prefix,'persistent'));
  assert(isExcluded(prefix+'/abc','persistent'));
  assert(!isExcluded(prefix+'/abc','controller'));
  assert(!isExcluded(prefix+'-other','persistent'));
});
test('scanner detects recent files, links and deleted names',()=>{
  const f=fixture();
  const cutoff=Date.now()-60000;
  fs.mkdirSync(path.join(f.source,'nested'));
  fs.mkdirSync(path.join(f.target,'nested'));
  fs.writeFileSync(path.join(f.source,'nested','changed.txt'),'new');
  fs.writeFileSync(path.join(f.source,'nested','new file.txt'),'new file');
  fs.writeFileSync(path.join(f.target,'nested','old-deleted.txt'),'gone');
  fs.symlinkSync('changed.txt',path.join(f.source,'nested','link'));
  const found=scanMetadataTree(f.pair,cutoff);
  assert(found.changed.includes('nested/changed.txt'));
  assert(found.changed.includes('nested/new file.txt'));
  assert(found.changed.includes('nested/link'));
  assert(found.touchedDirs.includes('nested'));
  const missing=collectMissingDirectEntries(f.pair,found);
  assert.deepEqual(missing,['nested/old-deleted.txt']);
});
test('scanner applies strict time, entry and trusted-source gates',()=>{
  const f=fixture();
  fs.writeFileSync(path.join(f.source,'item.txt'),'small');
  assert.throws(()=>scanMetadataTree(
    f.pair,Date.now()-60000,{maxEntries:0}),/LIMIT_REACHED/);
  assert.throws(()=>scanMetadataTree(
    f.pair,Date.now()-60000,{maxSelected:0}),/TOO_LARGE/);
  assert.throws(()=>scanRecentMetadata(
    f.pair,Date.now()-60000),/NOT_ALLOWLISTED/);
  assert.throws(()=>scanMetadataTree(
    f.pair,Date.now()+3600000),/CUTOFF_OUT_OF_RANGE/);
});
test('link to source directory is never followed',()=>{
  const f=fixture();
  fs.mkdirSync(path.join(f.source,'dir'));
  fs.writeFileSync(path.join(f.source,'dir','item'),'1');
  fs.symlinkSync('dir',path.join(f.source,'other'));
  const scan=scanMetadataTree(f.pair,Date.now()-60000);
  assert(scan.changed.includes('other'));
  assert(!scan.changed.includes('other/item'));
});
test('new activation mode never calls full-tree sync in recent branch',()=>{
  const source=fs.readFileSync(new URL(
    './direct-bind-cutover-on-mac.mjs',import.meta.url),'utf8');
  assert(source.includes("'--activate-recent'"));
  assert(source.includes('runRootRecentDelta(deltaSince,id)'));
  assert(source.includes('FULL_TREE_RSYNC_SKIPPED'));
  assert(source.includes('DELTA_RECENT_TRANSFER'));
  assert(source.includes('RECENT_DELTA_REVIEW_REQUIRED'));
  assert(source.includes('explicitDeletionPermission:false'));
});

test('root transfer is manifest-restricted and avoids second sudo wrapper',()=>{
  const helper=fs.readFileSync(new URL(
    './ssd-recent-delta-on-mac.mjs',import.meta.url),'utf8');
  assert(helper.includes('DELTA_SIGNED_BUNDLE_IDENTITY_DRIFT'));
  assert(helper.includes("m.data_source!==SOURCE"));
  assert(helper.includes('runRootRecentDelta(cutoffMs,runId)'));
  assert(helper.includes("spawn('/usr/bin/sudo',args"));
  assert(helper.includes("spawnSync('/usr/bin/rsync',args"));
  assert(helper.includes("'--from0'"));
  assert(helper.includes("'--files-from='+manifestPath"));
  assert(helper.includes('MAX_SCAN_MS=300000'));
  assert(helper.includes('quarantineTargetTombstones'));
  assert(helper.includes("process.getuid()!==0"));
  assert(!helper.includes('rsync --delete'));
});
