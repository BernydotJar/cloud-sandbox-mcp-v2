import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.dirname(fileURLToPath(import.meta.url));
const doctor=fs.readFileSync(path.join(root,'doctor-on-mac.mjs'),'utf8');
const installer=fs.readFileSync(path.join(root,'install-on-mac.mjs'),'utf8');
const acceptance=fs.readFileSync(path.join(root,'accept-on-mac.mjs'),'utf8');

test('doctor reads only the same-Mac launchctl label and local HTTP status',()=>{
  assert.match(doctor,/com\.lch\.same-mac-ax/);
  assert.match(doctor,/launchdState/);
  assert.match(doctor,/last exit code/);
  assert.match(doctor,/127\.0\.0\.1:9779/);
  assert.match(doctor,/manifest\.sha256/);
  assert.match(doctor,/INSTALLED_SERVICE_CUSTOMIZED_REPAIR_REFUSED/);
  assert.match(doctor,/SAME_MAC_IDENTITY_MISMATCH/);
});
test('repair uses a private original-plist backup and scoped reload only',()=>{
  assert.match(doctor,/StandardErrorPath/);
  assert.match(doctor,/StandardOutPath/);
  assert.match(doctor,/BACKUP/);
  assert.match(doctor,/OWN_LAUNCH_AGENT_RELOADED/);
  assert.match(doctor,/--repair/);
  assert.match(doctor,/HEALTH|READY_HTTP|REPAIR_HTTP_RESULT/);
  assert.doesNotMatch(doctor,/docker\s+(?:rm|prune)|--remote-debugging|tart\s+create/);
});
test('the installer no longer claims PASS before authenticated HTTP readiness',()=>{
  const wait=installer.indexOf('await waitForLocalAXStatus(token)');
  const success=installer.indexOf("log('INSTALL','PASS')");
  assert(wait>0&&success>wait);
  assert.match(installer,/REGISTERED_BUT_HTTP_NOT_READY/);
  assert.match(installer,/ONE_TIME_CONSENT_PENDING/);
});
test('acceptance distinguishes one-time Accessibility permission from server startup',()=>{
  assert.match(acceptance,/waitForLocalAXStatus\(token\)/);
  assert.match(acceptance,/SAME_MAC_ACCESSIBILITY_PERMISSION_REQUIRED/);
  assert.match(acceptance,/LOCAL_AX_READY/);
  assert.match(acceptance,/AX_VALUE_CHANGED_WITHOUT_FOCUS/);
});
test('on non-Mac machine the doctor returns a clear blocker without changing launchd',()=>{
  if(process.platform==='darwin')return;
  const output=spawnSync(process.execPath,
    [path.join(root,'doctor-on-mac.mjs'),'--inspect'],
    {encoding:'utf8',timeout:5000,maxBuffer:8000});
  assert.equal(output.status,2);
  assert.match(output.stdout,/STOP=MAC_ONLY/);
});
