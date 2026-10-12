import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.resolve(process.argv[2] || 'release-browser-v2');
const manifestBytes = await fs.readFile(path.join(release, 'manifest.json'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(manifestBytes), (await fs.readFile(path.join(release, 'manifest.sha256'), 'utf8')).trim());
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.schema, 'cloud-sandbox.browser-runtime-release.v2');
assert.equal(manifest.source_dirty, false, 'A dirty source release must be rejected');
assert.equal(manifest.expected_tool_count, 29);
assert.equal(manifest.playwright_core, '1.64.0');
assert.equal(Object.keys(manifest.controller_dependencies).length, 8);
const seen = new Set();
for (const item of manifest.files) {
  assert(!seen.has(item.path)); seen.add(item.path);
  assert(!/\.(?:ttf|otf|woff2?)$/i.test(item.path), 'Unexpected non-runtime visual asset');
  assert(!path.isAbsolute(item.path) && !item.path.split('/').includes('..'));
  const bytes = await fs.readFile(path.join(release, item.path));
  assert.equal(hash(bytes), item.sha256, item.path);
  assert.equal(bytes.length, item.bytes, item.path);
}
for (const filename of ['controller/mcp/server.js', 'controller/mcp/browser-runtime-tools.js',
  'controller/services/computer-use-service.js', 'host/bridge.mjs', 'install.mjs']) {
  execFileSync(process.execPath, ['--check', path.join(release, filename)], { stdio: 'pipe' });
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-v2-registry-'));
async function registry(directory, computer) {
  const { createMcpServer } = await import(pathToFileURL(path.join(directory, 'mcp/server.js')));
  const server = createMcpServer({}, computer);
  const client = new Client({ name: 'release-registry-verifier', version: '1' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    return (await client.listTools()).tools;
  } finally { await client.close(); await server.close(); }
}
try {
  for (const dir of ['baseline', 'candidate']) {
    const root = path.join(temp, dir);
    await fs.mkdir(path.join(root, 'mcp'), { recursive: true });
    await fs.mkdir(path.join(root, 'utils'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await fs.symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await fs.copyFile(path.join(repo, 'dist/utils/errors.js'), path.join(root, 'utils/errors.js'));
  }
  await fs.copyFile(path.join(repo, 'deploy/baselines/task-sessions/server.js'), path.join(temp, 'baseline/mcp/server.js'));
  await fs.cp(path.join(release, 'controller'), path.join(temp, 'candidate'), { recursive: true });
  const computer = { status: async () => ({ enabled: false }), browserRuntime: async () => ({ enabled: false }) };
  const oldTools = await registry(path.join(temp, 'baseline'), computer);
  const tools = await registry(path.join(temp, 'candidate'), computer);
  assert.equal(oldTools.length, 23);
  assert.equal(tools.length, 29);
  for (const old of oldTools) assert.deepEqual(tools.find(t => t.name === old.name), old, 'Changed existing contract: ' + old.name);
  for (const name of ['browser_runtime_status', 'browser_tabs', 'browser_open', 'browser_inspect', 'browser_screenshot', 'browser_action']) {
    assert(tools.some(t => t.name === name));
  }
  if (process.platform === 'linux') {
    const result = spawnSync(process.execPath, [path.join(release, 'install.mjs'), '--inspect'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert(result.stdout.includes('MACOS_OPERATOR_ONLY'));
  }
  console.log(JSON.stringify({ result: 'PASS', files_verified: manifest.files.length,
    original_contracts_unchanged: oldTools.length, total_tools: tools.length,
    release_source_commit: manifest.source_commit, release_source_dirty: manifest.source_dirty,
    actual_mac_deployment: 'NOT_EXECUTED' }, null, 2));
} finally { await fs.rm(temp, { recursive: true, force: true }); }
