import {describe,it,expect} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp/server.js';
import {ComputerUseService} from '../src/services/computer-use-service.js';
import type {WorkspaceService} from '../src/services/workspace-service.js';

describe('Cloud Sandbox native MCP tool registry',()=>{
  it('advertises first-party computer_use tools with a safe disabled status', async ()=>{
    // Tool registration is independent from the live Mac GUI and requires no host permissions.
    const computer = new ComputerUseService({
      COMPUTER_USE_ENABLED:false, COMPUTER_USE_BRIDGE_URL:'http://host.docker.internal:9764',
      COMPUTER_USE_BRIDGE_TOKEN:undefined
    });
    const server = createMcpServer({} as WorkspaceService,computer);
    const client = new Client({name:'integration-test',version:'0.0.0'},{capabilities:{}});
    const [clientTransport,serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools.map(t=>t.name);
      for (const expected of ['computer_use_status','computer_use_state','computer_use_focus',
        'computer_use_screenshot','computer_use_action']) {
        expect(tools).toContain(expected);
      }
      const status = await client.callTool({name:'computer_use_status',arguments:{}});
      expect(status.isError).not.toBe(true);
      expect(JSON.parse(String(status.content[0]?.type === 'text' ? status.content[0].text : '{}')))
        .toMatchObject({enabled:false,connected:false});
    } finally {
      await client.close();
      await server.close();
    }
  });
});
