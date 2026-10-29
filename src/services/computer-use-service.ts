import type { AppConfig } from '../config.js';

export type ComputerBrowser = 'chrome' | 'edge';
export type ComputerAction = 'click' | 'type_text' | 'press_key' | 'ax_press' | 'ax_set_value';
export type AxValueObservation =
  | {kind:'hours_numeric';value:string;has_value:true}
  | {kind:'boolean';value:boolean}
  | {kind:'empty';has_value:false}
  | {kind:'redacted';has_value:true};

function validAxValueObservation(v: unknown, role: string): v is AxValueObservation {
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const record=v as Record<string,unknown>;
  if(Object.keys(record).some(k=>!['kind','value','has_value'].includes(k)))return false;
  switch(record.kind) {
    case 'hours_numeric':
      return ['AXTextField','AXTextArea','AXComboBox'].includes(role) &&
        typeof record.value==='string' &&
        /^[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(record.value) &&
        Number(record.value)<=168 && record.has_value===true;
    case 'boolean':
      return ['AXCheckBox','AXRadioButton'].includes(role) &&
        typeof record.value==='boolean' && record.has_value===undefined;
    case 'empty':
      return record.value===undefined && record.has_value===false;
    case 'redacted':
      return record.value===undefined && record.has_value===true;
    default:return false;
  }
}

export type ComputerScreenshotGeometry = {
  coordinate_contract: 'mac-screen-points.v1';
  screenshot_ref: string;
  bounds_points: {x: number; y: number; width: number; height: number};
  image_pixels: {width: number; height: number};
  scale: {x: number; y: number};
  expires_in_ms: number;
};

export interface BrowserTarget {
  browser: ComputerBrowser;
  /** true prohibits focus-changing native CUA operations on the shared Mac desktop. */
  background_required?: boolean;
  window_index: number;
  tab_index: number;
  expected_url: string;
  expected_title: string;
}

export interface ActionRequest extends BrowserTarget {
  action: ComputerAction;
  x?: number;
  y?: number;
  coordinate_space?: 'screen_points' | 'screenshot_pixels';
  screenshot_ref?: string;
  ax_node_ref?: string;
  ax_revision?: string;
  text?: string;
  key?: 'tab' | 'escape' | 'enter' | 'space' | 'backspace' | 'up' | 'down' | 'left' | 'right';
  reason: string;
  session_id?: string;
}

/** First-party MCP adapter for the macOS agent running beside Docker Desktop.
 *  The controller owns the bridge credential. Never expose it in a workstation. */
export class ComputerUseService {
  constructor(private readonly config: Pick<AppConfig,
    'COMPUTER_USE_ENABLED' | 'COMPUTER_USE_BRIDGE_URL' | 'COMPUTER_USE_BRIDGE_TOKEN'>) {}

  async backgroundRequest(route:string,input:unknown) {
    if(!['status','windows','snapshot','action'].includes(route))throw Error('BACKGROUND_ROUTE_DENIED');
    return this.request('/v1/background/'+route,input);
  }

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

  private enforceBrowserTargetIdentity(target: BrowserTarget): void {
    if (typeof target.expected_title !== 'string' ||
        target.expected_title.trim().length < 1 ||
        target.expected_title.length > 300 ||
        !Number.isSafeInteger(target.window_index) || target.window_index < 1 ||
        !Number.isSafeInteger(target.tab_index) || target.tab_index < 1) {
      // Reject before accessing the Mac; do not weaken the host's revalidation.
      throw new Error('Computer bridge: EXPECTED_TITLE_REQUIRED');
    }
  }

  async focus(target: BrowserTarget) {
    this.enforceBrowserTargetIdentity(target);
    return this.request('/v1/focus', target);
  }

  async screenshot(target: BrowserTarget, options?:{include_ax?: boolean}): Promise<{
    mimeType: 'image/png'; data: string; geometry?: ComputerScreenshotGeometry;
    ax_snapshot?: {
      provider:'native_ax';ax_revision:string;expires_in_ms:number;
      nodes:Array<{node_ref:string;role:string;name:string;enabled:boolean;
        parent_path?:number[]|null;frame_points?:{x:number;y:number;width:number;height:number};
          value_observation?:AxValueObservation}>
    }
  }> {
    this.enforceBrowserTargetIdentity(target);
    const result = await this.request('/v1/screenshot',
      {...target,...(options?.include_ax?{include_ax:true}:{})}) as {
      mime_type?: string; base64?: string; geometry?: ComputerScreenshotGeometry;
      ax_snapshot?: {
        provider:'native_ax';ax_revision:string;expires_in_ms:number;
        nodes:Array<{node_ref:string;role:string;name:string;enabled:boolean;
          parent_path?:number[]|null;frame_points?:{x:number;y:number;width:number;height:number};
          value_observation?:AxValueObservation}>
      }
    };
    if (result.mime_type !== 'image/png' || !result.base64 || result.base64.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(result.base64)) {
      throw new Error('Invalid or oversized image received from computer bridge.');
    }
    const geo=result.geometry;
    if(geo !== undefined && (
      geo?.coordinate_contract!=='mac-screen-points.v1' ||
      typeof geo.screenshot_ref!=='string' || !/^[a-f0-9]{64}$/.test(geo.screenshot_ref) ||
      !Object.values(geo.bounds_points||{}).every(Number.isFinite) ||
      !['x','y','width','height'].every(k=>Number.isInteger(geo.bounds_points?.[k as keyof typeof geo.bounds_points])) ||
      !Number.isSafeInteger(geo.image_pixels?.width) || !Number.isSafeInteger(geo.image_pixels?.height) ||
      geo.image_pixels.width<=0 || geo.image_pixels.height<=0 ||
      !Number.isFinite(geo.scale?.x) || !Number.isFinite(geo.scale?.y) ||
      geo.scale.x<=0 || geo.scale.y<=0 || !Number.isInteger(geo.expires_in_ms) ||
      geo.expires_in_ms<1 || geo.expires_in_ms>60000
    ))throw new Error('Invalid screenshot geometry from computer bridge.');
    const ax=result.ax_snapshot;
    if(ax!==undefined && (ax.provider!=='native_ax' ||
      !/^[a-f0-9]{64}$/.test(String(ax.ax_revision)) ||
      !Number.isInteger(ax.expires_in_ms) || ax.expires_in_ms<1 || ax.expires_in_ms>60000 ||
      !Array.isArray(ax.nodes) || ax.nodes.length>450 ||
      ax.nodes.some(n=>!n || !/^[a-f0-9]{64}$/.test(n.node_ref) ||
        typeof n.role!=='string'||n.role.length>50||
        typeof n.name!=='string'||n.name.length>120||typeof n.enabled!=='boolean'||
        (n.value_observation!==undefined &&
          !validAxValueObservation(n.value_observation,n.role)))))
      throw new Error('Invalid AX snapshot received from computer bridge.');
    return { mimeType: 'image/png', data: result.base64,
      ...(geo?{geometry:geo}:{}),...(ax?{ax_snapshot:ax}:{}) };
  }

  async action(input: ActionRequest) {
    this.enforceBrowserTargetIdentity(input);
    return this.request('/v1/action', input);
  }

  /** A scoped task grant; trusted Mac configuration may bypass the modal and action quota, never the expiry or allowlist. */
  async beginSession(input: {
    scope: 'chrome' | 'edge' | 'both';
    duration_minutes: number;
    max_actions: number;
    purpose: string;
  }) {
    return this.request('/v1/session/begin', input);
  }

  async sessionStatus() {
    return this.request('/v1/session/status', {});
  }

  async endSession(session_id?: string) {
    return this.request('/v1/session/end', session_id ? { session_id } : {});
  }

  async browserRuntime(operation: 'status' | 'tabs' | 'inspect' | 'screenshot' | 'action' | 'open', input: Record<string, unknown>) {
    return this.request('/v2/browser/' + operation, input);
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    if (!this.config.COMPUTER_USE_ENABLED || !this.config.COMPUTER_USE_BRIDGE_TOKEN) {
      throw new Error('Native computer use disabled by operator.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (path === '/v1/action' || path === '/v1/session/begin') ? 90_000 : path.startsWith('/v2/browser/') ? 45_000 : 20_000);
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
