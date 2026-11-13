import {afterEach,describe,expect,it,vi} from 'vitest';
import {BackgroundMacService} from '../src/services/background-mac-service.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp/server.js';
import type {WorkspaceService} from '../src/services/workspace-service.js';

const operator='1'.repeat(64),guest='2'.repeat(64),token='x'.repeat(48);
const config={enabled:true,url:'http://127.0.0.1:9777',token,
  operatorMachineDigest:operator};
function response(data:unknown,ok=true){
  return new Response(JSON.stringify({ok,data}),{status:ok?200:409,
    headers:{'content-type':'application/json'}});
}
afterEach(()=>vi.unstubAllGlobals());
describe('separate macOS background Computer Use worker',()=>{
  it('is disabled until the guest worker is configured',async()=>{
    const service=new BackgroundMacService({...config,enabled:false});
    await expect(service.status()).resolves.toMatchObject({
      connected:false,ready:false,reason:'BACKGROUND_MAC_WORKER_NOT_CONFIGURED'});
  });
  it('rejects an endpoint that is the operator Mac or lacks GUI/AX readiness',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response({
      worker_machine:operator,operator_machine_distinct:true,
      background_mode:'separate_macos_machine',gui_session:true,
      ax_permission:true,ready:true})));
    const service=new BackgroundMacService(config);
    await expect(service.status()).resolves.toMatchObject({
      connected:false,reason:'BACKGROUND_MAC_WORKER_NOT_ISOLATED'});
    await expect(service.snapshot({bundle_id:'com.lch.SandboxAXFixture',
      window_title:'Sandbox AX Fixture'})).rejects.toThrow('BACKGROUND_MAC_WORKER_NOT_ISOLATED');
  });
  it('blocks native actions unless guest GUI and AX permissions are actually ready',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response({
      worker_machine:guest,operator_machine_distinct:true,
      background_mode:'separate_macos_machine',gui_session:false,
      ax_permission:false,ready:false})));
    const service=new BackgroundMacService(config);
    await expect(service.status()).resolves.toMatchObject({connected:true,ready:false});
    await expect(service.action({
      bundle_id:'com.lch.SandboxAXFixture',window_title:'Sandbox AX Fixture',
      action:'press',request_id:'3'.repeat(64),node_ref:'4'.repeat(64),
      expected_revision:'5'.repeat(64),reason:'Press the fixture apply button'
    })).rejects.toThrow('BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED');
  });
  it('routes semantic requests to an attested guest without physical host input',async()=>{
    const fetchMock=vi.fn(async(url:string,init:{body:string})=>{
      const path=new URL(String(url)).pathname;
      if(path==='/v1/status')return response({
        worker_machine:guest,operator_machine_distinct:true,
        background_mode:'separate_macos_machine',gui_session:true,
        ax_permission:true,ready:true});
      if(path==='/v1/snapshot')return response({provider:'isolated_mac_ax',
        revision:'a'.repeat(64),nodes:[]});
      if(path==='/v1/action'){
        const input=JSON.parse(init.body);
        expect(input.action).toBe('press');
        expect(input.value).toBeUndefined();
        return response({dispatched:true,receipt:input.request_id,
          business_effect:'UNVERIFIED_REQUIRE_READBACK'});
      }
      return response({});
    });
    vi.stubGlobal('fetch',fetchMock);
    const service=new BackgroundMacService(config);
    const t={bundle_id:'com.lch.SandboxAXFixture',window_title:'Sandbox AX Fixture'};
    await expect(service.snapshot(t)).resolves.toMatchObject({provider:'isolated_mac_ax'});
    await expect(service.action({...t,action:'press',node_ref:'b'.repeat(64),
      expected_revision:'a'.repeat(64),request_id:'3'.repeat(64),
      reason:'Press an AX verified disposable fixture button'
    })).resolves.toMatchObject({dispatched:true});
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('registers exactly separate-Mac tools without changing browser CUA contracts',async()=>{
    const backend={status:async()=>({connected:false,ready:false}),
      snapshot:async()=>({provider:'isolated_mac_ax',nodes:[]}),
      action:async()=>({dispatched:false})} as unknown as BackgroundMacService;
    const server=createMcpServer({} as WorkspaceService,undefined,backend);
    const client=new Client({name:'background-mac-test',version:'1'},{capabilities:{}});
    const [a,b]=InMemoryTransport.createLinkedPair();
    try{
      await server.connect(b);await client.connect(a);
      const tools=(await client.listTools()).tools;
      for(const name of ['mac_background_cua_status','mac_background_cua_snapshot',
        'mac_background_cua_action','mac_background_cua_screenshot'])expect(tools.map(x=>x.name)).toContain(name);
      const action=tools.find(t=>t.name==='mac_background_cua_action');
      expect(action?.inputSchema?.required).toContain('node_ref');
      expect(action?.inputSchema?.required).toContain('expected_revision');
      const result=await client.callTool({
        name:'mac_background_cua_status',arguments:{}});
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(String(result.content[0]?.type==='text' ? result.content[0].text : '{}'))).toMatchObject({ready:false});
    }finally{await client.close();await server.close();}
  });
});
