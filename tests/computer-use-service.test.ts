import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ComputerUseService } from '../src/services/computer-use-service.js';

const servers: Server[] = [];
async function mockBridge(reply: unknown) {
  const server = createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer example-token-0123456789abcdefghijklmn');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return 'http://127.0.0.1:' + address.port;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
describe('native Computer Use controller', () => {
  it('is disabled by default even if caller requests browser state', async () => {
    const service = new ComputerUseService({
      COMPUTER_USE_ENABLED: false,
      COMPUTER_USE_BRIDGE_URL: 'http://host.docker.internal:9764',
      COMPUTER_USE_BRIDGE_TOKEN: undefined
    });
    expect(await service.status()).toMatchObject({enabled: false, connected: false});
    await expect(service.state()).rejects.toThrow('disabled');
  });
  it('proxies authorized UI state through its own MCP controller', async () => {
    const url = await mockBridge({ok: true, data: {browsers: [{browser: 'edge',running: true}]}});
    const service = new ComputerUseService({
      COMPUTER_USE_ENABLED: true,
      COMPUTER_USE_BRIDGE_URL: url,
      COMPUTER_USE_BRIDGE_TOKEN: 'example-token-0123456789abcdefghijklmn'
    });
    await expect(service.state('edge')).resolves.toMatchObject({browsers: [{browser: 'edge'}]});
  });
  it('rejects missing title before sending a native action to the Mac bridge', async () => {
    const service = new ComputerUseService({
      COMPUTER_USE_ENABLED:true,
      COMPUTER_USE_BRIDGE_URL:'http://127.0.0.1:1',
      COMPUTER_USE_BRIDGE_TOKEN:'example-token-0123456789abcdefghijklmn'
    });
    await expect(service.action({
      browser:'edge',window_index:1,tab_index:1,
      expected_url:'https://wf24.myhcl.com/iTime/ngiTime/home',
      expected_title:'',
      action:'press_key',key:'tab',reason:'Navigate a precisely identified timesheet cell'
    })).rejects.toThrow('EXPECTED_TITLE_REQUIRED');
  });
  it('rejects screenshots and focus without a fresh exact title before contacting the host', async () => {
    const service = new ComputerUseService({
      COMPUTER_USE_ENABLED:true,
      COMPUTER_USE_BRIDGE_URL:'http://127.0.0.1:1',
      COMPUTER_USE_BRIDGE_TOKEN:'example-token-0123456789abcdefghijklmn'
    });
    const target = {
      browser:'edge' as const,window_index:2,tab_index:1,
      expected_url:'https://wf24.myhcl.com/iTime/ngiTime/home',expected_title:' '
    };
    await expect(service.screenshot(target)).rejects.toThrow('EXPECTED_TITLE_REQUIRED');
    await expect(service.focus(target)).rejects.toThrow('EXPECTED_TITLE_REQUIRED');
  });
  it('preserves verified Retina screenshot geometry from the host in the controller result', async () => {
    const geometry={
      coordinate_contract:'mac-screen-points.v1',
      screenshot_ref:'a'.repeat(64),
      bounds_points:{x:100,y:80,width:600,height:400},
      image_pixels:{width:1200,height:800},
      scale:{x:2,y:2},
      expires_in_ms:30000
    };
    const url=await mockBridge({ok:true,data:{
      mime_type:'image/png',base64:'iVBORw0KGgo=',geometry
    }});
    const svc=new ComputerUseService({
      COMPUTER_USE_ENABLED:true,COMPUTER_USE_BRIDGE_URL:url,
      COMPUTER_USE_BRIDGE_TOKEN:'example-token-0123456789abcdefghijklmn'
    });
    const result=await svc.screenshot({
      browser:'edge',window_index:1,tab_index:1,
      expected_url:'https://admin.microsoft.com/',expected_title:'Admin'
    });
    expect(result.geometry).toEqual(geometry);
  });
  it('rejects malformed screenshot geometry rather than presenting unsafe pixel mapping', async () => {
    const url=await mockBridge({ok:true,data:{mime_type:'image/png',
      base64:'iVBORw0KGgo=',geometry:{
        coordinate_contract:'mac-screen-points.v1',
        screenshot_ref:'not-an-opaque-ref',
        bounds_points:{x:0,y:0,width:600,height:400},
        image_pixels:{width:1200,height:800},scale:{x:2,y:2},expires_in_ms:30000
      }}});
    const svc=new ComputerUseService({
      COMPUTER_USE_ENABLED:true,COMPUTER_USE_BRIDGE_URL:url,
      COMPUTER_USE_BRIDGE_TOKEN:'example-token-0123456789abcdefghijklmn'
    });
    await expect(svc.screenshot({
      browser:'edge',window_index:1,tab_index:1,
      expected_url:'https://admin.microsoft.com/',expected_title:'Admin'
    })).rejects.toThrow('Invalid screenshot geometry');
  });
  it('delivers a native AX subtree snapshot without claiming a CDP or browser automation provider', async () => {
    const ax_snapshot={provider:'native_ax',ax_revision:'a'.repeat(64),
      expires_in_ms:30000,nodes:[{node_ref:'b'.repeat(64),role:'AXButton',
        name:'Cancel Editing',enabled:true,parent_path:[2]}]};
    const url=await mockBridge({ok:true,data:{
      mime_type:'image/png',base64:'iVBORw0KGgo=',ax_snapshot
    }});
    const svc=new ComputerUseService({
      COMPUTER_USE_ENABLED:true,COMPUTER_USE_BRIDGE_URL:url,
      COMPUTER_USE_BRIDGE_TOKEN:'example-token-0123456789abcdefghijklmn'
    });
    const result=await svc.screenshot({browser:'edge',window_index:1,tab_index:1,
      expected_url:'https://admin.microsoft.com/',expected_title:'Admin'}, {include_ax:true});
    expect(result.ax_snapshot).toEqual(ax_snapshot);
  });
  it('rejects AX metadata without opaque node identity', async () => {
    const url=await mockBridge({ok:true,data:{mime_type:'image/png',
      base64:'iVBORw0KGgo=',ax_snapshot:{provider:'native_ax',
        ax_revision:'a'.repeat(64),expires_in_ms:30000,
        nodes:[{node_ref:'leak',role:'AXButton',name:'Cancel',enabled:true}]}}});
    const svc=new ComputerUseService({
      COMPUTER_USE_ENABLED:true,COMPUTER_USE_BRIDGE_URL:url,
      COMPUTER_USE_BRIDGE_TOKEN:'example-token-0123456789abcdefghijklmn'
    });
    await expect(svc.screenshot({browser:'edge',window_index:1,tab_index:1,
      expected_url:'https://admin.microsoft.com/',expected_title:'Admin'},
      {include_ax:true})).rejects.toThrow('Invalid AX snapshot');
  });
  it('rejects invalid screenshot responses before exposing an MCP image', async () => {
    const url = await mockBridge({ok: true, data: {mime_type: 'image/png', base64: 'not+base64**'}});
    const service = new ComputerUseService({
      COMPUTER_USE_ENABLED: true, COMPUTER_USE_BRIDGE_URL: url,
      COMPUTER_USE_BRIDGE_TOKEN: 'example-token-0123456789abcdefghijklmn'
    });
    await expect(service.screenshot({
      browser: 'edge', window_index: 1, tab_index: 1, expected_url: 'https://admin.microsoft.com/', expected_title: 'Admin'
    })).rejects.toThrow('Invalid or oversized');
  });
});
