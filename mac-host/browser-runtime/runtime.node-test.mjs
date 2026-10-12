import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { scrubContent } from './contracts.mjs';
import { ConnectionPool, validateEndpoint, resolveEndpoint } from './connection-pool.mjs';
import { AuditLedger } from './audit-ledger.mjs';
import { BrowserRuntime } from './runtime.mjs';
import { FakeConnection, FakePage, fixture, actionFor } from './test-fixtures.mjs';

for (const endpoint of ['http://example.com:9222', 'http://localhost:9222', 'http://0.0.0.0:9222',
  'http://169.254.169.254:8080', 'file:///etc/passwd', 'http://user:pass@127.0.0.1:9222',
  'http://127.0.0.1:9222/?token=secret', 'http://127.0.0.1:9222/json/version', 'ws://127.0.0.1:9222/other']) {
  test('reject unsafe/unprovisioned endpoint ' + endpoint.split('@').at(-1), () => assert.throws(() => validateEndpoint(endpoint)));
}
test('numeric-loopback provisioned endpoints pass without opening a port', () => {
  assert.equal(validateEndpoint('http://127.0.0.1:9222').hostname, '127.0.0.1');
  assert.equal(validateEndpoint('ws://[::1]:9222/devtools/browser/a').hostname, '[::1]');
  assert.equal(validateEndpoint('ws://127.0.0.1:8000/opaque', 'playwright').protocol, 'ws:');
});
test('DevTools metadata cannot redirect connection to another host or port', async () => {
  for (const url of ['ws://127.0.0.1:9999/devtools/browser/a', 'ws://10.0.0.1:9222/devtools/browser/a']) {
    await assert.rejects(resolveEndpoint('http://127.0.0.1:9222', 'cdp', async () =>
      new Response(JSON.stringify({ webSocketDebuggerUrl: url }))), /ENDPOINT/);
  }
});
test('metadata is bounded before JSON parsing', async () => {
  await assert.rejects(resolveEndpoint('http://127.0.0.1:9222', 'cdp', async () => new Response('x'.repeat(70000))), /METADATA_TOO_LARGE/);
});
test('concurrent lazy attach is single-flight and warm discovery reuses connection', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 20 }, () => f.runtime.discover({ browser: 'chrome' })));
  assert.equal(f.connections(), 1);
  const a = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  const b = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  assert.equal(a.tab_ref, b.tab_ref);
  assert.equal(f.connections(), 1);
  await f.runtime.close();
});
test('same titles and URLs never collapse different physical tabs', async () => {
  const f = fixture(); f.connection.pages.push(new FakePage());
  const tabs = (await f.runtime.discover({ browser: 'chrome', title: 'LUMA' })).tabs;
  assert.equal(tabs.length, 2); assert.notEqual(tabs[0].tab_ref, tabs[1].tab_ref);
});
test('title filtering is case-sensitive exact by default and optional contains', async () => {
  const f = fixture();
  assert.equal((await f.runtime.discover({ browser: 'chrome', title: 'luma' })).tabs.length, 0);
  assert.equal((await f.runtime.discover({ browser: 'chrome', title: 'luma', exact: false })).tabs.length, 1);
});
test('an unconfigured provider returns explicit absence without implicit browser launch', async () => {
  const f = fixture({ providers: {} });
  await assert.rejects(f.runtime.discover({ browser: 'chrome' }), /NOT_CONFIGURED/);
  assert.equal(f.connections(), 0);
});
test('disconnect invalidates refs; reacquisition uses a new epoch and handle', async () => {
  let connection = new FakeConnection();
  const f = fixture({ connect: async () => connection });
  const old = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  await connection.close(); connection = new FakeConnection();
  const next = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  assert.notEqual(next.tab_ref, old.tab_ref);
  assert(next.provider_epoch > old.provider_epoch);
  await assert.rejects(f.runtime.inspect({ browser: 'chrome', tab_ref: old.tab_ref }), /STALE_TAB/);
});
test('attach failure has a bounded cooldown and no automatic action retry', async () => {
  let calls = 0;
  const pool = new ConnectionPool({ providers: { chrome: { endpoint: 'http://127.0.0.1:9222' } },
    connect: async () => { calls++; throw Error('private network details'); } });
  await assert.rejects(pool.get('chrome'), /BROWSER_ATTACH_FAILED/);
  await assert.rejects(pool.get('chrome'), /COOLDOWN/);
  assert.equal(calls, 1);
});
test('closed and expired references fail safely', async () => {
  const f = fixture(); const input = await actionFor(f);
  f.page.closeTab();
  await assert.rejects(f.runtime.inspect({ browser: 'chrome', tab_ref: input.tab_ref }), /STALE_TAB/);
  const g = fixture(); const next = await actionFor(g); g.advance(16 * 60000);
  await assert.rejects(g.runtime.inspect({ browser: 'chrome', tab_ref: next.tab_ref }), /STALE_TAB/);
});
test('failed ARIA on an attached tab returns explicitly non-semantic text without native UI', async () => {
  const f = fixture();
  f.page.ariaError = true;
  f.page.text = 'Learner dashboard\n- textbox "Password": sensitive-fixture-value';
  const tab = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  const output = await f.runtime.inspect({ browser: 'chrome', tab_ref: tab.tab_ref });
  assert.equal(output.inspection_mode, 'text_fallback');
  assert.equal(output.semantic_available, false);
  assert.equal(output.aria, undefined);
  assert(output.page_text.includes('Learner dashboard'));
  assert(!output.page_text.includes('sensitive-fixture-value'));
  assert.equal(f.page.calls.length, 0);
  await f.runtime.close();
});
test('failed ARIA and failed text return a safe specific code without private diagnostics', async () => {
  const f = fixture();
  f.page.ariaError = true;
  f.page.textError = true;
  const tab = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  await assert.rejects(
    f.runtime.inspect({ browser: 'chrome', tab_ref: tab.tab_ref }),
    error => error.message === 'BROWSER_INSPECT_UNAVAILABLE'
  );
  assert.equal(f.page.calls.length, 0);
  await f.runtime.close();
});
test('navigation during a fallback read is detected instead of returning stale text', async () => {
  const f = fixture();
  f.page.ariaError = true;
  const originalLocator = f.page.locator.bind(f.page);
  f.page.locator = () => ({
    ...originalLocator(),
    innerText: async () => {
      f.page.navigate('https://luma.example/other');
      return 'Old page text';
    }
  });
  const tab = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  await assert.rejects(f.runtime.inspect({ browser: 'chrome', tab_ref: tab.tab_ref }), /STALE_PAGE_REVISION/);
  await f.runtime.close();
});
test('full URL fragment/query navigation invalidates the prior revision despite sanitized output', async () => {
  const f = fixture(); const input = await actionFor(f);
  f.page.navigate('https://luma.example/learn?tenant=another#settings');
  await assert.rejects(f.runtime.perform(input), /STALE_PAGE_REVISION/);
  assert.equal(f.page.calls.length, 0);
});
test('dynamic off preserves allowed-origin restrictions', async () => {
  const f = fixture({ dynamicTabs: false, allowedOrigins: new Set(['https://approved.example']) });
  assert.equal((await f.runtime.discover({ browser: 'chrome' })).tabs.length, 0);
});
test('no session, wrong browser scope and expiry reject before dispatch', async () => {
  const f = fixture({ scope: 'edge' }); const input = await actionFor(f);
  await assert.rejects(async () => f.runtime.perform(input), /SESSION_SCOPE_MISMATCH/);
  await assert.rejects(async () => f.runtime.perform({ ...input, session_id: 'f'.repeat(48) }), /SESSION_NOT_ACTIVE/);
  f.advance(11 * 60000);
  await assert.rejects(async () => f.runtime.perform(input), /SESSION_NOT_ACTIVE/);
  assert.equal(f.page.calls.length, 0);
});
test('expiry/revocation during preflight is checked again before dispatch', async () => {
  const f = fixture(); const input = await actionFor(f);
  f.runtime.audit = async () => f.sessionStore.end();
  await assert.rejects(f.runtime.perform(input), /SESSION_NOT_ACTIVE/);
  assert.equal(f.page.calls.length, 0);
});
test('one delegation permits several semantic actions without local prompt', async () => {
  const f = fixture(); const input = await actionFor(f);
  for (let n = 0; n < 3; n++) {
    assert.equal((await f.runtime.perform({ ...input, request_id: 'operation-request-' + String(n).padStart(4, '0') })).outcome, 'dispatched');
  }
  assert.equal(f.page.calls.length, 3);
  assert.equal(f.sessionStore.status().remaining_actions, 117);
});
test('same request is executed once even with simultaneous callers', async () => {
  const f = fixture(); const input = await actionFor(f);
  const [a, b] = await Promise.all([f.runtime.perform(input), f.runtime.perform(input)]);
  assert.deepEqual(a, b); assert.equal(f.page.calls.length, 1);
  await f.runtime.perform(input); assert.equal(f.page.calls.length, 1);
});
test('request ID reuse with changed payload fails without a second event', async () => {
  const f = fixture(); const input = await actionFor(f); await f.runtime.perform(input);
  await assert.rejects(async () => f.runtime.perform({ ...input, action: 'fill', value: 'private value' }), /REQUEST_ID_CONFLICT/);
  assert.equal(f.page.calls.length, 1);
});
test('two writers cannot mutate the same browser concurrently', async () => {
  const f = fixture(); const input = await actionFor(f);
  let release; const hold = new Promise(r => { release = r; });
  f.page.nodes.set('Start', { effect: () => hold });
  const first = f.runtime.perform(input);
  const second = f.runtime.perform({ ...input, request_id: 'other-request-0002' });
  await assert.rejects(second, /BROWSER_BUSY/);
  release(); await first; assert.equal(f.page.calls.length, 1);
});
test('post-dispatch timeout reports uncertain and replay never clicks again', async () => {
  const f = fixture(); const input = await actionFor(f);
  f.page.nodes.set('Start', { effect: () => { throw Error('timeout secret content'); } });
  const result = await f.runtime.perform(input);
  assert.equal(result.outcome, 'uncertain');
  assert.equal(result.automatic_retry, false);
  assert.deepEqual(await f.runtime.perform(input), result);
  assert.equal(f.page.calls.length, 1);
  assert(!JSON.stringify(result).includes('secret content'));
});
test('audit failure before dispatch denies, after dispatch never converts result to retryable failure', async () => {
  const f = fixture(); const input = await actionFor(f);
  f.runtime.audit = async () => { throw Error('disk full'); };
  await assert.rejects(f.runtime.perform(input), /AUDIT_UNAVAILABLE/); assert.equal(f.page.calls.length, 0);
  const g = fixture(); const next = await actionFor(g);
  g.runtime.audit = async event => { if (event.event === 'result') throw Error('disk full'); };
  const result = await g.runtime.perform(next);
  assert.equal(result.outcome, 'dispatched'); assert.equal(result.audit_receipt, 'unavailable_after_dispatch');
  await g.runtime.perform(next); assert.equal(g.page.calls.length, 1);
});
for (const attributes of [{ type: 'password' }, { type: 'PASSWORD' }, { type: 'file' }, { autocomplete: 'one-time-code' }, { autocomplete: 'cc-number' }]) {
  test('protected input is rejected ' + JSON.stringify(attributes), async () => {
    const f = fixture(); const input = await actionFor(f, { action: 'fill', value: 'sensitive value' });
    f.page.nodes.set('Start', attributes);
    await assert.rejects(f.runtime.perform(input), /PROTECTED_INPUT/); assert.equal(f.page.calls.length, 0);
  });
}
test('ambiguous semantic matches are not resolved by silently picking first', async () => {
  const f = fixture(); const input = await actionFor(f); f.page.nodes.set('Start', { count: 2 });
  await assert.rejects(f.runtime.perform(input), /AMBIGUOUS_LOCATOR/); assert.equal(f.page.calls.length, 0);
});
test('unsupported evaluate, filesystem, endpoint and malformed selector parameters fail validation', async () => {
  const f = fixture(); const input = await actionFor(f);
  for (const patch of [{ action: 'evaluate' }, { endpoint: 'http://attacker.example' },
    { locator: { by: 'css', name: '*', script: 'evil()' } }, { action: 'press', key: 'Meta+L' }]) {
    await assert.rejects(async () => f.runtime.perform({ ...input, ...patch }));
  }
  assert.equal(f.page.calls.length, 0);
});
test('audit chain persists ordered metadata without content or credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-audit-test-'));
  const ledger = new AuditLedger(dir);
  try {
    await Promise.all([ledger.append({ event: 'intent', request_id: 'request-001', secret: 'LEAK' }),
      ledger.append({ event: 'result', request_id: 'request-001', value: 'LEAK', session_id: 'LEAK' })]);
    await ledger.close();
    const lines = (await fs.readFile(ledger.path, 'utf8')).trim().split('\n').map(x => JSON.parse(x));
    assert.equal(lines.length, 2); assert.equal(lines[1].previous, lines[0].hash);
    for (const line of lines) { const { hash, ...record } = line;
      assert.equal(hash, crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex')); }
    assert(!JSON.stringify(lines).includes('LEAK'));
    assert.equal((await fs.stat(ledger.path)).mode & 0o777, 0o600);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('closing attached runtime only disconnects, preserving existing pages', async () => {
  const f = fixture(); await f.runtime.discover({ browser: 'chrome' }); await f.runtime.close();
  assert.equal(f.page.closed, false); assert.equal(f.connection.closeCount, 1);
});
test('provider construction requires the same session store and audit boundary', () => {
  assert.throws(() => new BrowserRuntime({ providers: {} }), /DEPENDENCIES_REQUIRED/);
});

test('ARIA redaction removes password/field values including multiline subtrees and preserves label colons', () => {
  const redacted = scrubContent('- textbox "Password": private-secret\n- textbox "Note: detail": |\n  deeply-private-line\n- button "Next"');
  assert(!redacted.includes('private-secret'));
  assert(!redacted.includes('deeply-private-line'));
  assert(redacted.includes('"Note: detail"'));
  assert(redacted.includes('button "Next"'));
});
test('partial audit writes poison the ledger rather than corrupting subsequent chains', async () => {
  const ledger = new AuditLedger('/not-used');
  ledger.file = { write: async () => ({bytesWritten: 1}), sync: async () => {}, close: async () => {} };
  await assert.rejects(ledger.append({event:'intent'}), /SHORT_WRITE/);
  await assert.rejects(ledger.append({event:'intent'}), /POISONED/);
  await ledger.close();
});

test('request receipts are bounded per valid task rather than exhausting the process across tasks', async () => {
  const f = fixture({maxRequests:1});
  const input = await actionFor(f);
  await f.runtime.perform(input);
  f.sessionStore.end();
  const grant = f.sessionStore.begin({scope:'chrome',duration_minutes:5,max_actions:20,purpose:'Second isolated task'});
  const next = await f.runtime.perform({...input,session_id:grant.session_id,request_id:'second-task-request-02'});
  assert.equal(next.outcome,'dispatched');
  assert.equal(f.runtime.requests.size,1);
  assert.equal(f.page.calls.length,2);
});

test('Playwright local channels attach to existing Chrome and Edge without numeric ports', async () => {
  const seen=[];
  const chromium=async (config,name)=>{
    seen.push({browser:name,endpoint:await resolveEndpoint(config.endpoint,config.protocol,()=>{
      throw Error('Network probe must not run for local channel names');
    })});
    return new FakeConnection();
  };
  const pool=new ConnectionPool({
    providers:{
      chrome:{endpoint:'chrome',protocol:'cdp'},
      edge:{endpoint:'msedge',protocol:'cdp'}
    },
    connect:chromium
  });
  const first=await pool.get('chrome');
  const second=await pool.get('edge');
  assert(first.connection.isConnected());
  assert(second.connection.isConnected());
  assert.deepEqual(seen,[{browser:'chrome',endpoint:'chrome'},{browser:'edge',endpoint:'msedge'}]);
  assert.equal(pool.status().metrics.connections,2);
  await pool.close();
});
test('browser channel cross-attachment and non-CDP transport are denied', () => {
  for(const item of [
    {chrome:{endpoint:'msedge',protocol:'cdp'}},
    {edge:{endpoint:'chrome',protocol:'cdp'}},
    {chrome:{endpoint:'chrome',protocol:'playwright'}},
    {edge:{endpoint:'msedge',protocol:'playwright'}}
  ])assert.throws(()=>new ConnectionPool({providers:item}),/BROWSER_CHANNEL_MISMATCH/);
});
test('channel endpoints allow only canonical existing browser identities', () => {
  for(const value of ['chrome-beta','msedge-dev','chromium','firefox','google-chrome',
      'chrome://inspect','chrome;rm -rf','chrome.local','msedge?x=y']){
    assert.throws(()=>validateEndpoint(value,'cdp'),/BROWSER_ENDPOINT/);
  }
  assert.equal(validateEndpoint('chrome','cdp','chrome').channel,'chrome');
  assert.equal(validateEndpoint('msedge','cdp','edge').channel,'msedge');
});

test('unconfigured runtime automatically chooses local existing Chrome and Edge channels',async()=>{
  const {providersFromEnvironment}=await import('./runtime.mjs');
  assert.deepEqual(providersFromEnvironment({}),{
    chrome:{endpoint:'chrome',protocol:'cdp'},
    edge:{endpoint:'msedge',protocol:'cdp'}
  });
  assert.deepEqual(providersFromEnvironment({COMPUTER_USE_BROWSER_AUTO_ATTACH:'false'}),{});
});
test('explicit local Playwright endpoints override automatic channels without silently rewriting them',async()=>{
  const {providersFromEnvironment}=await import('./runtime.mjs');
  assert.deepEqual(providersFromEnvironment({
    COMPUTER_USE_CHROME_ENDPOINT:'http://127.0.0.1:9222',
    COMPUTER_USE_CHROME_PROTOCOL:'cdp',
    COMPUTER_USE_EDGE_ENDPOINT:'ws://127.0.0.1:4050/agent',
    COMPUTER_USE_EDGE_PROTOCOL:'playwright'
  }),{
    chrome:{endpoint:'http://127.0.0.1:9222',protocol:'cdp'},
    edge:{endpoint:'ws://127.0.0.1:4050/agent',protocol:'playwright'}
  });
});
