import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';

const file=fileURLToPath(new URL(
  './ssd-dind-isolated-smoke-on-mac.sh',import.meta.url));
const script=readFileSync(file,'utf8');

test('safe original entrypoint smoke script is valid shell',()=>{
  const result=spawnSync('bash',['-n',file],
    {encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
});
test('smoke test pins Toshiba UUID, cannot start current Docker data',()=>{
  assert(script.includes('A6268296-0330-4A69-9BE3-059BE8E4016A'));
  assert(script.includes('cloud-sandbox-dev-main'));
  assert(script.includes("original-worker")===false);
  assert(script.includes('startID='));
  assert(script.includes('afterID='));
  assert(script.includes('exec sleep infinity')===false);
  assert(script.includes('SSD_REAL_ENTRYPOINT_ISOLATED_SMOKE_PASS'));
  assert(script.includes('--privileged'));
  assert(script.includes('INNER_DOCKER_STORAGE_DRIVER=vfs'));
  assert(script.includes('ssd-dind-isolated.XXXXXXXX'));
  assert(script.includes('src=$tmp,dst=/var/lib/docker'));
  assert(!script.includes('src=/Volumes/SSD/Sandbox/persistent/cloud-sandbox-mcp-data/workspaces/'));
  for(const disallowed of [
    'docker compose down','docker system prune','rsync ',
    'unlink ', 'rm -rf', 'chmod -R','chown -R'
  ])assert(!script.includes(disallowed),disallowed);
});
test('Linux environment refuses test before changing any Docker resource',()=>{
  if(process.platform==='darwin')return;
  const r=spawnSync('bash',[file,'--test'],
    {encoding:'utf8',timeout:10000});
  assert.equal(r.status,2);
  assert.match(r.stderr,/STOP=MAC_ONLY/);
});
