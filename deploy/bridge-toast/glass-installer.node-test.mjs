import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import {safeFile,atomicReplace,verifySource} from './install-glass-on-mac.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('installed candidate SHA256 matches the advertised Swift source',()=>{
  const expected=verifySource();
  assert.match(expected,/^[a-f0-9]{64}$/);
  assert.equal(expected,sha(fs.readFileSync(new URL('./bridge-toast.swift',import.meta.url))));
});
test('atomic replacement changes only the target and preserves private file mode',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'akira-install-qa-'));
  try {
    const target=path.join(root,'installed');
    fs.writeFileSync(target,'old',{mode:0o600});
    const before=sha(fs.readFileSync(target));
    atomicReplace(target,Buffer.from('new'),0o700);
    assert.equal(fs.readFileSync(target,'utf8'),'new');
    assert.notEqual(sha(fs.readFileSync(target)),before);
    assert.equal(fs.statSync(target).mode&0o777,0o700);
    atomicReplace(target,Buffer.from('old'),0o600);
    assert.equal(sha(fs.readFileSync(target)),before);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('symlink and unowned/non-file baselines are rejected',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'akira-install-qa-'));
  try {
    const real=path.join(root,'real');
    const link=path.join(root,'link');
    fs.writeFileSync(real,'ok');
    fs.symlinkSync(real,link);
    assert.throws(()=>safeFile(link),/UNSAFE_OR_UNOWNED_FILE/);
    assert.throws(()=>safeFile(root),/UNSAFE_OR_UNOWNED_FILE/);
    assert.equal(safeFile(real).bytes.toString(),'ok');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Mac-only installer cannot alter browsers or Bridge service config',()=>{
  const src=fs.readFileSync(new URL('./install-glass-on-mac.mjs',import.meta.url),'utf8');
  assert.match(src,/EXPECTED_INSTALLED_SPLASH_NOT_FOUND/);
  assert.match(src,/INSTALL_ROLLED_BACK/);
  assert.match(src,/SWIFT_TYPECHECK/);
  assert.match(src,/SWIFT_COMPILE/);
  assert.match(src,/INSTALLED_BINARY_CHANGED_NO_OVERWRITE/);
  assert.doesNotMatch(src,/remote-debugging|kickstart|docker|bridge\\.mjs|npm install/);
});
