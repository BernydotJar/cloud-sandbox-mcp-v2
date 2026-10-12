import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(repo, 'release-browser-v2'));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
const dirty = Boolean(git(['status', '--porcelain']));
if (dirty) throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const baselineDir = path.join(repo, 'deploy/baselines/task-sessions');
const baseline = JSON.parse(await fs.readFile(path.join(baselineDir, 'manifest.json'), 'utf8'));
for (const [file, hash] of Object.entries(baseline.files)) {
  if (sha(await fs.readFile(path.join(baselineDir, file))) !== hash) throw Error('BASELINE_HASH_MISMATCH');
}
try { await fs.mkdir(output, { recursive: false, mode: 0o700 }); }
catch { throw Error('RELEASE_OUTPUT_ALREADY_EXISTS_OR_PARENT_MISSING'); }
const writes = new Map();
async function add(relative, from) { writes.set(relative, await fs.readFile(from)); }
let server = await fs.readFile(path.join(baselineDir, 'server.js'), 'utf8');
if (server.split('    if (computer) {').length !== 2) throw Error('CUSTOM_REGISTRY_ANCHOR_MISMATCH');
server = "import { registerBrowserRuntimeTools } from './browser-runtime-tools.js';\n" +
  server.replace('    if (computer) {', '    if (computer) {\n        registerBrowserRuntimeTools(server, computer);');
writes.set('controller/mcp/server.js', Buffer.from(server));
await add('controller/mcp/browser-runtime-tools.js', path.join(repo, 'dist/mcp/browser-runtime-tools.js'));
await add('controller/services/computer-use-service.js', path.join(repo, 'dist/services/computer-use-service.js'));
await add('host/bridge.mjs', path.join(repo, 'mac-host/bridge.mjs'));
for (const name of ['contracts.mjs', 'connection-pool.mjs', 'tab-registry.mjs', 'audit-ledger.mjs', 'runtime.mjs']) {
  await add('host/browser-runtime/' + name, path.join(repo, 'mac-host/browser-runtime', name));
}
async function collect(directory, prefix) {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw Error('RELEASE_SYMLINK_DENIED');
    if (/\.(?:ttf|otf|woff2?)$/i.test(entry.name)) continue; // Unused visual-tool assets are not part of the headless runtime distribution.
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), prefix + '/' + entry.name);
    else if (entry.isFile()) await add(prefix + '/' + entry.name, path.join(directory, entry.name));
  }
}
const packageInfo = JSON.parse(await fs.readFile(path.join(repo, 'node_modules/playwright-core/package.json'), 'utf8'));
if (packageInfo.version !== '1.64.0') throw Error('PLAYWRIGHT_VERSION_NOT_PINNED');
await collect(path.join(repo, 'node_modules/playwright-core'), 'host/node_modules/playwright-core');
await add('install.mjs', path.join(repo, 'scripts/install-browser-runtime-release.mjs'));
await add('README.md', path.join(repo, 'docs/computer-use-v2/OPERATIONS.md'));
await add('controller-dependencies/Dockerfile', path.join(repo, 'deploy/controller-dependencies.Dockerfile'));
await add('controller-dependencies/package.json', path.join(repo, 'package.json'));
await add('controller-dependencies/package-lock.json', path.join(repo, 'package-lock.json'));
const lock = JSON.parse(await fs.readFile(path.join(repo, 'package-lock.json'), 'utf8'));
const requirementNames = ['@modelcontextprotocol/sdk','express','@hono/node-server','fast-uri','hono','ip-address','proxy-addr','qs'];
const controllerDependencies = Object.fromEntries(requirementNames.map(name => {
  const item = lock.packages['node_modules/' + name];
  if (!item?.version) throw Error('MISSING_LOCKED_CONTROLLER_DEPENDENCY');
  return [name, item.version];
}));
const files = [];
for (const [name, bytes] of [...writes].sort(([a], [b]) => a.localeCompare(b))) {
  const destination = path.join(output, name);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
  files.push({ path: name, sha256: sha(bytes), bytes: bytes.length });
}
const manifest = { schema: 'cloud-sandbox.browser-runtime-release.v2', version: '2.0.0', source_commit: commit,
  source_dirty: dirty, playwright_core: packageInfo.version, baseline: baseline.files,
  expected_tool_count: 29, controller_dependencies: controllerDependencies, files,
  note: 'Hashes ensure integrity relative to this manifest, not publisher identity. Review/sign in the operator release pipeline.' };
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await fs.writeFile(path.join(output, 'manifest.json'), manifestBytes, { mode: 0o600, flag: 'wx' });
await fs.writeFile(path.join(output, 'manifest.sha256'), sha(manifestBytes) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ output, source_commit: commit, source_dirty: dirty, files: files.length,
  bytes: files.reduce((n, f) => n + f.bytes, 0), manifest_sha256: sha(manifestBytes) }, null, 2));
