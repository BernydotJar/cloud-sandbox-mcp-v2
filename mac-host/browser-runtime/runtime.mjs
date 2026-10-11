import crypto from 'node:crypto';
import { ConnectionPool } from './connection-pool.mjs';
import { TabRegistry } from './tab-registry.mjs';
import { RuntimeFault, fail, browserName, object, boundedText, targetRequest, validateAction, webUrl, digest, scrubContent } from './contracts.mjs';

const TIMEOUT = 5000;
export class BrowserRuntime {
  constructor({ providers = {}, sessionStore, audit, allowedOrigins = new Set(), dynamicTabs = false,
    connect, now = () => Date.now(), maxRequests = 1024 } = {}) {
    if (!sessionStore || typeof audit !== 'function') fail('RUNTIME_DEPENDENCIES_REQUIRED');
    this.sessions = sessionStore;
    this.audit = audit;
    this.allowed = url => Boolean(webUrl(url)) && (dynamicTabs || allowedOrigins.has(new URL(url).origin));
    this.now = now;
    this.tabs = new TabRegistry({ now });
    this.pool = new ConnectionPool({ providers, connect, now,
      onInvalidated: (browser, epoch) => this.tabs.invalidate(browser, epoch) });
    this.requests = new Map();
    this.requestSessionHash = null;
    this.maxRequests = maxRequests;
    this.busy = new Set();
    this.hmacKey = crypto.randomBytes(32);
    this.metrics = { actions: 0, uncertain: 0, replays: 0, rejected: 0, total_action_ms: 0 };
  }
  status() {
    return { version: '2.0.0', ...this.pool.status(), metrics: { ...this.pool.metrics, ...this.metrics },
      native_fallback: 'automatic_tab_discovery', replay_guarantee: 'live_process_session_only',
      capabilities: ['persistent_tabs', 'aria_snapshot', 'role', 'label', 'test_id', 'screenshot', 'session_authorization'] };
  }
  async discover(input) {
    object(input, ['browser', 'title', 'exact'], ['browser']);
    browserName(input.browser);
    if (input.title !== undefined) boundedText(input.title, 300);
    if (input.exact !== undefined && typeof input.exact !== 'boolean') fail('INVALID_RUNTIME_REQUEST');
    const { connection, epoch } = await this.pool.get(input.browser);
    const pages = connection.contexts().flatMap(c => c.pages());
    const candidates = pages.filter(page => !page.isClosed() && this.allowed(page.url()));
    if (candidates.length > 256) fail('TAB_REGISTRY_CAPACITY');
    const tabs = [];
    for (const page of candidates) {
      let title;
      try { title = await page.title(); } catch { continue; } // a closed/loading tab is not a browser-wide failure
      if (input.title !== undefined && (input.exact === false
        ? !title.toLowerCase().includes(input.title.toLowerCase()) : title !== input.title)) continue;
      const record = this.tabs.register(input.browser, epoch, page);
      if (!this.allowed(record.rawUrl)) continue;
      tabs.push(this.tabs.describe(record, title));
    }
    return { browser: input.browser, provider_epoch: epoch, tabs, content_is_untrusted: true };
  }
  async resolve(input) {
    const record = this.tabs.resolve(input.browser, input.tab_ref);
    const slot = await this.pool.get(input.browser);
    if (record.epoch !== slot.epoch || !slot.connection.isConnected()) fail('STALE_TAB_REFERENCE');
    this.tabs.refresh(record);
    if (!this.allowed(record.rawUrl)) fail('TARGET_ORIGIN_DENIED');
    return record;
  }
  async inspect(input) {
    targetRequest(input);
    const r = await this.resolve(input);
    const revision = r.revision;
    const title = await r.page.title();
    const aria = await r.page.locator('body').ariaSnapshot({ timeout: TIMEOUT });
    this.tabs.refresh(r);
    if (r.page.isClosed() || revision !== r.revision) fail('STALE_PAGE_REVISION');
    r.inspectedAt = this.now();
    return { ...this.tabs.describe(r, title), aria: scrubContent(aria).slice(0, 24000),
      truncated: aria.length > 24000, content_is_untrusted: true,
      privacy: 'Page content may contain personal data; token/URL redaction is best-effort, not comprehensive.',
      revision_covers: 'document_navigation_and_full_url_changes' };
  }
  async screenshot(input) {
    targetRequest(input);
    const r = await this.resolve(input);
    const revision = r.revision;
    const png = await r.page.screenshot({ type: 'png', fullPage: false, timeout: TIMEOUT,
      mask: [r.page.locator('input[type="password"],input[autocomplete^="cc-"],[data-private]')] });
    this.tabs.refresh(r);
    if (revision !== r.revision) fail('STALE_PAGE_REVISION');
    if (png.length > 8_000_000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('INVALID_RUNTIME_SCREENSHOT');
    return { mime_type: 'image/png', base64: png.toString('base64'), revision: r.revision, tab_ref: r.ref };
  }
  authorize(input, consume = false) {
    try { return this.sessions.authorize(input.session_id, input.browser, { consume }); }
    catch (error) {
      if (['SESSION_NOT_ACTIVE', 'SESSION_SCOPE_MISMATCH'].includes(error?.message)) fail(error.message);
      fail('SESSION_AUTHORIZATION_FAILED');
    }
  }
  perform(input) {
    validateAction(input);
    this.authorize(input);
    // The shared host store has exactly one active grant. Once a different grant
    // is validated, old requests can no longer be replayed with valid authority.
    const sessionHash = digest(input.session_id);
    if (sessionHash !== this.requestSessionHash) {
      this.requests.clear();
      this.requestSessionHash = sessionHash;
    }
    const signature = crypto.createHmac('sha256', this.hmacKey).update(JSON.stringify({
      session: input.session_id, browser: input.browser, ref: input.tab_ref,
      revision: input.expected_revision, action: input.action,
      locator: { by: input.locator.by, role: input.locator.role, name: input.locator.name },
      value: input.value, key: input.key
    })).digest('hex');
    const prior = this.requests.get(input.request_id);
    if (prior) {
      if (prior.signature !== signature) fail('REQUEST_ID_CONFLICT');
      this.metrics.replays++;
      return prior.promise;
    }
    if (this.requests.size >= this.maxRequests) fail('REQUEST_LEDGER_CAPACITY');
    const entry = { signature, promise: null };
    // Reserve before any await; simultaneous calls with one request_id share the same result.
    entry.promise = Promise.resolve().then(() => this.execute(input));
    this.requests.set(input.request_id, entry);
    return entry.promise;
  }
  async execute(input) {
    if (this.busy.has(input.browser)) fail('BROWSER_BUSY');
    this.busy.add(input.browser);
    const started = this.now();
    let dispatched = false;
    let result;
    const event = { request_id: input.request_id, browser: input.browser,
      tab_ref: input.tab_ref, revision: input.expected_revision };
    try {
      this.authorize(input);
      const r = await this.resolve(input);
      if (r.revision !== input.expected_revision) fail('STALE_PAGE_REVISION');
      const spec = input.locator;
      const locator = spec.by === 'role' ? r.page.getByRole(spec.role, { name: spec.name, exact: true })
        : spec.by === 'label' ? r.page.getByLabel(spec.name, { exact: true }) : r.page.getByTestId(spec.name);
      await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
      if (await locator.count() !== 1) fail('AMBIGUOUS_LOCATOR');
      const type = String(await locator.getAttribute('type', { timeout: TIMEOUT }) || '').toLowerCase();
      const autocomplete = await locator.getAttribute('autocomplete', { timeout: TIMEOUT });
      if (['password', 'file'].includes(type) || /^(?:cc-|one-time-code)/i.test(autocomplete || '')) fail('PROTECTED_INPUT');
      // Append and fsync the intent before consuming authority or dispatching an event.
      try { await this.audit({ ...event, event: 'intent', outcome: 'prepared' }); }
      catch { fail('AUDIT_UNAVAILABLE'); }
      this.tabs.refresh(r);
      if (r.revision !== input.expected_revision || !this.allowed(r.rawUrl) || r.page.isClosed()) fail('STALE_PAGE_REVISION');
      const delegation = this.authorize(input, true);
      dispatched = true;
      if (input.action === 'click') await locator.click({ timeout: TIMEOUT });
      else if (input.action === 'fill') await locator.fill(input.value, { timeout: TIMEOUT });
      else if (input.action === 'select') await locator.selectOption(input.value, { timeout: TIMEOUT });
      else await locator.press(input.key, { timeout: TIMEOUT });
      this.tabs.refresh(r);
      result = { request_id: input.request_id, outcome: 'dispatched', tab_ref: r.ref,
        revision: r.revision, remaining_session_actions: delegation.remaining_actions,
        requires_business_verification: true };
      this.metrics.actions++;
    } catch (error) {
      if (!dispatched) {
        this.metrics.rejected++;
        throw error instanceof RuntimeFault ? error : new RuntimeFault('BROWSER_PRECONDITION_FAILED');
      }
      // A timeout/disconnect after dispatch does not prove that the event failed.
      // Never auto-retry or switch to a native coordinate fallback here.
      this.metrics.uncertain++;
      result = { request_id: input.request_id, outcome: 'uncertain',
        code: 'DISPATCH_OUTCOME_UNKNOWN', requires_business_verification: true, automatic_retry: false };
    } finally {
      this.busy.delete(input.browser);
      this.metrics.total_action_ms += this.now() - started;
    }
    try {
      const receipt = await this.audit({ ...event, event: 'result', outcome: result.outcome,
        duration_ms: this.now() - started });
      result.audit_receipt = receipt || 'recorded';
    } catch { result.audit_receipt = 'unavailable_after_dispatch'; }
    return result;
  }
  async close() { await this.pool.close(); this.hmacKey.fill(0); }
}

/**
 * Zero-configuration discovery: prefer existing running browser channels.
 * Manually configured loopback endpoints still take precedence; opting out
 * of automatic channel discovery remains possible for managed deployments.
 * Browser attachment is lazy: nothing launches or connects at service startup.
 */
export function providersFromEnvironment(environment) {
  const result = {};
  const auto = environment.COMPUTER_USE_BROWSER_AUTO_ATTACH !== 'false';
  const channels = { chrome: 'chrome', edge: 'msedge' };
  for (const browser of ['chrome', 'edge']) {
    const prefix = 'COMPUTER_USE_' + browser.toUpperCase() + '_';
    const explicit = environment[prefix + 'ENDPOINT'];
    const endpoint = explicit || (auto ? channels[browser] : undefined);
    if (!endpoint) continue;
    result[browser] = { endpoint, protocol: explicit
      ? environment[prefix + 'PROTOCOL'] || 'cdp' : 'cdp' };
  }
  return result;
}
