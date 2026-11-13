import { EventEmitter } from 'node:events';
import { createSessionStore } from '../autonomy-session.mjs';
import { BrowserRuntime } from './runtime.mjs';

export class FakePage extends EventEmitter {
  constructor(url = 'https://luma.example/learn', title = 'LUMA') {
    super(); this.urlValue = url; this.titleValue = title; this.closed = false;
    this.frame = {}; this.calls = []; this.nodes = new Map(); this.aria = '- button "Start"';
    this.text = 'Learner dashboard'; this.ariaError = false; this.textError = false;
  }
  url() { return this.urlValue; }
  async title() { return this.titleValue; }
  isClosed() { return this.closed; }
  mainFrame() { return this.frame; }
  navigate(url) { this.urlValue = url; this.emit('framenavigated', this.frame); }
  closeTab() { this.closed = true; this.emit('close'); }
  locator() { return {
    ariaSnapshot: async () => { if (this.ariaError) throw Error('Private snapshot error'); return this.aria; },
    innerText: async () => { if (this.textError) throw Error('Private DOM read error'); return this.text; }
  }; }
  getByRole(role, { name, exact }) { if (!exact) throw Error('Expected exact locator'); return this.node(name, role); }
  getByLabel(name) { return this.node(name); }
  getByTestId(name) { return this.node(name); }
  node(name, role) {
    const node = this.nodes.get(name) || {};
    return {
      waitFor: async () => { if (node.before) await node.before(); },
      count: async () => node.count ?? 1,
      getAttribute: async attr => node[attr] || null,
      click: async () => { this.calls.push({ name, role, op: 'click' }); if (node.effect) await node.effect(); },
      fill: async value => { this.calls.push({ name, op: 'fill', value }); if (node.effect) await node.effect(); },
      press: async key => { this.calls.push({ name, op: 'press', key }); if (node.effect) await node.effect(); },
      selectOption: async value => { this.calls.push({ name, op: 'select', value }); if (node.effect) await node.effect(); }
    };
  }
}
export class FakeConnection extends EventEmitter {
  constructor(pages = [new FakePage()]) { super(); this.pages = pages; this.connected = true; this.closeCount = 0; }
  isConnected() { return this.connected; }
  contexts() { return [{ pages: () => this.pages }]; }
  async close() { this.closeCount++; this.connected = false; this.emit('disconnected'); }
}
export function fixture(options = {}) {
  let time = 10_000;
  const now = () => time;
  const sessionStore = createSessionStore({ now });
  const session = sessionStore.begin({ scope: options.scope || 'both', duration_minutes: 10,
    max_actions: options.maxActions || 120, purpose: 'Isolated test fixture; never a user browser' });
  const page = new FakePage();
  const connection = new FakeConnection([page]);
  let connections = 0;
  const events = [];
  const runtime = new BrowserRuntime({
    providers: { chrome: { endpoint: 'http://127.0.0.1:9222' }, edge: { endpoint: 'http://127.0.0.1:9224' } },
    sessionStore, dynamicTabs: true, now,
    connect: async () => { connections++; return connection; },
    audit: async entry => { events.push(entry); return { recorded: true }; }, ...options
  });
  return { runtime, sessionStore, session, page, connection, events,
    connections: () => connections, advance: ms => { time += ms; } };
}
export async function actionFor(f, overrides = {}) {
  const tab = (await f.runtime.discover({ browser: 'chrome' })).tabs[0];
  return { browser: 'chrome', tab_ref: tab.tab_ref, expected_revision: tab.revision,
    session_id: f.session.session_id, request_id: 'operation-request-0001',
    action: 'click', locator: { by: 'role', role: 'button', name: 'Start' }, ...overrides };
}
