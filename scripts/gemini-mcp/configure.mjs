#!/usr/bin/env node
/* global fetch, AbortSignal */
/**
 * Configure Gemini CLI on the operator Mac as an independent MCP client
 * of the EXISTING local Sandbox V3 controller. No tokens or secret URLs
 * are persisted in Gemini settings; the stdio bridge reads .env at runtime.
 *
 * Default mode --check is read-only. --apply explicitly writes a backup
 * and updates only the sandbox-v3 entry in ~/.gemini/settings.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { allowedTools, controllerEnvPath, readEndpoint } from './bridge.mjs';

const self = fileURLToPath(import.meta.url);
const bridge = path.join(path.dirname(self), 'bridge.mjs');

function checkOwner(filename, {directory = false, optional = false} = {}) {
  if (!fs.existsSync(filename)) {
    if (optional) return false;
    throw new Error('Required local file/directory not found: ' + path.basename(filename));
  }
  const st = fs.lstatSync(filename);
  if (st.isSymbolicLink() || (directory && !st.isDirectory()) ||
      (!directory && !st.isFile()) ||
      (process.getuid && st.uid !== process.getuid())) {
    throw new Error('Unsafe owner or file type: ' + path.basename(filename));
  }
  return true;
}

export function buildServerConfig({envFile, profile = 'read', nodeBin = process.execPath,
  bridgeFile = bridge}) {
  return {
    command: nodeBin,
    args: [bridgeFile],
    env: {
      SANDBOX_V3_CONTROLLER_ENV: envFile,
      SANDBOX_V3_GEMINI_PROFILE: profile
    },
    timeout: 120000,
    trust: false,
    includeTools: [...allowedTools(profile)]
  };
}

export function modifySettings(oldSettings, {entry, remove = false,
  replace = false} = {}) {
  if (!oldSettings || Array.isArray(oldSettings) || typeof oldSettings !== 'object') {
    throw new Error('Gemini settings must be a JSON object');
  }
  const next = JSON.parse(JSON.stringify(oldSettings));
  const existing = next.mcpServers?.['sandbox-v3'];
  if (remove) {
    if (!existing) return {updated: next, changed: false};
    if (typeof existing !== 'object' ||
        !Array.isArray(existing.args) ||
        !existing.args.some(a => String(a).endsWith('/gemini-mcp/bridge.mjs'))) {
      throw new Error('Refusing to remove a differently managed sandbox-v3 entry');
    }
    delete next.mcpServers['sandbox-v3'];
    return {updated: next, changed: true};
  }
  if (existing && JSON.stringify(existing) === JSON.stringify(entry)) {
    return {updated: next, changed: false};
  }
  if (existing && !replace) {
    throw new Error('sandbox-v3 already exists: use --replace to back up and replace it');
  }
  if (!next.mcpServers) next.mcpServers = {};
  if (typeof next.mcpServers !== 'object' || Array.isArray(next.mcpServers)) {
    throw new Error('Gemini mcpServers must be an object');
  }
  next.mcpServers['sandbox-v3'] = entry;
  return {updated: next, changed: true};
}

export function writeGeminiSettings({settingsFile, entry, remove = false,
  replace = false} = {}) {
  const dir = path.dirname(settingsFile);
  checkOwner(path.dirname(dir), {directory: true});
  if (checkOwner(dir, {directory: true, optional: true}) === false) {
    fs.mkdirSync(dir, {mode: 0o700});
  }
  const existed = checkOwner(settingsFile, {optional: true});
  const original = existed ? fs.readFileSync(settingsFile, 'utf8') : null;
  const settings = original ? JSON.parse(original) : {};
  const {updated, changed} = modifySettings(settings, {entry, remove, replace});
  if (!changed) return {changed: false, backedUp: false};
  if (original !== null) {
    const backupPath = path.join(dir, '.sandbox-v3-gemini-backup-' + crypto.randomUUID() + '.json');
    fs.writeFileSync(backupPath, original, {mode: 0o600, flag: 'wx'});
  }
  const tempPath = path.join(dir, '.sandbox-v3-gemini-' + crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2) + '\n',
      {mode: 0o600, flag: 'wx'});
    fs.renameSync(tempPath, settingsFile);
    fs.chmodSync(settingsFile, 0o600);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
  return {changed: true, backedUp: original !== null};
}

export async function probeController(envFile) {
  const endpoint = readEndpoint(envFile);
  const health = new URL('/healthz', endpoint);
  const res = await fetch(health, {signal: AbortSignal.timeout(4000)});
  if (!res.ok) throw new Error('Sandbox V3 local /healthz failed');
  const obj = await res.json();
  if (obj.status !== 'ok' || obj.service !== 'cloud-sandbox-mcp') {
    throw new Error('Unexpected service on local controller port');
  }
  return true;
}

function usage() {
  console.log('Usage: node scripts/gemini-mcp/configure.mjs [--check|--apply|--remove] ' +
    '[--profile read|developer] [--env-file /path/to/.env] [--replace]');
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { usage(); return; }
  const modes = ['--check', '--apply', '--remove'].filter(m => args.includes(m));
  if (modes.length > 1) throw new Error('Select one operation');
  const mode = modes[0] || '--check';
  const findValue = key => {
    const idx = args.indexOf(key);
    if (idx < 0) return undefined;
    if (!args[idx + 1] || args[idx + 1].startsWith('--')) {
      throw new Error('Missing value for ' + key);
    }
    return args[idx + 1];
  };
  const profile = findValue('--profile') || 'read';
  allowedTools(profile);
  const envFile = path.resolve(findValue('--env-file') || controllerEnvPath());
  const replace = args.includes('--replace');
  const entry = buildServerConfig({envFile, profile});
  const settingsFile = path.join(os.homedir(), '.gemini', 'settings.json');
  if (mode === '--check' || mode === '--apply') {
    // The install action is intentional and only executes on the operator Mac.
    if (process.platform !== 'darwin') {
      throw new Error('Run the Gemini client setup on the operator Mac, not the Linux workstation');
    }
    await probeController(envFile);
    console.log('[Sandbox V3 Gemini] Existing local MCP controller verified');
  }
  if (mode === '--check') {
    console.log('[Sandbox V3 Gemini] Read-only check PASS; profile=' + profile +
      '; configuration unchanged');
    return;
  }
  if (process.platform !== 'darwin') {
    throw new Error('Gemini CLI configuration must be performed on the operator Mac');
  }
  const result = writeGeminiSettings({
    settingsFile, entry, replace, remove: mode === '--remove'
  });
  console.log('[Sandbox V3 Gemini] ' + (result.changed ? 'Configuration updated' : 'No change') +
    '; previous config backed up=' + result.backedUp + '; profile=' + profile);
  console.log('[Sandbox V3 Gemini] Gemini settings contain no controller secret or URL');
}

const invokedAsScript = process.argv[1] &&
  path.resolve(process.argv[1]) === self;
if (invokedAsScript) {
  cli().catch(error => {
    // Errors reference local file names, never print endpoint or secret.
    process.stderr.write('[Sandbox V3 Gemini] ' + error.message + '\n');
    process.exitCode = 1;
  });
}
