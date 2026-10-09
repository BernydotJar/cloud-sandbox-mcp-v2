import type { AppConfig } from '../config.js';

export type ComputerBrowser = 'chrome' | 'edge';
export type ComputerAction = 'click' | 'type_text' | 'press_key';

export interface BrowserTarget {
  browser: ComputerBrowser;
  window_index: number;
  tab_index: number;
  expected_url: string;
}

export interface ActionRequest extends BrowserTarget {
  action: ComputerAction;
  x?: number;
  y?: number;
  text?: string;
  key?: 'tab' | 'escape' | 'enter' | 'space' | 'backspace' | 'up' | 'down' | 'left' | 'right';
  reason: string;
}

/** First-party MCP adapter for the macOS agent running beside Docker Desktop.
 *  The controller owns the bridge credential. Never expose it in a workstation. */
export class ComputerUseService {
  constructor(private readonly config: Pick<AppConfig,
    'COMPUTER_USE_ENABLED' | 'COMPUTER_USE_BRIDGE_URL' | 'COMPUTER_USE_BRIDGE_TOKEN'>) {}

  async status() {
    if (!this.config.COMPUTER_USE_ENABLED) {
      return { enabled: false, connected: false, reason: 'Operator has not enabled native Computer Use.' };
    }
    try {
      const host = await this.request('/v1/status', {});
      return { enabled: true, connected: true, host };
    } catch {
      return { enabled: true, connected: false, reason: 'Mac host service is not reachable or did not authenticate.' };
    }
  }

  async state(browser?: ComputerBrowser) {
    return this.request('/v1/state', browser ? { browser } : {});
  }

  async focus(target: BrowserTarget) {
    return this.request('/v1/focus', target);
  }

  async screenshot(target: BrowserTarget): Promise<{ mimeType: 'image/png'; data: string }> {
    const result = await this.request('/v1/screenshot', target) as { mime_type?: string; base64?: string };
    if (result.mime_type !== 'image/png' || !result.base64 || result.base64.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(result.base64)) {
      throw new Error('Invalid or oversized image received from computer bridge.');
    }
    return { mimeType: 'image/png', data: result.base64 };
  }

  async action(input: ActionRequest) {
    return this.request('/v1/action', input);
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    if (!this.config.COMPUTER_USE_ENABLED || !this.config.COMPUTER_USE_BRIDGE_TOKEN) {
      throw new Error('Native computer use disabled by operator.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), path === '/v1/action' ? 90_000 : 20_000);
    try {
      const response = await fetch(new URL(path, this.config.COMPUTER_USE_BRIDGE_URL), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.config.COMPUTER_USE_BRIDGE_TOKEN}`
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error'
      });
      const result = await response.json() as { ok?: boolean; data?: unknown; error?: string };
      if (!response.ok || result.ok !== true) {
        // Only expose fixed-format diagnostic codes, never upstream raw error strings.
        const safeCode = typeof result.error === 'string' && /^[A-Z_]{3,50}$/.test(result.error)
          ? result.error : 'REQUEST_REFUSED';
        throw new Error(`Computer bridge: ${safeCode}`);
      }
      return result.data;
    } catch (error) {
      // Do not include network headers, bridge token, submitted text or response body in errors.
      if (error instanceof Error && error.message.startsWith('Computer bridge')) throw error;
      throw new Error('Mac Computer Use bridge is unavailable or did not complete the request.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
