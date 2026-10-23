import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {URL} from 'node:url';
import process from 'node:process';
const install=new URL('./install-on-mac.mjs',import.meta.url);
const content=fs.readFileSync(install,'utf8');
test('native driver hot patch refuses to operate from Linux workstation',()=>{
  if(process.platform==='darwin')return;
  const r=spawnSync(process.execPath,[install.pathname,'--install'],{encoding:'utf8'});
  assert.equal(r.status,1);
  assert.match(r.stdout,/MUST_RUN_ON_OPERATOR_MAC/);
});
test('installer refuses code drift and active delegated sessions',()=>{
  assert.match(content,/LIVE_NATIVE_CODE_DRIFT/);
  assert.match(content,/ACTIVE_OR_UNKNOWN_TASK_SESSION/);
  assert.match(content,/ACTIVE_TASK_SESSION/);
  assert.match(content,/MANIFEST_HASH_MISMATCH/);
  assert.match(content,/RELEASE_SOURCE_TAMPERED/);
});
test('installer hot swaps only native.jxa and does not restart browsers/controller',()=>{
  assert.match(content,/CloudSandboxComputerUse','native.jxa/);
  assert.doesNotMatch(content,/\['restart','cloud-sandbox-mcp'\]/);
  assert.doesNotMatch(content,/launchctl.*kickstart/);
  assert.match(content,/fsp\.rename\(temp,installed\)/);
});
