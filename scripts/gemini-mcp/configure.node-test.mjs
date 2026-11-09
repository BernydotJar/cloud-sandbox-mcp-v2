import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allowedTools, readEndpoint } from './bridge.mjs';
import { buildServerConfig, modifySettings, writeGeminiSettings } from './configure.mjs';

test('read profile is least-privilege; developer profile excludes destructive tools', () => {
  const read = allowedTools('read');
  const dev = allowedTools('developer');
  assert(read.has('workspace_list'));
  assert(!read.has('workspace_exec'));
  assert(dev.has('workspace_exec'));
  assert(dev.has('git_commit'));
  for (const dangerous of ['git_push', 'workspace_destroy',
    'workspace_recreate_runtime', 'computer_use_action', 'computer_use_session_begin']) {
    assert(!read.has(dangerous));
    assert(!dev.has(dangerous));
  }
  assert.throws(() => allowedTools('all'));
});

test('bridge reads owner-only controller secret without embedding it in Gemini config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-gemini-env-'));
  try {
    const envFile = path.join(dir, '.env');
    const secret = 'example-secret-0123456789abcdef';
    fs.writeFileSync(envFile, 'PORT=3011\nMCP_PATH_SECRET=' + secret + '\n',
      {mode: 0o600});
    const endpoint = readEndpoint(envFile);
    assert.equal(endpoint.hostname, '127.0.0.1');
    assert.equal(endpoint.port, '3011');
    assert(endpoint.pathname.endsWith(secret));
    const entry = buildServerConfig({envFile, profile: 'developer',
      nodeBin: '/usr/local/bin/node', bridgeFile: '/opt/bridge.mjs'});
    assert(!JSON.stringify(entry).includes(secret));
    assert.equal(entry.trust, false);
    assert.equal(entry.env.SANDBOX_V3_CONTROLLER_ENV, envFile);
    fs.chmodSync(envFile, 0o644);
    assert.throws(() => readEndpoint(envFile), /owner-only/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('configuration merge preserves unrelated Gemini servers and user settings', () => {
  const old = {theme: 'system', mcpServers: {github: {command: 'github'}}};
  const entry = buildServerConfig({
    envFile: '/private/.env', profile: 'read',
    nodeBin: '/usr/local/bin/node', bridgeFile: '/opt/gemini-mcp/bridge.mjs'
  });
  const result = modifySettings(old, {entry});
  assert.equal(result.changed, true);
  assert.equal(result.updated.theme, 'system');
  assert.deepEqual(result.updated.mcpServers.github, {command: 'github'});
  assert.equal(result.updated.mcpServers['sandbox-v3'].trust, false);
  assert(!old.mcpServers['sandbox-v3']);
  assert.equal(modifySettings(result.updated, {entry}).changed, false);
  assert.throws(() => modifySettings(result.updated, {entry: {command: 'other'}}),
    /--replace/);
  const rm = modifySettings(result.updated, {remove: true});
  assert(!rm.updated.mcpServers['sandbox-v3']);
  assert(rm.updated.mcpServers.github);
});

test('user settings update backs up and stays private; remove is reversible', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-gemini-settings-'));
  try {
    const dir = path.join(temp, '.gemini');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({mcpServers: {other: {command: 'node'}}}),
      {mode: 0o600});
    const entry = buildServerConfig({envFile: '/private/.env', profile: 'read',
      nodeBin: '/usr/local/bin/node', bridgeFile: '/opt/gemini-mcp/bridge.mjs'});
    assert.equal(writeGeminiSettings({settingsFile: file, entry}).changed, true);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(writeGeminiSettings({settingsFile: file, entry}).changed, false);
    assert.equal(writeGeminiSettings({settingsFile: file, remove: true}).changed, true);
    const updated = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(updated.mcpServers.other);
    assert(!updated.mcpServers['sandbox-v3']);
    const backups = fs.readdirSync(dir).filter(n => n.includes('backup'));
    assert(backups.length >= 2);
    for (const fileName of backups) {
      assert.equal(fs.statSync(path.join(dir,fileName)).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});
