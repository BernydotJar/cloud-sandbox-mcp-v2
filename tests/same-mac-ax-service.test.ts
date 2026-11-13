import {afterEach,describe,expect,it,vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp/server.js';
import {SameMacAXService} from '../src/services/same-mac-ax-service.js';
import type {WorkspaceService} from '../src/services/workspace-service.js';

const machine='a'.repeat(64);
const cfg={enabled:true,url:'http://127.0.0.1:9779',
  token:'x'.repeat(48),machineDigest:machine};
function response(data:unknown){
  return new Response(JSON.stringify({ok:true,data}),{
    status:200,headers:{'content-type':'application/json'}});
}
afterEach(()=>vi.unstubAllGlobals());
describe('native same-Mac background AX (no VM or foreground events)',()=>{
 it('returns not installed rather than requesting a new Mac',async()=>{
   const service=new SameMacAXService({...cfg,enabled:false});
   await expect(service.status()).resolves.toMatchObject({
     ready:false,reason:'SAME_MAC_BACKGROUND_AX_NOT_INSTALLED'});
 });
 it('requires exact operator Mac identity and non-activating AX capability',async()=>{
   vi.stubGlobal('fetch',vi.fn(async()=>response({
     provider:'same_mac_background_ax',mac_machine_digest:machine,
     same_machine_verified:true,ready:true,gui_session:true,
     ax_permission:true,no_global_keystrokes:true,no_pointer_events:true,
     no_activate_calls:true,not_isolated_session:true
   })));
   const service=new SameMacAXService(cfg);
   await expect(service.status()).resolves.toMatchObject({
     ready:true,provider:'same_mac_background_ax',no_global_input:true});
 });
 it('rejects spurious off-machine provider and focus-taking route',async()=>{
   vi.stubGlobal('fetch',vi.fn(async()=>response({
     provider:'same_mac_background_ax',mac_machine_digest:'b'.repeat(64),
     same_machine_verified:true,ready:true,gui_session:true,
     ax_permission:true,no_global_keystrokes:true,no_pointer_events:true,
     no_activate_calls:true,not_isolated_session:true
   })));
   const service=new SameMacAXService(cfg);
   await expect(service.status()).resolves.toMatchObject({
     ready:false,reason:'SAME_MAC_AX_HOST_MISMATCH'});
   await expect(service.snapshot({bundle_id:'com.lch.SameMacAXFixture',
     window_title:'Same Mac AX Fixture'})).rejects.toThrow('SAME_MAC_AX_HOST_MISMATCH');
 });
 it('routes semantic snapshot and one action without OS input events',async()=>{
   const fetcher=vi.fn(async(url:string,init:{body:string})=>{
     const route=new URL(String(url)).pathname;
     if(route==='/v1/status')return response({
       provider:'same_mac_background_ax',mac_machine_digest:machine,
       same_machine_verified:true,ready:true,gui_session:true,
       ax_permission:true,no_global_keystrokes:true,no_pointer_events:true,
       no_activate_calls:true,not_isolated_session:true});
     if(route==='/v1/snapshot')return response({
       provider:'same_mac_background_ax',revision:'b'.repeat(64),nodes:[]});
     const input=JSON.parse(init.body);
     expect(input.action).toBe('set_value');
     expect(input.value).toBe('8');
     return response({dispatched:true,frontmost_unchanged:true});
   });
   vi.stubGlobal('fetch',fetcher);
   const service=new SameMacAXService(cfg);
   const target={bundle_id:'com.lch.SameMacAXFixture',
     window_title:'Same Mac AX Fixture'};
   await expect(service.snapshot(target)).resolves.toMatchObject({
     provider:'same_mac_background_ax'});
   await expect(service.action({...target,action:'set_value',
     node_ref:'c'.repeat(64),expected_revision:'b'.repeat(64),
     request_id:'d'.repeat(64),reason:'Change fixture hours without moving focus',
     value:'8'})).resolves.toMatchObject({frontmost_unchanged:true});
   expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it('registers exactly same-Mac AX tools and keeps old Mac worker optional',async()=>{
   const local={
     status:async()=>({provider:'same_mac_background_ax',ready:false}),
     snapshot:async()=>({nodes:[]}),
     action:async()=>({dispatched:false})
   } as unknown as SameMacAXService;
   const server=createMcpServer({} as WorkspaceService,undefined,undefined,local);
   const client=new Client({name:'same-mac-ax-test',version:'1'},{capabilities:{}});
   const [a,b]=InMemoryTransport.createLinkedPair();
   try{
     await server.connect(b);await client.connect(a);
     const tools=(await client.listTools()).tools;
     const names=tools.map(t=>t.name);
     for(const name of ['mac_same_background_status',
       'mac_same_background_snapshot','mac_same_background_action'])
       expect(names).toContain(name);
     expect(names).not.toContain('mac_background_cua_action');
     const action=tools.find(t=>t.name==='mac_same_background_action');
     expect(action?.inputSchema?.required).toContain('node_ref');
     expect(action?.inputSchema?.required).toContain('expected_revision');
   }finally{await client.close();await server.close();}
 });
});
