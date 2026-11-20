import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const entrypoint=await readFile(new URL('../docker/workstation-entrypoint.sh',import.meta.url),'utf8');
const dockerfile=await readFile(new URL('../docker/sandbox.Dockerfile',import.meta.url),'utf8');

test('workstation init explicitly includes a child-reaping PID 1',()=>{
  assert.match(entrypoint,/^exec \/usr\/bin\/tini -g -- sleep infinity$/m);
  assert.doesNotMatch(entrypoint,/^exec sleep infinity$/m);
  // The reaper must run with PID 1, not as a detached watchdog.
  assert.equal((entrypoint.match(/^exec /gm)||[]).length,1);
  assert.match(dockerfile,/\btini\b/);
});

test('nested dockerd still starts and passes readiness before init replaces shell',()=>{
  const dockerd=entrypoint.indexOf('dockerd ');
  const readiness=entrypoint.indexOf('if ! docker info >/dev/null 2>&1; then');
  const reaper=entrypoint.lastIndexOf('exec /usr/bin/tini');
  assert.ok(dockerd>=0&&readiness>dockerd&&reaper>readiness);
  assert.match(dockerfile,/ENTRYPOINT \[\"\/usr\/local\/bin\/cloud-sandbox-workstation\"\]/);
});
