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
  it('rejects invalid screenshot responses before exposing an MCP image', async () => {
    const url = await mockBridge({ok: true, data: {mime_type: 'image/png', base64: 'not+base64**'}});
    const service = new ComputerUseService({
      COMPUTER_USE_ENABLED: true, COMPUTER_USE_BRIDGE_URL: url,
      COMPUTER_USE_BRIDGE_TOKEN: 'example-token-0123456789abcdefghijklmn'
    });
    await expect(service.screenshot({
      browser: 'edge', window_index: 1, tab_index: 1, expected_url: 'https://admin.microsoft.com/'
    })).rejects.toThrow('Invalid or oversized');
  });
});
