import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const release = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || '--inspect';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const log = text => console.log('[Browser Runtime V2] ' + text);
const stop = code => { throw Error(code); };
const safePath = p => typeof p === 'string' && p.length > 0 && !path.isAbsolute(p) &&
  !p.includes('\\') && p.split('/').every(x => x && x !== '.' && x !== '..');
function command(executable, args, options = {}) {
  try { return execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 45000, maxBuffer: 8_000_000, ...options }).trim(); }
  catch (error) { stop(error?.code === 'ETIMEDOUT' ? 'OPERATOR_COMMAND_TIMEOUT' : 'OPERATOR_COMMAND_FAILED'); }
}
async function fileHash(file) {
  const st = await fs.lstat(file);
  if (!st.isFile() || st.isSymbolicLink()) stop('UNSAFE_FILE_TYPE');
  return sha(await fs.readFile(file));
}
async function safeParents(file) {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    try { const st = await fs.lstat(dir); if (st.isSymbolicLink()) stop('SYMLINK_PARENT_DENIED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function replace(file, bytes, modeBits = 0o600) {
  await safeParents(file);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.cuv2-' + process.pid + '.tmp';
  await fs.writeFile(tmp, bytes, { flag: 'wx', mode: modeBits });
  await fs.rename(tmp, file);
  await fs.chmod(file, modeBits);
}
function envValues(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}
let rollback;
let changed = false;
try {
  if (process.platform !== 'darwin') stop('MACOS_OPERATOR_ONLY');
  if (!['--inspect', '--install'].includes(mode)) stop('USE_INSPECT_OR_INSTALL');
  const manifestBytes = await fs.readFile(path.join(release, 'manifest.json'));
  if (sha(manifestBytes) !== (await fs.readFile(path.join(release, 'manifest.sha256'), 'utf8')).trim()) stop('RELEASE_MANIFEST_HASH_MISMATCH');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 'cloud-sandbox.browser-runtime-release.v2' || manifest.source_dirty) stop('UNREVIEWED_OR_DIRTY_RELEASE');
  if (manifest.expected_tool_count !== 29) stop('REGISTRY_CONTRACT_DOWNGRADE_DENIED');
  for (const file of manifest.files) {
    if (!safePath(file.path) || await fileHash(path.join(release, file.path)) !== file.sha256) stop('RELEASE_FILE_HASH_MISMATCH');
  }
  const containers = JSON.parse(command('docker', ['inspect', 'cloud-sandbox-mcp']));
  if (containers.length !== 1 || !containers[0].State?.Running) stop('MCP_NOT_RUNNING');
  const current = containers[0], labels = current.Config?.Labels || {};
  if (labels['com.docker.compose.service'] !== 'mcp') stop('WRONG_COMPOSE_SERVICE');
  const binding = current.Mounts?.find(m => m.Destination === '/app/dist' && m.Type === 'bind');
  if (!binding) stop('CUSTOM_CONTROLLER_MOUNT_MISSING');
  const controller = await fs.realpath(binding.Source);
  const working = await fs.realpath(labels['com.docker.compose.project.working_dir']);
  const configs = labels['com.docker.compose.project.config_files']?.split(',');
  if (!configs?.length) stop('COMPOSE_METADATA_MISSING');
  const compose = ['compose', '--project-directory', working, ...configs.flatMap(f => ['-f', f])];
  const effective = JSON.parse(command('docker', [...compose, 'config', '--format', 'json'], { cwd: working }));
  if (effective.name !== labels['com.docker.compose.project']) stop('COMPOSE_PROJECT_DRIFT');
  // A code overlay does not upgrade libraries already baked into the MCP image.
  // Do not ship new runtime code while silently retaining the known old dependency set.
  const expectedPackages = manifest.controller_dependencies;
  if (!expectedPackages || Object.keys(expectedPackages).length !== 8) stop('DEPENDENCY_REQUIREMENTS_MISSING');
  const dependenciesScript = `
const fs=require('node:fs');
const expected=${JSON.stringify(expectedPackages)};
const mismatch=[];
for(const [name,wanted] of Object.entries(expected)){
 if(!['@modelcontextprotocol/sdk','express','@hono/node-server','fast-uri','hono','ip-address','proxy-addr','qs'].includes(name))process.exit(2);
 let actual='missing';try{actual=JSON.parse(fs.readFileSync('/app/node_modules/'+name+'/package.json','utf8')).version;}catch{}
 if(actual!==wanted)mismatch.push({package:name,actual,required:wanted});
}
console.log(JSON.stringify({ready:mismatch.length===0,mismatch}));
`;
  const dependencyGate = JSON.parse(command('docker', ['exec', 'cloud-sandbox-mcp', 'node', '-e', dependenciesScript]));
  if (!dependencyGate.ready) {
    log('CONTROLLER_DEPENDENCY_UPGRADE_REQUIRED: code overlays cannot patch image libraries.');
    for (const item of dependencyGate.mismatch) log(item.package + ': installed=' + item.actual + ', tested=' + item.required);
  }
  const home = os.homedir();
  const host = path.join(home, 'Library', 'Application Support', 'LCH', 'CloudSandboxComputerUse');
  const plist = path.join(home, 'Library', 'LaunchAgents', 'com.lch.cloud-sandbox.computer-use.plist');
  const gui = 'gui/' + process.getuid();
  const label = gui + '/com.lch.cloud-sandbox.computer-use';
  const envFile = path.join(working, '.env');
  const originalEnv = await fs.readFile(envFile, 'utf8');
  const environment = envValues(originalEnv);
  if (environment.COMPUTER_USE_ENABLED !== 'true' || environment.COMPUTER_USE_DYNAMIC_TABS !== 'true') stop('EXISTING_DYNAMIC_AUTHORIZATION_REQUIRED');
  if (!environment.COMPUTER_USE_BRIDGE_TOKEN) stop('BRIDGE_CREDENTIAL_MISSING');
  async function hostStatus() {
    const endpoint = new URL(environment.COMPUTER_USE_BRIDGE_URL);
    if (endpoint.port !== '9764' || !['host.docker.internal', '127.0.0.1', 'localhost'].includes(endpoint.hostname)) stop('UNRECOGNIZED_EXISTING_BRIDGE');
    const response = await fetch('http://127.0.0.1:9764/v1/status', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
      headers: { authorization: 'Bearer ' + environment.COMPUTER_USE_BRIDGE_TOKEN, 'content-type': 'application/json' }, body: '{}'
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) stop('BRIDGE_HEALTH_FAILED');
    return payload.data;
  }
  const liveStatus = await hostStatus();
  if (liveStatus.delegated_session?.active) stop('ACTIVE_TASK_SESSION_DO_NOT_INTERRUPT');
  command('/bin/launchctl', ['print', label]);
  const baseFiles = {
    'server.js': path.join(controller, 'mcp/server.js'),
    'computer-use-service.js': path.join(controller, 'services/computer-use-service.js'),
    'bridge.mjs': path.join(host, 'bridge.mjs'),
    'autonomy-session.mjs': path.join(host, 'autonomy-session.mjs'),
    'native.jxa': path.join(host, 'native.jxa')
  };
  const deployFiles = manifest.files.filter(f => f.path.startsWith('controller/') || f.path.startsWith('host/'));
  const target = file => file.path.startsWith('controller/') ? path.join(controller, file.path.slice(11)) : path.join(host, file.path.slice(5));
  let installed = true;
  for (const file of deployFiles) {
    try { if (await fileHash(target(file)) !== file.sha256) installed = false; } catch { installed = false; }
  }
  if (installed) { log('ALREADY_INSTALLED; no changes made.'); process.exit(0); }
  for (const [name, file] of Object.entries(baseFiles)) {
    if (await fileHash(file) !== manifest.baseline[name]) stop('LIVE_CODE_DRIFT_REBASE_REQUIRED');
  }
  const mutableExisting = new Set([baseFiles['server.js'], baseFiles['computer-use-service.js'], baseFiles['bridge.mjs']]);
  for (const file of deployFiles) {
    await safeParents(target(file));
    try { await fs.lstat(target(file)); if (!mutableExisting.has(target(file))) stop('UNEXPECTED_EXISTING_RUNTIME_FILE'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const { providersFromEnvironment } = await import('./host/browser-runtime/runtime.mjs');
  const { validateEndpoint } = await import('./host/browser-runtime/connection-pool.mjs');
  const providers = providersFromEnvironment(environment);
  for (const config of Object.values(providers)) validateEndpoint(config.endpoint, config.protocol);
  log(dependencyGate.ready ? 'PREFLIGHT_PASS; 23 existing tools preserved, 6 additive browser tools.' : 'PREFLIGHT_HOLD: upgrade the existing controller dependency image before activation.');
  log('Configured persistent providers: ' + (Object.keys(providers).join(', ') || 'NONE; native fallback remains available.'));
  log('No browser launch, profile copying, port enabling, or domain registration will occur.');
  if (mode === '--inspect') process.exit(dependencyGate.ready ? 0 : 2);
  if (!dependencyGate.ready) stop('CONTROLLER_DEPENDENCY_UPGRADE_REQUIRED');

  // --install is the operator's one-time deployment authorization, not a UI task grant.
  const backup = path.join(home, 'Library', 'Application Support', 'LCH', 'CloudSandboxBackups', 'browser-v2-' + Date.now());
  await fs.mkdir(backup, { recursive: true, mode: 0o700 });
  const restore = [];
  for (const file of deployFiles) {
    const destination = target(file);
    if (mutableExisting.has(destination)) {
      const st = await fs.lstat(destination);
      const saved = path.join(backup, 'file-' + restore.length);
      await fs.writeFile(saved, await fs.readFile(destination), { mode: 0o600, flag: 'wx' });
      restore.push({ destination, saved, mode: st.mode & 0o777 });
    } else restore.push({ destination, saved: null, mode: 0o600 });
  }
  await fs.writeFile(path.join(backup, 'controller.env'), originalEnv, { mode: 0o600, flag: 'wx' });
  await fs.writeFile(path.join(backup, 'restore.json'), JSON.stringify({ source_commit: manifest.source_commit, restore }, null, 2), { mode: 0o600 });
  const recreate = () => command('docker', [...compose, 'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'mcp'], { cwd: working, timeout: 120000 });
  rollback = async () => {
    if (!changed) { log('NO_RUNTIME_CHANGES; active task was preserved.'); return; }
    for (const item of restore) {
      if (item.saved) await replace(item.destination, await fs.readFile(item.saved), item.mode);
      else await fs.rm(item.destination, { force: true });
    }
    await replace(envFile, Buffer.from(originalEnv));
    try { command('/bin/launchctl', ['bootout', gui, plist]); } catch { /* It may already be unloaded. */ }
    command('/bin/launchctl', ['bootstrap', gui, plist]);
    recreate();
    await hostStatus();
    log('ROLLBACK_VERIFIED; original bridge responded. Private backup: ' + backup);
  };
  if ((await hostStatus()).delegated_session?.active) stop('ACTIVE_TASK_SESSION_DO_NOT_INTERRUPT');
  changed = true;
  command('/bin/launchctl', ['bootout', gui, plist]);
  for (const file of deployFiles) {
    await replace(target(file), await fs.readFile(path.join(release, file.path)), file.path.startsWith('controller/') ? 0o644 : 0o600);
    if (await fileHash(target(file)) !== file.sha256) stop('INSTALLED_HASH_MISMATCH');
  }
  if ((originalEnv.match(/^COMPUTER_USE_BROWSER_V2=/gm) || []).length > 1) stop('DUPLICATE_RUNTIME_SETTING');
  const nextEnv = /^COMPUTER_USE_BROWSER_V2=/m.test(originalEnv)
    ? originalEnv.replace(/^COMPUTER_USE_BROWSER_V2=.*$/m, 'COMPUTER_USE_BROWSER_V2=true')
    : originalEnv + (originalEnv.endsWith('\n') ? '' : '\n') + 'COMPUTER_USE_BROWSER_V2=true\n';
  await replace(envFile, Buffer.from(nextEnv));
  command('/bin/launchctl', ['bootstrap', gui, plist]);
  let ready = false;
  for (let i = 0; i < 20; i++) { try { await hostStatus(); ready = true; break; } catch { await sleep(500); } }
  if (!ready) stop('NEW_BRIDGE_HEALTH_FAILED');
  recreate();
  const check = "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(2)}).catch(()=>process.exit(2))";
  ready = false;
  for (let i = 0; i < 30; i++) {
    try { command('docker', ['exec', 'cloud-sandbox-mcp', 'node', '-e', check], { timeout: 10000 }); ready = true; break; }
    catch { await sleep(700); }
  }
  if (!ready) stop('MCP_HEALTH_FAILED');
  const registryCheck = `
import {createMcpServer} from '/app/dist/mcp/server.js';
import {ComputerUseService} from '/app/dist/services/computer-use-service.js';
import {config} from '/app/dist/config.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const server=createMcpServer({},new ComputerUseService(config));
const client=new Client({name:'operator-v2-verifier',version:'1'},{capabilities:{}});
const [a,b]=InMemoryTransport.createLinkedPair();
try {
 await server.connect(b);await client.connect(a);
 const names=(await client.listTools()).tools.map(t=>t.name);
 if(names.length!==29 || !names.includes('project_register') ||
    !names.includes('browser_action') || !names.includes('browser_open')) process.exitCode=2;
 const r=await client.callTool({name:'browser_runtime_status',arguments:{}});
 if(r.isError || !JSON.parse(r.content[0].text).enabled) process.exitCode=3;
 if(!process.exitCode) console.log('REGISTRY_29_AND_BRIDGE_V2_PASS');
} finally {await client.close();await server.close();}
`;
  const verified = command('docker', ['exec', 'cloud-sandbox-mcp', 'node', '--input-type=module', '-e', registryCheck]);
  if (!verified.includes('REGISTRY_29_AND_BRIDGE_V2_PASS')) stop('LIVE_REGISTRY_VERIFICATION_FAILED');
  rollback = null;
  log('INSTALLED; only existing Mac bridge and MCP controller restarted. dev-main and user browsers were not restarted.');
  log('Refresh Cloud Sandbox MCP action discovery. Persistent provider readiness must be tested separately with browser_runtime_status and browser_tabs.');
  log('Private rollback backup: ' + backup);
} catch (error) {
  const code = /^[A-Z_]{3,80}$/.test(error?.message || '') ? error.message : 'DEPLOYMENT_FAILED_REVIEW_LOCAL_STATE';
  log('STOP: ' + code);
  if (rollback) {
    try { await rollback(); } catch { log('ROLLBACK_INCOMPLETE; preserve private backups and inspect services before continuing.'); }
  }
  process.exitCode = 2;
}
