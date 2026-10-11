import {createMcpServer} from '/app/dist/mcp/server.js';
import {ComputerUseService} from '/app/dist/services/computer-use-service.js';
import {config} from '/app/dist/config.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const server=createMcpServer({},new ComputerUseService(config));
const client=new Client({name:'image-rollback-verifier',version:'1'},{capabilities:{}});
const [a,b]=InMemoryTransport.createLinkedPair();
try {
 await server.connect(b);
 await client.connect(a);
 const names=(await client.listTools()).tools.map(t=>t.name);
 if(names.length!==23||!names.includes('project_register')||
    !names.includes('computer_use_session_begin'))throw Error('ORIGINAL_TOOL_REGISTRY_MISMATCH');
 console.log('BASE_IMAGE_MCP_REGISTRY_23_PASS');
}finally{await client.close();await server.close();}
