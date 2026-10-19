/** Real Chromium test in dev-main only. Never use a logged-in host browser/profile. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { createSessionStore } from '../autonomy-session.mjs';
import { BrowserRuntime } from './runtime.mjs';
import { createBridgeServer } from '../bridge.mjs';
import { createMcpServer } from '../../dist/mcp/server.js';
import { ComputerUseService } from '../../dist/services/computer-use-service.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

if (process.env.CUA_BROWSER_E2E !== '1' || process.platform !== 'linux') {
  throw Error('Explicit CUA_BROWSER_E2E=1 on Linux required; never run against the Mac profile.');
}
let executablePath = '/usr/bin/chromium';
try { await fs.access(executablePath); } catch { executablePath = chromium.executablePath(); }
await fs.access(executablePath);
const web = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><head><title>Runtime V2 Fixture</title></head><body>
    <h1>Isolated browser fixture</h1>
    <button onclick="window.clickCount=(window.clickCount||0)+1; document.getElementById('count').textContent=window.clickCount">Start</button>
    <output id="count">0</output>
    <label>Learner note<input aria-label="Learner note"></label>
    <label>Password<input type="password" aria-label="Password" value="sensitive-password-fixture"></label>
    <select aria-label="Theme"><option value="light">Light</option><option value="dark">Dark</option></select>
    <button data-testid="finish">Finish</button>
  </body></html>`);
});
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
let owner, setup, runtime;
const evidence = { environment: 'isolated Linux Chromium; NOT user Chrome/Edge', checks: [], benchmark: {} };
try {
  owner = await chromium.launchServer({ executablePath, headless: true, host: '127.0.0.1',
    args: ['--no-sandbox', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--renderer-process-limit=2'] });
  const profileArg = owner.process().spawnargs.find(x => x.startsWith('--user-data-dir='));
  assert(profileArg, 'Expected private Playwright-created test profile');
  const profile = profileArg.slice('--user-data-dir='.length);
  let port;
  for (let i = 0; i < 40; i++) {
    try { port = Number((await fs.readFile(profile + '/DevToolsActivePort', 'utf8')).split('\n')[0]); if (port) break; }
    catch { /* Wait only for this test process's endpoint file. No scanning. */ }
    await delay(50);
  }
  assert(port > 1023, 'Missing test-only CDP port');
  const endpoint = 'http://127.0.0.1:' + port;
  setup = await chromium.connectOverCDP(endpoint);
  const page = await setup.contexts()[0].newPage();
  const url = 'http://127.0.0.1:' + web.address().port + '/fixture';
  await page.goto(url);
  const sessionStore = createSessionStore();
  const grant = sessionStore.begin({ scope: 'chrome', duration_minutes: 5, max_actions: 40,
    purpose: 'Isolated deterministic Chromium verification, no user accounts' });
  const records = [];
  runtime = new BrowserRuntime({ providers: { chrome: { endpoint, protocol: 'cdp' } }, sessionStore,
    dynamicTabs: true, audit: async r => { records.push(r); return { recorded: true }; } });
  const coldStart = performance.now();
  const first = await runtime.discover({ browser: 'chrome', title: 'Runtime V2 Fixture' });
  evidence.benchmark.cold_attach_and_discovery_ms = Number((performance.now() - coldStart).toFixed(2));
  assert.equal(first.tabs.length, 1);
  const tab = first.tabs[0];
  evidence.checks.push('real_cdp_attach');
  const observed = await runtime.inspect({ browser: 'chrome', tab_ref: tab.tab_ref });
  assert.equal(observed.inspection_mode, 'aria');
  assert.equal(observed.semantic_available, true);
  assert(observed.aria.includes('Start'));
  assert(!observed.aria.includes('sensitive-password-fixture'));
  evidence.checks.push('real_aria_snapshot');
  const base = { browser: 'chrome', tab_ref: tab.tab_ref, expected_revision: observed.revision, session_id: grant.session_id };
  const click = { ...base, request_id: 'real-chromium-click-0001', action: 'click', locator: { by: 'role', role: 'button', name: 'Start' } };
  assert.equal((await runtime.perform(click)).outcome, 'dispatched');
  await runtime.perform(click);
  assert.equal(await page.locator('#count').innerText(), '1');
  evidence.checks.push('semantic_click_and_replay_suppression');
  assert.equal((await runtime.perform({ ...base, request_id: 'real-chromium-fill-00002', action: 'fill',
    locator: { by: 'label', name: 'Learner note' }, value: 'Authorized fixture note' })).outcome, 'dispatched');
  assert.equal(await page.getByLabel('Learner note').inputValue(), 'Authorized fixture note');
  assert.equal((await runtime.perform({ ...base, request_id: 'real-chromium-select-003', action: 'select',
    locator: { by: 'label', name: 'Theme' }, value: 'dark' })).outcome, 'dispatched');
  assert.equal(await page.getByLabel('Theme').inputValue(), 'dark');
  evidence.checks.push('semantic_fill_and_select');
  await assert.rejects(runtime.perform({ ...base, request_id: 'real-protected-password-4', action: 'fill',
    locator: { by: 'label', name: 'Password' }, value: 'never-write' }), /PROTECTED_INPUT/);
  evidence.checks.push('protected_input_denied');
  const shot = await runtime.screenshot({ browser: 'chrome', tab_ref: tab.tab_ref });
  assert.equal(shot.mime_type, 'image/png');
  assert(Buffer.from(shot.base64, 'base64').length > 100);
  evidence.checks.push('cdp_screenshot_in_memory');
  const warm = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const result = await runtime.discover({ browser: 'chrome', title: 'Runtime V2 Fixture' });
    assert.equal(result.tabs[0].tab_ref, tab.tab_ref);
    warm.push(performance.now() - start);
  }
  warm.sort((a, b) => a - b);
  evidence.benchmark.warm_discovery_samples = warm.length;
  evidence.benchmark.warm_p50_ms = Number(warm[14].toFixed(2));
  evidence.benchmark.warm_p95_ms = Number(warm[28].toFixed(2));
  evidence.benchmark.attach_count_before_disconnect = runtime.status().metrics.connections;
  assert.equal(runtime.status().metrics.connections, 1);
  evidence.checks.push('persistent_connection_reused_30_times');
  await page.goto(url + '?tenant=changed#route');
  await assert.rejects(runtime.perform({ ...click, request_id: 'stale-navigation-request5' }), /STALE_PAGE_REVISION/);
  evidence.checks.push('full_url_navigation_revision_guard');
  await runtime.pool.slots.get('chrome').connection.close();
  assert.equal(page.isClosed(), false, 'Disconnect must not close user-owned pages');
  const renewed = (await runtime.discover({ browser: 'chrome', title: 'Runtime V2 Fixture' })).tabs[0];
  assert.notEqual(renewed.tab_ref, tab.tab_ref);
  await assert.rejects(runtime.inspect({ browser: 'chrome', tab_ref: tab.tab_ref }), /STALE_TAB_REFERENCE/);
  evidence.checks.push('reconnect_invalidates_refs_without_closing_tabs');
  sessionStore.end();
  await assert.rejects(async () => runtime.perform({ ...click, tab_ref: renewed.tab_ref,
    expected_revision: renewed.revision, request_id: 'revoked-session-request06' }), /SESSION_NOT_ACTIVE/);
  evidence.checks.push('revocation_denies_next_dispatch');
  assert(!JSON.stringify(records).includes('Authorized fixture note'));
  assert(!JSON.stringify(records).includes(grant.session_id));
  evidence.checks.push('audit_excludes_content_and_session_capability');
  // The native Playwright protocol can also expose an already-owned browser.
  // bind() is used only for this isolated fixture, never to configure a user's Mac.
  const published = await setup.bind('cua-v2-isolated-fixture', {host:'127.0.0.1',port:0});
  const protocolRuntime = new BrowserRuntime({providers:{chrome:{endpoint:published.endpoint,protocol:'playwright'}},
    sessionStore,dynamicTabs:true,audit:async()=>({recorded:true})});
  try {
    const shared = await protocolRuntime.discover({browser:'chrome',title:'Runtime V2 Fixture'});
    assert.equal(shared.tabs.length,1);
    assert((await protocolRuntime.inspect({browser:'chrome',tab_ref:shared.tabs[0].tab_ref})).aria.includes('Start'));
    evidence.checks.push('playwright_protocol_attach_and_existing_tab_inspection');
  } finally { await protocolRuntime.close(); await setup.unbind(); }
  assert.equal(page.isClosed(),false);
  // Exercise the same MCP -> HTTP bridge -> persistent runtime path used on Mac.
  // Only the browser and native platform dependency are isolated test fixtures.
  const wireSessions = createSessionStore();
  const wireGrant = wireSessions.begin({scope:'chrome',duration_minutes:3,max_actions:10,
    purpose:'Isolated MCP transport browser test'});
  const wireToken = 'isolated-browser-test-token-not-production-123456789';
  const hostBridge = createBridgeServer({token:wireToken,allowedOrigins:new Set(['https://fixture.example']),
    dynamicTabs:true,platform:'darwin',sessionStore:wireSessions,enableBrowserRuntime:true,
    // The production default is intentionally native-first; this isolated CDP E2E
    // must explicitly opt in to the persistent provider.
    browserRouting:'prefer_persistent',
    browserProviders:{chrome:{endpoint,protocol:'cdp'}},
    nativeHandler:async()=>{throw Error('Native fallback must not be invoked');},
    auditHandler:async()=>({recorded:true})});
  await new Promise(resolve=>hostBridge.listen(0,'127.0.0.1',resolve));
  const proxy = new ComputerUseService({COMPUTER_USE_ENABLED:true,
    COMPUTER_USE_BRIDGE_TOKEN:wireToken,
    COMPUTER_USE_BRIDGE_URL:'http://127.0.0.1:'+hostBridge.address().port});
  const mcp = createMcpServer({},proxy);
  const client = new Client({name:'isolated-e2e',version:'1'},{capabilities:{}});
  const [clientSide,serverSide]=InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(serverSide);await client.connect(clientSide);
    const tabsResult=await client.callTool({name:'browser_tabs',arguments:{browser:'chrome',title:'Runtime V2 Fixture'}});
    assert(!tabsResult.isError,JSON.stringify(tabsResult));
    const found=JSON.parse(tabsResult.content[0].text).tabs[0];
    const inspected=await client.callTool({name:'browser_inspect',arguments:{browser:'chrome',tab_ref:found.tab_ref}});
    assert(!inspected.isError);
    const request={browser:'chrome',tab_ref:found.tab_ref,expected_revision:found.revision,
      session_id:wireGrant.session_id,request_id:'mcp-bridge-browser-action-01',action:'click',
      locator:{by:'test_id',name:'finish'}};
    const wireAction=await client.callTool({name:'browser_action',arguments:request});
    assert(!wireAction.isError,JSON.stringify(wireAction));
    assert.equal(JSON.parse(wireAction.content[0].text).outcome,'dispatched');
    const image=await client.callTool({name:'browser_screenshot',arguments:{browser:'chrome',tab_ref:found.tab_ref}});
    assert.equal(image.content[0].type,'image');
    evidence.checks.push('real_mcp_http_bridge_semantic_action_and_image');
  } finally {
    await client.close();await mcp.close();
    await new Promise(resolve=>hostBridge.close(resolve));
  }
  evidence.result = 'PASS';
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (runtime) await runtime.close();
  if (setup) await setup.close();
  if (owner) await owner.close();
  await new Promise(resolve => web.close(resolve));
}
