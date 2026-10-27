import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const code=fs.readFileSync(path.join(root,'collect-on-mac.mjs'),'utf8');
test('native diagnostic gate validates both release manifests and signed content hashes',()=>{
  assert.match(code,/function verifyBundle\(/);
  assert.match(code,/MANIFEST_DIGEST_MISMATCH/);
  assert.match(code,/RELEASE_FILE_SHA256_MISMATCH/);
  assert.match(code,/AX_SOURCE_COMMIT/);
  assert.match(code,/GUEST_SOURCE_COMMIT/);
  assert.match(code,/HANDOFF_SHA256/);
});
test('gate invokes only read-only Swift typechecks and storage preflight',()=>{
  for(const x of ['ax-readback-20261026','isolated-mac-cua-20261026',
    'inspect-on-mac.mjs','swift-preflight.mjs','preflight.mjs'])
    assert(code.includes(x));
  assert.match(code,/const results=\[/);
  assert.match(code,/noRemoteDebugging:true,noDesktopMutation:true,noVmCreation:true/);
  assert.doesNotMatch(code,/tart (create|run|pull)|brew install|docker (prune|rm)|--remote-debugging/);
});
test('Mac gate writes a private evidence report, not silently a VM or extra worker',()=>{
  assert.match(code,/last-host-native-gate\.json/);
  assert.match(code,/flag:'wx',mode:0o600/);
  assert.match(code,/fs\.renameSync\(temporary,dest\)/);
  assert.match(code,/P0_STATUS','OPEN_UNTIL_GUEST_GUI_E2E/);
  assert.match(code,/EXPLICIT_COLLECT_MODE_REQUIRED/);
});
