import crypto from 'node:crypto';
import { fail, webUrl } from './contracts.mjs';

/** Page-object identity, not indices or page titles. Handles die on close/reconnect. */
export class TabRegistry {
  constructor({ now = () => Date.now(), ttlMs = 15 * 60_000, maxTabs = 256 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxTabs = maxTabs;
    this.byRef = new Map();
    this.byPage = new WeakMap();
  }
  forget(record) {
    record.page.off('close', record.onClose);
    record.page.off('framenavigated', record.onNavigation);
    this.byRef.delete(record.ref);
    if (this.byPage.get(record.page) === record) this.byPage.delete(record.page);
  }
  prune() {
    for (const record of this.byRef.values()) {
      if (record.page.isClosed() || this.now() - record.touched > this.ttlMs) this.forget(record);
    }
  }
  invalidate(browser, epoch) {
    for (const record of this.byRef.values()) {
      if (record.browser === browser && record.epoch === epoch) this.forget(record);
    }
  }
  register(browser, epoch, page) {
    this.prune();
    let record = this.byPage.get(page);
    if (record && (record.epoch !== epoch || record.browser !== browser)) { this.forget(record); record = null; }
    if (!record) {
      if (this.byRef.size >= this.maxTabs) fail('TAB_REGISTRY_CAPACITY');
      record = { browser, epoch, page, ref: 'tab_' + crypto.randomBytes(16).toString('hex'),
        revision: 1, rawUrl: page.url(), touched: this.now(), inspectedAt: 0 };
      record.onClose = () => this.forget(record);
      record.onNavigation = frame => {
        if (frame === page.mainFrame()) { record.revision++; record.rawUrl = page.url(); record.inspectedAt = 0; }
      };
      page.on('close', record.onClose);
      page.on('framenavigated', record.onNavigation);
      this.byRef.set(record.ref, record);
      this.byPage.set(page, record);
    }
    this.refresh(record);
    record.touched = this.now();
    return record;
  }
  refresh(record) {
    if (record.page.url() !== record.rawUrl) {
      record.rawUrl = record.page.url(); record.revision++; record.inspectedAt = 0;
    }
  }
  resolve(browser, ref) {
    this.prune();
    const record = this.byRef.get(ref);
    if (!record || record.browser !== browser || record.page.isClosed()) fail('STALE_TAB_REFERENCE');
    this.refresh(record);
    record.touched = this.now();
    return record;
  }
  describe(record, title) {
    return { browser: record.browser, tab_ref: record.ref, revision: record.revision,
      title: String(title).slice(0, 300), url: webUrl(record.rawUrl), provider_epoch: record.epoch };
  }
}
