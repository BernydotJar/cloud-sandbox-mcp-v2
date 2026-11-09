import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const bridgePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bridge.mjs');

test('Gemini-compatible stdio MCP client can independently control the HTTP mock', {
  timeout: 20000
}, async () => {
  const secret = 'test-only-secret-for-local-mcp-0123456789';
  const app = express();
  app.use(express.json());
  const invocations = [];
  app.get('/healthz', (_req, res) =>
    res.json({status: 'ok', service: 'cloud-sandbox-mcp'}));
  app.post('/mcp/' + secret, async (req,res) => {
    const server = new McpServer({name: 'cloud-sandbox-mcp', version: '0.2.0'});
    for (const name of ['workspace_list', 'workspace_status', 'workspace_exec',
      'git_push', 'workspace_destroy']) {
      server.registerTool(name, {description: 'mock only', inputSchema: {}}, async () => {
        invocations.push(name);
        return {content: [{type: 'text', text: 'mock-' + name}]};
      });
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    res.on('close', () => {void transport.close(); void server.close();});
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const listener = await new Promise(resolve => {
    const http = app.listen(0, '127.0.0.1', () => resolve(http));
  });
  const port = listener.address().port;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-stdio-integration-'));
  const envFile = path.join(temp, '.env');
  fs.writeFileSync(envFile, 'PORT=' + port + '\nMCP_PATH_SECRET=' + secret + '\n',
    {mode: 0o600});
  const geminiLikeClient = new Client(
    {name: 'simulated-gemini-cli', version: '1.0.0'}, {capabilities: {}}
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bridgePath],
    env: {...process.env, SANDBOX_V3_CONTROLLER_ENV: envFile,
      SANDBOX_V3_GEMINI_PROFILE: 'developer'}
  });
  try {
    await geminiLikeClient.connect(transport);
    const {tools} = await geminiLikeClient.listTools();
    const names = tools.map(t=>t.name);
    assert(names.includes('workspace_list'));
    assert(names.includes('workspace_exec'));
    assert(!names.includes('git_push'));
    assert(!names.includes('workspace_destroy'));
    const list = await geminiLikeClient.callTool({
      name: 'workspace_list', arguments: {}
    });
    assert.equal(list.content[0].text, 'mock-workspace_list');
    const execResult = await geminiLikeClient.callTool({
      name: 'workspace_exec', arguments: {}
    });
    assert.equal(execResult.content[0].text, 'mock-workspace_exec');
    const denied = await geminiLikeClient.callTool({
      name: 'git_push', arguments: {}
    });
    assert.equal(denied.isError, true);
    assert.deepEqual(invocations, ['workspace_list', 'workspace_exec']);
  } finally {
    await geminiLikeClient.close().catch(() => {});
    await new Promise(resolve => listener.close(resolve));
    fs.rmSync(temp, {recursive:true,force:true});
  }
});
