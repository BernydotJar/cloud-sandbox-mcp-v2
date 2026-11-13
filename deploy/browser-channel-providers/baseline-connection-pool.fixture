import { RuntimeFault, fail, browserName } from './contracts.mjs';

export function validateEndpoint(value, protocol = 'cdp') {
  let u;
  try { u = new URL(value); } catch { fail('INVALID_BROWSER_ENDPOINT'); }
  if (!['cdp', 'playwright'].includes(protocol) ||
      !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      u.username || u.password || u.search || u.hash || !u.port ||
      Number(u.port) < 1024 || Number(u.port) > 65535) fail('UNSAFE_BROWSER_ENDPOINT');
  if (protocol === 'playwright' && u.protocol !== 'ws:') fail('INVALID_BROWSER_ENDPOINT');
  if (protocol === 'cdp' && !['http:', 'ws:'].includes(u.protocol)) fail('INVALID_BROWSER_ENDPOINT');
  if (u.protocol === 'http:' && u.pathname !== '/') fail('INVALID_BROWSER_ENDPOINT');
  if (protocol === 'cdp' && u.protocol === 'ws:' && !/^\/devtools\/browser\/[a-zA-Z0-9_-]+$/.test(u.pathname)) fail('INVALID_BROWSER_ENDPOINT');
  return u;
}

export async function resolveEndpoint(endpoint, protocol, fetcher = fetch) {
  const original = validateEndpoint(endpoint, protocol);
  if (original.protocol === 'ws:') return original.href;
  const response = await fetcher(new URL('/json/version', original), {
    signal: AbortSignal.timeout(5000), redirect: 'error', headers: { accept: 'application/json' }
  });
  if (!response.ok || !response.body) fail('BROWSER_ENDPOINT_UNAVAILABLE');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 65536) fail('BROWSER_METADATA_TOO_LARGE');
      chunks.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  let metadata;
  try { metadata = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('INVALID_BROWSER_METADATA'); }
  const ws = validateEndpoint(metadata.webSocketDebuggerUrl, 'cdp');
  // Do not follow a DevTools response to another host/port (SSRF / cross-profile attach).
  if (ws.hostname !== original.hostname || ws.port !== original.port) fail('BROWSER_ENDPOINT_REDIRECT_DENIED');
  return ws.href;
}

async function playwrightConnector(config) {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch { fail('PLAYWRIGHT_DEPENDENCY_UNAVAILABLE'); }
  const endpoint = await resolveEndpoint(config.endpoint, config.protocol);
  try {
    return config.protocol === 'playwright'
      ? await chromium.connect(endpoint, { timeout: 8000 })
      : await chromium.connectOverCDP(endpoint, { timeout: 8000, noDefaults: true });
  } catch { fail('BROWSER_ATTACH_FAILED'); }
}

/** Lazy single-flight connections, no process launch, no profile access, no port scan. */
export class ConnectionPool {
  constructor({ providers = {}, connect = playwrightConnector, now = () => Date.now(), onInvalidated = () => {} } = {}) {
    this.providers = new Map();
    this.slots = new Map();
    this.connect = connect;
    this.now = now;
    this.onInvalidated = onInvalidated;
    this.closed = false;
    this.metrics = { connections: 0, reuses: 0, failures: 0, disconnects: 0 };
    for (const [name, config] of Object.entries(providers)) {
      browserName(name);
      if (!config || Object.keys(config).some(k => !['endpoint', 'protocol'].includes(k))) fail('INVALID_PROVIDER_CONFIG');
      const protocol = config.protocol || 'cdp';
      validateEndpoint(config.endpoint, protocol);
      this.providers.set(name, { endpoint: config.endpoint, protocol });
      this.slots.set(name, { epoch: 0, connection: null, pending: null, retryAt: 0 });
    }
  }
  async get(name) {
    browserName(name);
    if (this.closed) fail('RUNTIME_STOPPED');
    const config = this.providers.get(name);
    if (!config) fail('BROWSER_PROVIDER_NOT_CONFIGURED');
    const slot = this.slots.get(name);
    if (slot.connection?.isConnected()) {
      this.metrics.reuses++;
      return { connection: slot.connection, epoch: slot.epoch };
    }
    if (slot.pending) return slot.pending;
    if (this.now() < slot.retryAt) fail('BROWSER_ATTACH_COOLDOWN');
    slot.pending = (async () => {
      try {
        const connection = await Promise.resolve().then(() => this.connect(config, name));
        if (!connection?.isConnected()) fail('BROWSER_ATTACH_FAILED');
        if (this.closed) { await connection.close(); fail('RUNTIME_STOPPED'); }
        slot.epoch++;
        slot.connection = connection;
        this.metrics.connections++;
        connection.once('disconnected', () => {
          if (slot.connection !== connection) return;
          slot.connection = null;
          this.metrics.disconnects++;
          this.onInvalidated(name, slot.epoch);
        });
        return { connection, epoch: slot.epoch };
      } catch (error) {
        this.metrics.failures++;
        slot.retryAt = this.now() + 1500;
        throw error instanceof RuntimeFault ? error : new RuntimeFault('BROWSER_ATTACH_FAILED');
      } finally { slot.pending = null; }
    })();
    return slot.pending;
  }
  status() {
    return { providers: [...this.providers].map(([name, config]) => ({
      browser: name, protocol: config.protocol, configured: true,
      connected: Boolean(this.slots.get(name).connection?.isConnected()),
      epoch: this.slots.get(name).epoch
    })), metrics: { ...this.metrics } };
  }
  async close() {
    this.closed = true;
    // For attached browsers, Playwright disconnects and does not close existing tabs.
    // This runtime never creates browser contexts, so there are none to dispose.
    await Promise.all([...this.slots.values()].map(async slot => {
      if (slot.pending) await slot.pending.catch(() => {});
      if (slot.connection) await slot.connection.close().catch(() => {});
    }));
  }
}
