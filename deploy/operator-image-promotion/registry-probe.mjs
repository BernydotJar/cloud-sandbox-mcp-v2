/* global console */
import fs from 'node:fs';
import {createMcpServer} from '/app/dist/mcp/server.js';
import {ComputerUseService} from '/app/dist/services/computer-use-service.js';
import {config} from '/app/dist/config.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const expected={
 '@modelcontextprotocol/sdk':'1.32.1',
 'express':'5.3.0',
 '@hono/node-server':'2.1.4',
 'fast-uri':'3.1.8',
 'hono':'4.13.13',
 'ip-address':'10.7.3',
 'proxy-addr':'2.0.8',
 'qs':'6.16.0'
};
for(const [name,version] of Object.entries(expected)){
 const actual=JSON.parse(fs.readFileSync('/app/node_modules/'+name+'/package.json','utf8')).version;
 if(actual!==version)throw Error('IMAGE_DEPENDENCY_MISMATCH');
}
const server=createMcpServer({},new ComputerUseService(config));
const client=new Client({name:'image-promotion-verifier',version:'1'},{capabilities:{}});
const [a,b]=InMemoryTransport.createLinkedPair();
try{
 await server.connect(b);await client.connect(a);
 const names=(await client.listTools()).tools.map(t=>t.name);
 const required=['project_register','workspace_exec','computer_use_action',
  'computer_use_session_begin','computer_use_session_end','computer_use_state'];
 if(names.length!==23 || !required.every(name=>names.includes(name)))
   throw Error('CUSTOMIZED_MCP_REGISTRY_MISMATCH');
 console.log('CONTROLLER_DEPENDENCIES_8_AND_MCP_REGISTRY_23_PASS');
}finally{await client.close();await server.close();}
