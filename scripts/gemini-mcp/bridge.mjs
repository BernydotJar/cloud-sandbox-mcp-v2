#!/usr/bin/env node
/**
 * Dedicated Gemini CLI stdio MCP adapter for the existing Sandbox V3 controller.
 * It DOES NOT start a second backend. It reads the existing Mac controller .env
 * at runtime and forwards only an explicit set of tools to local Streamable HTTP.
 *
 * All logs must go to stderr: stdout is reserved for the stdio MCP protocol.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseEnv } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const READ_TOOLS = Object.freeze([
  'workspace_list', 'workspace_status', 'file_read', 'git_diff', 'workspace_history'
]);

export const DEVELOPER_TOOLS = Object.freeze([
  ...READ_TOOLS,
  'workspace_exec', 'file_write', 'file_apply_patch',
  'project_verify', 'git_commit'
]);

export function allowedTools(profile) {
  if (profile === 'read') return new Set(READ_TOOLS);
  if (profile === 'developer') return new Set(DEVELOPER_TOOLS);
  throw new Error('Invalid profile: expected read or developer');
}

export function controllerEnvPath() {
  return path.resolve(process.env.SANDBOX_V3_CONTROLLER_ENV ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'));
}

export function readEndpoint(envPath = controllerEnvPath()) {
  // Never accept symlinked, shared or non-owner credential files.
  const st = fs.lstatSync(envPath);
  if (!st.isFile() || st.isSymbolicLink() ||
      (process.getuid && st.uid !== process.getuid()) ||
      (st.mode & 0o077) !== 0) {
    throw new Error('Controller .env must be an owner-only regular file (chmod 600)');
  }
  const vars = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const secret = vars.MCP_PATH_SECRET || '';
  if (secret.length < 16 ||
      ['development-secret-change-me', 'replace-with-a-long-random-value'].includes(secret)) {
    throw new Error('Controller MCP_PATH_SECRET is missing or insecure');
  }
  const port = Number(vars.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid local controller PORT');
  }
  return new URL('http://127.0.0.1:' + port + '/mcp/' + encodeURIComponent(secret));
}

export async function runProxy({url = readEndpoint(),
  profile = process.env.SANDBOX_V3_GEMINI_PROFILE || 'read'} = {}) {
  const allowed = allowedTools(profile);
  const upstream = new Client(
    {name: 'gemini-sandbox-v3-bridge', version: '1.0.0'}, {capabilities: {}}
  );
  const upstreamTransport = new StreamableHTTPClientTransport(url);
  await upstream.connect(upstreamTransport);
  const advertised = await upstream.listTools();
  const known = new Set(advertised.tools.map(t => t.name));
  if (!known.has('workspace_list') || !known.has('workspace_status')) {
    await upstream.close();
    throw new Error('Connected MCP endpoint is not the expected Sandbox V3 controller');
  }

  const local = new Server(
    {name: 'sandbox-v3-gemini', version: '1.0.0'},
    {capabilities: {tools: {}}}
  );
  local.setRequestHandler(ListToolsRequestSchema, async () => {
    const discovered = await upstream.listTools();
    return {tools: discovered.tools.filter(tool => allowed.has(tool.name))};
  });
  local.setRequestHandler(CallToolRequestSchema, async request => {
    if (!allowed.has(request.params.name)) {
      return {isError: true,
        content: [{type: 'text', text: 'Tool blocked by Sandbox V3 Gemini bridge policy'}]};
    }
    return upstream.callTool({
      name: request.params.name,
      arguments: request.params.arguments || {}
    });
  });
  const stdio = new StdioServerTransport();
  await local.connect(stdio);
  const shutdown = () => {
    void Promise.allSettled([local.close(), upstream.close()]);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return {local, upstream};
}

const invokedAsScript = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  runProxy().catch(() => {
    // Do not leak a URL, secret or credential value to CLI output.
    process.stderr.write(
      '[Sandbox V3 Gemini] Connection failed. Check local controller, ' +
      'owner-only .env, Node dependencies and profile.\n'
    );
    process.exitCode = 1;
  });
}
