import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import {parseContainerStatus,DEFAULT_CONTROLLER,DEFAULT_WORKSTATION} from './cli.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const code=fs.readFileSync(path.join(dir,'cli.mjs'),'utf8');

test('sandbox defaults to the singular persistent Sandbox V3 workstation',()=>{
  assert.equal(DEFAULT_CONTROLLER,'cloud-sandbox-mcp');
  assert.equal(DEFAULT_WORKSTATION,'cloud-sandbox-dev-main');
  assert.match(code,/process\.argv\[2\]\?\?'start'/);
  assert.match(code,/CONNECTOR_PREFERENCE','Sandbox_V3'/);
  assert.match(code,/LEGACY_MCP_V2_START','DISABLED'/);
});
test('the CLI never invokes ngrok, legacy multiproject startup or destructive docker actions',()=>{
  assert.match(code,/docker.*start/);
  assert.match(code,/EXISTING_CONTAINER_NOT_FOUND/);
  assert.doesNotMatch(code,/docker\.compose|['"]compose['"]\s*,\s*['"]up['"]/);
  assert.doesNotMatch(code,/['"]run['"]\s*,\s*['"]-d['"]|docker\.prune|docker\.system\.prune/);
  assert.doesNotMatch(code,/start-all\.sh['"]\s*[,)]|ngrok\s+http|\.activate\(/);
  assert.match(code,/REMOTE_TUNNEL_RESTARTED','NO'/);
  assert.match(code,/BROWSER_BRIDGE_RESTARTED','NO'/);
});
test('exact container identity and health are required by the runtime status parser',()=>{
  assert.deepEqual(parseContainerStatus('/cloud-sandbox-dev-main|true|healthy',
    'cloud-sandbox-dev-main'),{
    name:'cloud-sandbox-dev-main',active:true,health:'healthy'
  });
  assert.deepEqual(parseContainerStatus('/cloud-sandbox-mcp|false|none',
    'cloud-sandbox-mcp'),{
    name:'cloud-sandbox-mcp',active:false,health:'none'
  });
  assert.throws(()=>parseContainerStatus('/legacy-v2|true|healthy',
    'cloud-sandbox-dev-main'),/UNEXPECTED_CONTAINER_IDENTITY/);
  assert.throws(()=>parseContainerStatus('invalid','cloud-sandbox-dev-main'));
});
test('sandbox help remains available on Linux for cross-platform verification',()=>{
  const result=spawnSync(process.execPath,[path.join(dir,'cli.mjs'),'--help'],{
    encoding:'utf8',timeout:5000
  });
  assert.equal(result.status,0);
  assert.match(result.stdout,/Usage: sandbox/);
  assert.match(result.stdout,/No argument means start/);
});
