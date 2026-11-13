/**
 * Activate persistent Chrome channel on current native-first Mac bridge.
 * Retains the modern connection pool and all existing browser profiles.
 * Run on Mac only. No controller reinstall or browser relaunch.
 */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2] || '--inspect';
const expectedAdapter = '51c2c475d44aaa53ef8f86d968c3ea2ff2453c51981d7450e9c9bf1c1ebb990c';
const log = value => process.stdout.write('[Chrome CDP safe activation] ' + value + '\n');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readStrict(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('UNSAFE_FILE: ' + path.basename(file));
  return { contents:fs.readFileSync(file,'utf8'), permissions:stat.mode & 0o777 };
}
function run(command,args) { return execFileSync(command,args,{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}).trim(); }
function replaceAtomic(file,contents,mode) {
  const tmp = file + '.chrome-cdp-' + process.pid + '.tmp';
  fs.writeFileSync(tmp,contents,{flag:'wx',mode});
  try { fs.renameSync(tmp,file); fs.chmodSync(file,mode); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function main() {
  if (process.platform !== 'darwin') throw Error('MACOS_ONLY');
  if (!['--inspect','--activate'].includes(mode)) throw Error('INVALID_MODE');
  const host = path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse');
  const adapter = readStrict(path.join(host,'browser-runtime/connection-pool.mjs'));
  if (hash(adapter.contents) !== expectedAdapter) throw Error('UNKNOWN_LIVE_ADAPTER_VERSION');
  const bridge = readStrict(path.join(host,'bridge.mjs')).contents;
  if (!bridge.includes('COMPUTER_USE_BROWSER_ROUTING') || !bridge.includes('prefer_persistent')) throw Error('UNSUPPORTED_BRIDGE_ROUTING');
  const containers = JSON.parse(run('docker',['inspect','cloud-sandbox-mcp']));
  const container=containers[0];
  if (!container?.State?.Running || container.Config?.Labels?.['com.docker.compose.service']!=='mcp') throw Error('MCP_CONTROLLER_NOT_RUNNING');
  const directory=container.Config.Labels['com.docker.compose.project.working_dir'];
  if (!directory) throw Error('NO_COMPOSE_DIRECTORY');
  const envFile=path.join(fs.realpathSync(directory),'.env');
  const env=readStrict(envFile);
  if ((env.permissions & 0o077)!==0) throw Error('ENV_PERMISSIONS_TOO_OPEN');
  const lines=env.contents.split(/\r?\n/);
  const indices=lines.flatMap((line,i)=>line.startsWith('COMPUTER_USE_BROWSER_ROUTING=')?[i]:[]);
  if (indices.length>1) throw Error('DUPLICATE_ROUTING_CONFIGURATION');
  const current=indices.length ? lines[indices[0]].split('=').slice(1).join('=') : 'native_first';
  if (!['native_first','prefer_persistent'].includes(current)) throw Error('CUSTOM_ROUTING_CONFIGURATION');
  const marker=path.join(os.homedir(),'Library/Application Support/Google/Chrome/DevToolsActivePort');
  const markerReady=fs.existsSync(marker);
  log('LIVE_ADAPTER_RECOGNIZED=PASS');
  log('ROUTING=' + current);
  log('CHROME_DEBUG_MARKER='+(markerReady?'PRESENT':'NOT_PRESENT'));
  if (!markerReady) {
    log('Enable remote debugging from chrome://inspect/#remote-debugging in the existing Chrome browser.');
    if (mode==='--activate') throw Error('CHROME_DEBUGGING_CONSENT_REQUIRED');
  }
  if (mode==='--inspect') return;
  if (current==='prefer_persistent') { log('ALREADY_ENABLED'); return; }
  if (!markerReady) throw Error('DEBUG_MARKER_REQUIRED');
  const markerStat=fs.lstatSync(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size>256) throw Error('INVALID_DEBUG_MARKER');
  const port=Number(fs.readFileSync(marker,'utf8').split(/\r?\n/,1)[0]);
  if (!Number.isInteger(port)||port<1024||port>65535) throw Error('INVALID_DEBUG_MARKER');
  // Preserve all other environment keys and avoid touching any bridge code.
  if (indices.length) lines[indices[0]]='COMPUTER_USE_BROWSER_ROUTING=prefer_persistent';
  else { if (lines.at(-1)==='') lines.pop(); lines.push('COMPUTER_USE_BROWSER_ROUTING=prefer_persistent',''); }
  const next=lines.join(env.contents.includes('\r\n')?'\r\n':'\n');
  const backup=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxBackups','chrome-cdp-route-'+Date.now());
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(backup,'controller.env'),env.contents,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(backup,'sha256.txt'),hash(env.contents)+'\n',{mode:0o600,flag:'wx'});
  const launchAgent='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
  run('/bin/launchctl',['print',launchAgent]);
  replaceAtomic(envFile,next,env.permissions);
  try { run('/bin/launchctl',['kickstart','-k',launchAgent]); }
  catch {
    replaceAtomic(envFile,env.contents,env.permissions);
    run('/bin/launchctl',['kickstart','-k',launchAgent]);
    throw Error('BRIDGE_RESTART_FAILED_CONFIG_ROLLED_BACK');
  }
  log('ROUTING_ACTIVATED=PASS');
  log('BACKUP=' + backup);
  log('NEXT=Verify browser_tabs(chrome) returns provider=persistent; do not claim success until verified.');
}
try { main(); } catch(e) { log('STOP: '+String(e.message||e).slice(0,180)); process.exitCode=2; }
