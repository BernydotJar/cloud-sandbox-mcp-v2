/** First-party MCP adapter for the macOS agent running beside Docker Desktop.
 *  The controller owns the bridge credential. Never expose it in a workstation. */
export class ComputerUseService {
    config;
    constructor(config) {
        this.config = config;
    }
    async status() {
        if (!this.config.COMPUTER_USE_ENABLED) {
            return { enabled: false, connected: false, reason: 'Operator has not enabled native Computer Use.' };
        }
        try {
            const host = await this.request('/v1/status', {});
            return { enabled: true, connected: true, host };
        }
        catch {
            return { enabled: true, connected: false, reason: 'Mac host service is not reachable or did not authenticate.' };
        }
    }
    async state(browser) {
        return this.request('/v1/state', browser ? { browser } : {});
    }
    async focus(target) {
        return this.request('/v1/focus', target);
    }
    async screenshot(target) {
        const result = await this.request('/v1/screenshot', target);
        if (result.mime_type !== 'image/png' || !result.base64 || result.base64.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(result.base64)) {
            throw new Error('Invalid or oversized image received from computer bridge.');
        }
        return { mimeType: 'image/png', data: result.base64 };
    }
    async action(input) {
        return this.request('/v1/action', input);
    }
    /** One local macOS approval grants bounded browser interaction for a task. */
    async beginSession(input) {
        return this.request('/v1/session/begin', input);
    }
    async sessionStatus() {
        return this.request('/v1/session/status', {});
    }
    async endSession(session_id) {
        return this.request('/v1/session/end', session_id ? { session_id } : {});
    }
    async request(path, body) {
        if (!this.config.COMPUTER_USE_ENABLED || !this.config.COMPUTER_USE_BRIDGE_TOKEN) {
            throw new Error('Native computer use disabled by operator.');
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), (path === '/v1/action' || path === '/v1/session/begin') ? 90_000 : 20_000);
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
            const result = await response.json();
            if (!response.ok || result.ok !== true) {
                // Only expose fixed-format diagnostic codes, never upstream raw error strings.
                const safeCode = typeof result.error === 'string' && /^[A-Z_]{3,50}$/.test(result.error)
                    ? result.error : 'REQUEST_REFUSED';
                throw new Error(`Computer bridge: ${safeCode}`);
            }
            return result.data;
        }
        catch (error) {
            // Do not include network headers, bridge token, submitted text or response body in errors.
            if (error instanceof Error && error.message.startsWith('Computer bridge'))
                throw error;
            throw new Error('Mac Computer Use bridge is unavailable or did not complete the request.');
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
//# sourceMappingURL=computer-use-service.js.map