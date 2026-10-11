import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import type { WorkspaceService } from '../src/services/workspace-service.js';
import type { ComputerUseService } from '../src/services/computer-use-service.js';

async function clientFixture() {
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const computer = {
    browserRuntime: async (operation: string, input: Record<string, unknown>) => {
      calls.push({ operation, input });
      if (operation === 'status') return { enabled: false, native_fallback: 'explicit_only' };
      if (operation === 'screenshot') return { mime_type: 'text/html', base64: 'unsafe' };
      return { outcome: 'dispatched', request_id: input.request_id };
    }
  } as unknown as ComputerUseService;
  const server = createMcpServer({} as WorkspaceService, computer);
  const client = new Client({ name: 'browser-runtime-registry-tests', version: '1' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  return { client, calls, close: async () => { await client.close(); await server.close(); } };
}
describe('persistent browser MCP surface', () => {
  it('adds semantic tools without removing legacy Computer Use and session tools', async () => {
    const f = await clientFixture();
    try {
      const names = new Set((await f.client.listTools()).tools.map(t => t.name));
      for (const name of ['browser_runtime_status', 'browser_tabs', 'browser_open', 'browser_inspect', 'browser_screenshot', 'browser_action',
        'computer_use_state', 'computer_use_action', 'computer_use_session_begin', 'computer_use_session_end', 'workspace_exec']) expect(names.has(name)).toBe(true);
    } finally { await f.close(); }
  });
  it('disabled provider returns explicit capability status, not fake readiness', async () => {
    const f = await clientFixture();
    try {
      const result = await f.client.callTool({ name: 'browser_runtime_status', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain('explicit_only');
      expect(f.calls[0]?.operation).toBe('status');
    } finally { await f.close(); }
  });
  it('malformed locators and missing task capabilities never reach the host', async () => {
    const f = await clientFixture();
    try {
      const base = { browser: 'chrome', tab_ref: 'tab_' + 'a'.repeat(32), expected_revision: 1,
        request_id: 'mcp-browser-test-0001', action: 'click', locator: { by: 'role', role: 'button', name: 'Start' } };
      for (const args of [base, { ...base, session_id: 'b'.repeat(48), locator: { by: 'css', name: '*', evaluate: 'evil()' } }]) {
        const result = await f.client.callTool({ name: 'browser_action', arguments: args });
        expect(result.isError).toBe(true);
      }
      expect(f.calls.length).toBe(0);
    } finally { await f.close(); }
  });
  it('delegated action preserves session, request identity and revision', async () => {
    const f = await clientFixture();
    try {
      const args = { browser: 'chrome', tab_ref: 'tab_' + 'a'.repeat(32), expected_revision: 5,
        session_id: 'b'.repeat(48), request_id: 'mcp-browser-test-0001', action: 'click',
        locator: { by: 'role', role: 'button', name: 'Start' } };
      const result = await f.client.callTool({ name: 'browser_action', arguments: args });
      expect(result.isError).not.toBe(true);
      expect(f.calls).toEqual([{ operation: 'action', input: args }]);
    } finally { await f.close(); }
  });
  it('browser_open is explicit and only permits fixed Chrome/Edge choices', async () => {
    const f = await clientFixture();
    try {
      const opened = await f.client.callTool({name:'browser_open',arguments:{
        browser:'chrome', reason:'Use the existing Chrome app for UI testing'
      }});
      expect(opened.isError).not.toBe(true);
      expect(f.calls).toEqual([{operation:'open', input:{
        browser:'chrome',reason:'Use the existing Chrome app for UI testing'
      }}]);
      const invalid = await f.client.callTool({name:'browser_open',arguments:{
        browser:'safari', reason:'Attempt to launch another arbitrary application'
      }});
      expect(invalid.isError).toBe(true);
      expect(f.calls).toHaveLength(1);
    }finally{await f.close();}
  });

  it('non-PNG screenshot data is never returned as an MCP image', async () => {
    const f = await clientFixture();
    try {
      const result = await f.client.callTool({ name: 'browser_screenshot', arguments: { browser: 'chrome', tab_ref: 'tab_' + 'a'.repeat(32) } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('INVALID_RUNTIME_SCREENSHOT');
    } finally { await f.close(); }
  });
});
