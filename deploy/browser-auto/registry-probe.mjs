import process from 'node:process';
import {createMcpServer} from '/app/dist/mcp/server.js';
import {ComputerUseService} from '/app/dist/services/computer-use-service.js';
import {config} from '/app/dist/config.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const EXPECTED=Number('EXPECTED_TOOL_COUNT');
const server=createMcpServer({},new ComputerUseService(config));
const client=new Client({name:'browser-auto-release-check',version:'1'},{capabilities:{}});
const [a,b]=InMemoryTransport.createLinkedPair();
try{
  await server.connect(b);
  await client.connect(a);
  const names=(await client.listTools()).tools.map(tool=>tool.name);
  if(names.length!==EXPECTED || !names.includes('project_register') ||
    !names.includes('browser_tabs') || !names.includes('browser_action') ||
    (EXPECTED===29 && !names.includes('browser_open')) ||
    (EXPECTED===28 && names.includes('browser_open'))){
    throw Error('CUSTOM_MCP_REGISTRY_DRIFT');
  }
  process.stdout.write('EXPECTED_MCP_REGISTRY_PASS\n');
}finally{
  await client.close();
  await server.close();
}
