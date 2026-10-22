import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSessionStore } from './autonomy-session.mjs';
import { BrowserRuntime, providersFromEnvironment } from './browser-runtime/runtime.mjs';
import { AuditLedger } from './browser-runtime/audit-ledger.mjs';
import { RuntimeFault } from './browser-runtime/contracts.mjs';
import os from 'node:os';
import {parseAllowedBundles, validateDesktopConfig, requireAllowedBundle, validateDesktopTarget, requireDesktopSession, validateMutation, createDesktopRequestGate, desktopAudit} from './desktop-policy.mjs';
import {createDesktopRoutes,desktopPaths,desktopError} from './desktop-routes.mjs';
import {parseAllowedBundles} from './desktop-policy.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const nativeFile = path.join(here, 'native.jxa');
const desktopFile = path.join(here, 'desktop.jxa');
async function macNative(...args) {
  const {stdout} = await exec('/usr/bin/osascript',['-l','JavaScript',desktopFile,...args],{timeout:15000,maxBuffer:300000});
  const result=JSON.parse(stdout.trim());
  if (!result.ok) throw new Error(result.error || 'MAC_NATIVE_UNAVAILABLE');
  return result.data;
}
const browsers = new Set(['chrome', 'edge']);
const keys = new Set(['tab','escape','enter','space','backspace','up','down','left','right']);
const launchBundles = Object.freeze({ chrome:'com.google.Chrome', edge:'com.microsoft.edgemac' });
const attachFallbackCodes = new Set(['BROWSER_PROVIDER_NOT_CONFIGURED','BROWSER_ATTACH_FAILED',
  'BROWSER_ATTACH_COOLDOWN','BROWSER_ENDPOINT_UNAVAILABLE','PLAYWRIGHT_DEPENDENCY_UNAVAILABLE']);

async function launchBrowser(name) {
  if (!Object.hasOwn(launchBundles,name)) throw new Error('INVALID_BROWSER');
  // -b selects a fixed installed bundle ID. No user-supplied paths, URLs, flags,
  // shells, new profiles, or WebSocket debugging ports.
  try {
    await exec('/usr/bin/open',['-b',launchBundles[name]],{timeout:15000,maxBuffer:2000});
  }catch { throw new Error('BROWSER_APP_UNAVAILABLE'); }
}

// LCH_DEDICATED_CHROME_AUTOSTART_V3
async function ensureDedicatedChrome() {
  const profile = path.join(os.homedir(), '.ido-chrome-bridge', 'profile');
  const port = 9223;
  const endpoint = 'http://127.0.0.1:' + port + '/json/version';
  const owner = async () => {
    try {
      const {stdout} = await exec('/usr/sbin/lsof',
        ['-n','-P','-t','-iTCP:' + port,'-sTCP:LISTEN'],
        {timeout:3000,maxBuffer:1500});
      const pids = [...new Set(stdout.trim().split(/\s+/).filter(x => /^\d+$/.test(x)))].slice(0,5);
      if (pids.length !== 1) return {occupied:pids.length>0, trusted:false};
      const details = await exec('/bin/ps',
        ['-p',pids[0],'-o','command='],{timeout:3000,maxBuffer:15000});
      const command = details.stdout;
      return {occupied:true, trusted:command.includes('--remote-debugging-port=9223') &&
        command.includes('--user-data-dir=' + profile)};
    } catch { return {occupied:false,trusted:false}; }
  };
  const health = async () => {
    try {
      const response = await fetch(endpoint,{signal:AbortSignal.timeout(1800)});
      if (!response.ok) return false;
      const body = await response.json();
      return typeof body?.Browser === 'string' &&
        body.Browser.startsWith('Chrome/') &&
        typeof body.webSocketDebuggerUrl === 'string';
    } catch { return false; }
  };
  const current = await owner();
  // Fail closed if a CDP server responds but its owner cannot be proven.
  if (!current.occupied && await health()) return {ready:false,started:false};
  if (current.occupied) return {ready:current.trusted && await health(),started:false};
  const parent = path.dirname(profile);
  await fs.mkdir(parent,{recursive:true,mode:0o700});
  const parentStat = await fs.lstat(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) return {ready:false,started:false};
  await fs.chmod(parent,0o700);
  await fs.mkdir(profile,{recursive:true,mode:0o700});
  const stat = await fs.lstat(profile);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return {ready:false,started:false};
  await fs.chmod(profile,0o700);
  try {
    await exec('/usr/bin/open',['-na','Google Chrome','--args',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9223',
      '--user-data-dir=' + profile,
      '--no-first-run','--no-default-browser-check'],
      {timeout:12000,maxBuffer:3000});
  } catch { return {ready:false,started:false}; }
  for (let i=0; i<24; i++) {
    await sleep(450);
    const check = await owner();
    if (check.occupied && check.trusted && await health()) return {ready:true,started:true};
    if (check.occupied && !check.trusted) return {ready:false,started:true};
  }
  return {ready:false,started:true};
}

// LCH_BRIDGE_READY_TOAST_V1
async function showDedicatedChromeToast() {
  const executable=path.join(os.homedir(),
    'Library/Application Support/LCH/CloudSandboxComputerUse/ux/bridge-toast');
  try { await exec(executable,[],{timeout:10000,maxBuffer:512}); }
  catch { /* Visual confirmation is optional; browser operation is unaffected. */ }
}

export function nativeDiscoveryFallback(browser, state, input, dynamicTabs, origins, reason = 'PERSISTENT_BROWSER_UNAVAILABLE') {
  const titleFilter=input.title;
  const exact=input.exact!==false;
  const tabs=[];
  if(state?.running)for(const window of (state.windows||[])) {
    for(const tab of (window.tabs||[])) {
      const url=safeUrl(tab.url);
      if(!url || (!dynamicTabs && !isAllowlistedTabUrl(url,origins)))continue;
      const title=String(tab.title||'').slice(0,300);
      if(!title || !Number.isInteger(window.window_index) || !Number.isInteger(tab.tab_index))
        continue;
      if(titleFilter && (exact?title!==titleFilter:
        !title.toLocaleLowerCase().includes(titleFilter.toLocaleLowerCase())))continue;
      tabs.push({title,url,active:Boolean(tab.active),
        native_target:{browser,window_index:window.window_index,tab_index:tab.tab_index,
          expected_title:title,expected_url:url}});
      if(tabs.length>=256)break;
    }
    if(tabs.length>=256)break;
  }
  // Unknown macOS state is not proof that the browser is closed. Do not launch
  // a second browser when Automation permission/discovery is unavailable.
  const running = state?.running === true ? true : state?.running === false ? false : null;
  return {
    browser,provider:'native',semantic_available:false,
    ...(reason === 'NATIVE_FIRST' ? {selection_reason:'NATIVE_FIRST_NO_DEBUGGING'} :
      {fallback_reason:'PERSISTENT_BROWSER_UNAVAILABLE'}),
    running,launch_available:running === false,
    tabs,
    next_step:running === true ? 'Use computer_use_screenshot and computer_use_action with native_target' :
      running === false ? 'Call browser_open to launch the existing browser profile' :
      'Check macOS Automation permission and retry tab discovery'
  };
}

export function browserRoutingFromEnvironment(environment) {
  const mode = environment.COMPUTER_USE_BROWSER_ROUTING || 'native_first';
  if (!['native_first','prefer_persistent'].includes(mode)) throw new Error('INVALID_BROWSER_ROUTING');
  return mode;
}

function validateDiscoveryRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['browser','title','exact'].includes(key)) ||
      !browsers.has(input.browser) ||
      (input.title !== undefined && (typeof input.title !== 'string' ||
        input.title.length < 1 || input.title.length > 300)) ||
      (input.exact !== undefined && typeof input.exact !== 'boolean')) {
    throw new RuntimeFault('INVALID_RUNTIME_REQUEST');
  }
}


export function safeUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return '';
    return u.origin + u.pathname;
  } catch { return ''; }
}
export function isAllowlistedTabUrl(value, origins) {
  const cleaned = safeUrl(value);
  if (!cleaned) return false;
  try { return origins.has(new URL(cleaned).origin); }
  catch { return false; }
}
export function allowedPeer(ip) {
  const x = String(ip || '').replace(/^::ffff:/,'');
  return x === '::1' || x === '127.0.0.1' || /^192\.168\.(64|65)\.\d+$/.test(x);
}
function authorized(header, expected) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
async function native(op, ...args) {
  const {stdout} = await exec('/usr/bin/osascript', ['-l','JavaScript', nativeFile, op,...args], {
    timeout: 12000, maxBuffer: 300000
  });
  const result = JSON.parse(stdout.trim());
  if (result.ok !== true) throw new Error(result.error || 'NATIVE_FAILED');
  return result.data;
}
function verifyTarget(t, origins, dynamicTabs, restrictMutation = false) {
  if (!browsers.has(t.browser) || !Number.isInteger(t.window_index) ||
      !Number.isInteger(t.tab_index) || t.window_index < 1 || t.tab_index < 1 ||
      typeof t.expected_url !== 'string' || safeUrl(t.expected_url) !== t.expected_url ||
      (!dynamicTabs && !origins.has(new URL(t.expected_url).origin))) throw new Error('INVALID_TARGET');
  if (restrictMutation && !origins.has(new URL(t.expected_url).origin)) {
    throw new Error('MUTATION_ORIGIN_DENIED');
  }
  // In dynamic discovery, identical safe URLs may belong to different tabs.
  // Bind actions to the freshly observed title as well as index and URL.
  if (dynamicTabs && (typeof t.expected_title !== 'string' ||
      !t.expected_title.length || t.expected_title.length > 300)) {
    throw new Error('EXPECTED_TITLE_REQUIRED');
  }
  if (t.expected_title !== undefined && (typeof t.expected_title !== 'string' ||
      t.expected_title.length > 300)) throw new Error('INVALID_TARGET');
  return [t.browser, String(t.window_index), String(t.tab_index),
    t.expected_url, t.expected_title || ''];
}
function reply(res, status, data) {
  res.writeHead(status, {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}

const confirmScript = "function run(argv) { var a=Application.currentApplication(); a.includeStandardAdditions=true;" +
  "try {var r=a.displayDialog(argv[0], {buttons:['Deny','Approve'], defaultButton:'Deny'," +
  "withIcon:'caution', givingUpAfter:60});" +
  "return r.buttonReturned==='Approve' && !r.gaveUp ? 'approved' : 'denied';} " +
  "catch (_) {return 'denied';}}";

async function approve(message) {
  const {stdout} = await exec('/usr/bin/osascript',
    ['-l','JavaScript','-e',confirmScript,message], {timeout: 70000, maxBuffer: 2000});
  return stdout.trim() === 'approved';
}
async function capture(bounds) {
  const {default: os} = await import('node:os');
  const {x,y,width,height} = bounds;
  if (![x,y,width,height].every(v => Number.isFinite(v) && v >= 0) ||
      width < 1 || height < 1 || width > 5000 || height > 4000) throw new Error('INVALID_BOUNDS');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-mac-capture-'));
  const file = path.join(dir, 'window.png');
  try {
    const rectangle = [x,y,width,height].map(Math.round).join(',');
    await exec('/usr/sbin/screencapture',
      ['-x','-t','png','-R',rectangle,file], {timeout: 15000, maxBuffer: 1000});
    const png = await fs.readFile(file);
    if (png.length < 8 || png.length > 8000000 || png.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('SCREENSHOT_UNAVAILABLE');
    }
    return {mime_type:'image/png',base64:png.toString('base64')};
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}

/** Injectable native/approval handlers make safety gates testable without a Mac. */
export function createBridgeServer({token, allowedOrigins, dynamicTabs = false,
                                   restrictBrowserWrites = false, nativeHandler = native,
                                   approvalHandler = approve, captureHandler = capture,
                                   auditHandler = async () => {}, platform = process.platform,
                                   sessionStore = createSessionStore(), browserProviders = {},
                                   enableBrowserRuntime = false, browserAudit = auditHandler,
                                   browserRouting = 'native_first',
                                   launchBrowserHandler = launchBrowser, dedicatedChromeAutoStart = false,
                                   ensureDedicatedChromeHandler = ensureDedicatedChrome,
                                   bridgeToastEnabled = false,
                                   bridgeToastHandler = showDedicatedChromeToast,
                                   desktopEnabled = false, desktopAllowedBundles = new Set(),
                                   desktopNativeHandler, desktopLaunchHandler}) {
  validateDesktopConfig({enabled:desktopEnabled,allowedBundles:desktopBundles});
  if (platform !== 'darwin') throw new Error('MACOS_REQUIRED');
  if (typeof token !== 'string' || token.length < 32) throw new Error('TOKEN_REQUIRED');
  if (typeof dynamicTabs !== 'boolean') throw new Error('INVALID_DISCOVERY_MODE');
  if (typeof restrictBrowserWrites !== 'boolean') throw new Error('INVALID_MUTATION_POLICY');
  if (!['native_first','prefer_persistent'].includes(browserRouting))
    throw new Error('INVALID_BROWSER_ROUTING');
  if (!(allowedOrigins instanceof Set) || !allowedOrigins.size ||
      [...allowedOrigins].some(v => !v.startsWith('https://') || new URL(v).origin !== v)) {
    throw new Error('EXPLICIT_HTTPS_ALLOWLIST_REQUIRED');
  }
  const runtime = enableBrowserRuntime ? new BrowserRuntime({ providers: browserProviders,
    sessionStore, audit: browserAudit, dynamicTabs, allowedOrigins,
    restrictMutationsToAllowlist: restrictBrowserWrites }) : null;
  const desktopRoute = desktopEnabled ? createDesktopRoutes({allowedBundles:desktopAllowedBundles,
    sessionStore,auditHandler,...(desktopNativeHandler?{nativeHandler:desktopNativeHandler}:{}),
    ...(desktopLaunchHandler?{launchHandler:desktopLaunchHandler}:{})}) : null;
  const desktopRequests = createDesktopRequestGate();
  let busy = false;
  let bridgeToastShown = false;
  const routingMetrics = { native_discoveries:0, persistent_discoveries:0,
    persistent_fallbacks:0, native_discovery_failures:0 };
  const server = http.createServer(async (req, res) => {
    if (!allowedPeer(req.socket.remoteAddress) || !authorized(req.headers.authorization, token)) {
      reply(res, 403, {ok:false,error:'UNAUTHORIZED'}); return;
    }
    if (req.method !== 'POST' ||
        !['/v1/status','/v1/state','/v1/focus','/v1/action','/v1/screenshot',
          '/v1/session/begin','/v1/session/status','/v1/session/end',
          '/v2/browser/status','/v2/browser/tabs','/v2/browser/inspect',
          '/v2/browser/screenshot','/v2/browser/action','/v2/browser/open',
          ...desktopPaths].includes(req.url)) {
      reply(res, 404, {ok:false,error:'UNKNOWN_METHOD'}); return;
    }
    try {
      let length = 0;
      const buffers = [];
      for await (const bytes of req) {
        length += bytes.length;
        if (length > 16384) throw new Error('REQUEST_TOO_LARGE');
        buffers.push(bytes);
      }
      const input = JSON.parse(Buffer.concat(buffers).toString('utf8'));
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_BODY');
      if (desktopPaths.has(req.url)) {
        if (!desktopRoute) throw new Error('MAC_DESKTOP_DISABLED');
        if (busy) throw new Error('COMPUTER_BUSY');
        busy=true;
        try {
          const result=await desktopRoute(req.url,input);
          reply(res,200,{ok:true,data:result});return;
        } finally {busy=false;}
      }
      if (req.url === '/v3/mac') {
        if (!desktopEnabled) throw new Error('MAC_DESKTOP_DISABLED');
        const operation=input.operation;
        if (!['apps','windows','tree','bounds','screenshot','focus','launch','action'].includes(operation))
          throw new Error('INVALID_MAC_OPERATION');
        if (operation==='apps') {
          reply(res,200,{ok:true,data:{applications:(await desktopHandler('apps','')).filter(
            a=>desktopBundles.has(a.bundle_id))}});return;
        }
        requireAllowedBundle(input.bundle_id,desktopBundles);
        if (operation==='windows') {
          const result=await desktopHandler('windows',input.bundle_id);
          reply(res,200,{ok:true,data:result});return;
        }
        if (operation==='launch' || operation==='focus' || operation==='action') {
          if (busy) throw new Error('COMPUTER_BUSY');
          requireDesktopSession(input);
          if (operation==='action') validateMutation(input,desktopBundles);
          else {
            if (typeof input.request_id!=='string'|| !/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/.test(input.request_id) ||
                typeof input.reason!=='string'||input.reason.length<10||input.reason.length>300)
              throw new Error('INVALID_MAC_ACTION');
            if(operation==='focus')validateDesktopTarget(input,desktopBundles);
          }
          sessionStore.authorize(input.session_id,'mac');
          busy=true;
          try {
            const args=operation==='launch'?[input.bundle_id]:validateDesktopTarget(input,desktopBundles);
            await auditHandler(desktopAudit(input,'intent'));
            sessionStore.authorize(input.session_id,'mac',{consume:true});
            desktopRequests.claim(input.request_id);
            const result=await desktopHandler(operation==='action'?'action':operation,...args,
              ...(operation==='action'?validateMutation(input,desktopBundles).slice(4):[]));
            let saved=true;
            try{await auditHandler(desktopAudit(input,'dispatched'));}catch{saved=false;}
            reply(res,200,{ok:true,data:{...result,audit_receipt:saved?'saved':'unavailable'}});return;
          } finally {busy=false;}
        }
        const args=validateDesktopTarget(input,desktopBundles);
        if (busy) throw new Error('COMPUTER_BUSY');
        busy=true;
        try{
          const result=await desktopHandler(operation==='screenshot'?'bounds':operation,...args);
          if(operation==='screenshot'){
            reply(res,200,{ok:true,data:await captureHandler(result)});
          }else reply(res,200,{ok:true,data:result});
          return;
        } finally {busy=false;}
      }
      if (req.url.startsWith('/v2/browser/')) {
        if (req.url === '/v2/browser/status') {
          reply(res, 200, {ok:true, data:runtime ? {enabled:true,...runtime.status(),
            browser_routing:browserRouting, cdp_attach_enabled:browserRouting === 'prefer_persistent',
            routing_metrics:{...routingMetrics}} :
            {enabled:false, version:'2.0.0', native_fallback:'explicit_only'}}); return;
        }
        if (!runtime) throw new RuntimeFault('BROWSER_RUNTIME_DISABLED');
        if (req.url === '/v2/browser/open') {
          if (Object.keys(input).some(k=>!['browser','reason'].includes(k)) ||
              !browsers.has(input.browser) || typeof input.reason!=='string' ||
              input.reason.length<10 || input.reason.length>300)
            throw new RuntimeFault('INVALID_RUNTIME_REQUEST');
          if (busy)throw new RuntimeFault('COMPUTER_BUSY');
          busy=true;
          try {
            const before=await nativeHandler('state',input.browser);
            if (before?.running){
              reply(res,200,{ok:true,data:{browser:input.browser,already_running:true,
                launched:false,next_step:'browser_tabs'}});return;
            }
            try{await browserAudit({event:'browser_open',browser:input.browser,
              outcome:'intent'});}catch{throw new RuntimeFault('AUDIT_UNAVAILABLE');}
            await launchBrowserHandler(input.browser);
            let running=false;
            for(let attempt=0;attempt<16;attempt++){
              const current=await nativeHandler('state',input.browser);
              if(current?.running){running=true;break;}
              await sleep(400);
            }
            const launched={browser:input.browser,launched:running,
              next_step:running?'browser_tabs':'retry browser_tabs after the browser finishes opening'};
            try{await browserAudit({event:'browser_open',browser:input.browser,
              outcome:running?'launched':'pending'});}catch{ /* An attempted launch must not be retried solely for failed audit. */ }
            reply(res,200,{ok:true,data:launched});return;
          }finally{busy=false;}
        }
        let result;
        if (req.url === '/v2/browser/action') {
          // One writer across BOTH backends: a semantic mutation must not race a native UI event.
          if (busy) throw new RuntimeFault('COMPUTER_BUSY');
          busy=true;
          try { result=await runtime.perform(input); } finally { busy=false; }
        } else if (req.url === '/v2/browser/tabs') {
          // Daily authenticated browsers use native macOS discovery without CDP.
          // No attempt to enable browser debugging, inspect internal browser URLs,
          // or attach a debugger unless the operator explicitly opts in.
          validateDiscoveryRequest(input);
          let fallback = false;
          if (browserRouting === 'prefer_persistent') {
            try {
              if (input.browser==='chrome' && dedicatedChromeAutoStart &&
                  browserProviders.chrome?.endpoint==='http://127.0.0.1:9223') {
                const opened=await ensureDedicatedChromeHandler();
                if (!opened.ready)throw new RuntimeFault('DEDICATED_CHROME_NOT_READY');
              }
              result=await runtime.discover(input);
              result.provider='persistent';
              result.semantic_available=true;
              routingMetrics.persistent_discoveries++;
              // Quiet, click-through toast once per live Bridge connection.
              if (input.browser==='chrome' && bridgeToastEnabled &&
                  dedicatedChromeAutoStart &&
                  browserProviders.chrome?.endpoint==='http://127.0.0.1:9223' &&
                  !bridgeToastShown) {
                bridgeToastShown=true;
                void Promise.resolve().then(() => bridgeToastHandler()).catch(() => {});
              }
            } catch(error) {
              if (input.browser==='chrome' && dedicatedChromeAutoStart &&
                  browserProviders.chrome?.endpoint==='http://127.0.0.1:9223')
                throw new RuntimeFault('DEDICATED_CHROME_ATTACH_FAILED');
              // Never turn authorization, request-validation or stale-target
              // failures into an alternate way to access a browser.
              if(!attachFallbackCodes.has(error?.message))throw error;
              fallback=true;
              routingMetrics.persistent_fallbacks++;
            }
          }
          if (browserRouting === 'native_first' || fallback) {
            let nativeState;
            try { nativeState=await nativeHandler('state',input.browser); }
            catch { routingMetrics.native_discovery_failures++;
              throw new RuntimeFault('NATIVE_DISCOVERY_UNAVAILABLE'); }
            result=nativeDiscoveryFallback(input.browser,nativeState,input,dynamicTabs,allowedOrigins,
              fallback?'PERSISTENT_BROWSER_UNAVAILABLE':'NATIVE_FIRST');
            routingMetrics.native_discoveries++;
          }
        }
        else if (req.url === '/v2/browser/inspect') result=await runtime.inspect(input);
        else result=await runtime.screenshot(input);
        reply(res,200,{ok:true,data:result}); return;
      }
      if (req.url === '/v1/status') {
        reply(res, 200, {ok:true,data:{backend:'macos-automation',
          browsers:['chrome','edge'],desktop_enabled:Boolean(desktopRoute),native_approval:true,allowlisted_origins:allowedOrigins.size,
          discovery_mode:dynamicTabs ? 'all_web_tabs' : 'allowlist',
          title_identity_required:dynamicTabs,
          mutation_policy:restrictBrowserWrites?'allowlist_only':'session_scoped',
          approval_modes:['per_action','delegated_session'],
          delegated_session:sessionStore.status()}});
        return;
      }
      if (req.url === '/v1/session/status') {
        reply(res,200,{ok:true,data:sessionStore.status()}); return;
      }
      if (req.url === '/v1/session/end') {
        const result=sessionStore.end(input.session_id);
        try {await auditHandler({action:'session_end',outcome:'revoked'});}catch{ /* Revocation must not depend on audit availability. */ }
        reply(res,200,{ok:true,data:result}); return;
      }
      if (req.url === '/v1/session/begin') {
        if (busy) throw new Error('COMPUTER_BUSY');
        if (sessionStore.status().active) throw new Error('SESSION_ALREADY_ACTIVE');
        if (!['chrome','edge','both','desktop'].includes(input.scope) ||
            !Number.isInteger(input.duration_minutes) || input.duration_minutes < 1 ||
            input.duration_minutes > 30 ||
            !Number.isInteger(input.max_actions) || input.max_actions < 1 ||
            input.max_actions > 200 ||
            typeof input.purpose !== 'string' || input.purpose.length < 10 ||
            input.purpose.length > 300) throw new Error('INVALID_SESSION_REQUEST');
        busy=true;
        try {
          const request = input.scope === 'both' ? 'Chrome AND Edge' : input.scope === 'mac' ? 'macOS desktop applications' : input.scope === 'all' ? 'Chrome, Edge AND macOS desktop' : input.scope;
          const prompt = 'Cloud Sandbox requests a temporary delegated Computer Use session.\n' +
            'TASK: ' + input.purpose.replace(/\p{Cc}+/gu,' ').replace(/\s+/g,' ').slice(0,300) + '\n' +
            'SCOPE: ' + request + '\n' +
            'DURATION: ' + input.duration_minutes + ' minutes\n' +
            'MAXIMUM CLICKS/KEY EVENTS: ' + input.max_actions + '\n\n' +
            'After approving this ONCE, the agent can click, type, and submit on these ' +
            'authorized browser tabs or desktop apps WITHOUT another Mac prompt until the session expires, ' +
            'runs out of actions, or is revoked. This includes potentially important ' +
            'settings and transactions; the browser driver cannot distinguish them.\n' +
            'Only approve for the task you actually requested. You can STOP the session ' +
            'at any time through computer_use_session_end or the local stop command.';
          if (!await approvalHandler(prompt)) throw new Error('USER_DENIED_SESSION');
          const session=sessionStore.begin(input);
          let auditSaved=true;
          try {await auditHandler({action:'session_begin',scope:input.scope,
            outcome:'approved',duration_minutes:input.duration_minutes,
            max_actions:input.max_actions});}catch{auditSaved=false;}
          reply(res,200,{ok:true,data:{...session,audit_receipt:auditSaved?'saved':'unavailable'}});
          return;
        } finally {busy=false;}
      }
      if (req.url === '/v1/state') {
        const selection = input.browser ? [input.browser] : ['chrome','edge'];
        if (selection.some(b => !browsers.has(b))) throw new Error('INVALID_BROWSER');
        const discovered = [];
        for (const b of selection) {
          try {
            const state = await nativeHandler('state',b);
            const windows = (Array.isArray(state.windows) ? state.windows : []).map(w => ({
              window_index: w.window_index,
              tabs: (Array.isArray(w.tabs) ? w.tabs : [])
                .filter(t => t && (dynamicTabs ? Boolean(safeUrl(t.url)) :
                                isAllowlistedTabUrl(t.url, allowedOrigins))).map(t => ({
                  tab_index: t.tab_index,
                  active: Boolean(t.active),
                  title: String(t.title || '').slice(0,300),
                  url: safeUrl(t.url)
                }))
            })).filter(w => w.tabs.length > 0);
            discovered.push({browser:b,running:Boolean(state.running),windows});
          } catch (error) {
            const code = error?.message === 'MAC_AUTOMATION_PERMISSION_DENIED' ?
              'MAC_AUTOMATION_PERMISSION_DENIED' :
              error?.message === 'MAC_AUTOMATION_PERMISSION_OR_SCRIPT_ERROR' ?
              'MAC_AUTOMATION_PERMISSION_OR_SCRIPT_ERROR' : 'DISCOVERY_UNAVAILABLE';
            discovered.push({browser:b,running:null,windows:[],error:code});
          }
        }
        reply(res, 200, {ok:true,data:{browsers:discovered}}); return;
      }
      const args = verifyTarget(input,allowedOrigins,dynamicTabs,
        req.url === '/v1/action' && restrictBrowserWrites);
      if (busy) { reply(res,409,{ok:false,error:'COMPUTER_BUSY'}); return; }
      busy = true;
      try {
        await nativeHandler('inspect',...args);
        if (req.url === '/v1/focus') {
          const focused = await nativeHandler('focus',...args);
          reply(res,200,{ok:true,data:focused}); return;
        }
        if (req.url === '/v1/screenshot') {
          const region = await nativeHandler('bounds',...args);
          const image = await captureHandler(region);
          reply(res,200,{ok:true,data:image}); return;
        }
        if (req.url === '/v1/action') {
          if (!['click','type_text','press_key'].includes(input.action) ||
              typeof input.reason !== 'string' || input.reason.length < 10 ||
              input.reason.length > 300) throw new Error('INVALID_ACTION');
          let eventArguments;
          if (input.action === 'click') {
            if (![input.x,input.y].every(n => Number.isInteger(n) && n >= 0 && n <= 32768)) {
              throw new Error('INVALID_COORDINATES');
            }
            eventArguments = [String(input.x),String(input.y)];
          } else if (input.action === 'type_text') {
            if (typeof input.text !== 'string' || input.text.length < 1 || input.text.length > 2000) {
              throw new Error('INVALID_TEXT');
            }
            eventArguments = [input.text];
          } else {
            if (!keys.has(input.key)) throw new Error('INVALID_KEY');
            eventArguments = [input.key];
          }
          const prompt = 'Cloud Sandbox requests ' + input.action + ' in ' + input.browser +
            ' (' + new URL(input.expected_url).origin + ').\n' +
            input.reason + '\n\n' +
            'This can submit forms or change accounts. Confirm the intended effect before approving.';
          const audit = {browser:input.browser,origin:new URL(input.expected_url).origin,
            action:input.action};
          const usesSession=input.session_id!==undefined;
          if(usesSession) sessionStore.authorize(input.session_id,input.browser);
          if (!usesSession) {
            if (!await approvalHandler(prompt)) {
              await auditHandler({...audit,outcome:'denied'});
              throw new Error('USER_DENIED_ACTION');
            }
          }
          await auditHandler({...audit,outcome:usesSession?'session_authorized':'approved',
            approval_mode:usesSession?'delegated_session':'per_action'});
          // The second session check happens immediately before dispatch so a
          // local revoke or expiry while inspecting a tab fails closed.
          const delegated=usesSession ?
            sessionStore.authorize(input.session_id,input.browser,{consume:true}) : null;
          // Native JXA independently verifies title+URL just before the OS event.
          let result;
          try {
            result = await nativeHandler('action',...args,input.action,...eventArguments);
          } catch (error) {
            await auditHandler({...audit,outcome:'failed'});
            throw error;
          }
          let auditSaved = true;
          try { await auditHandler({...audit,outcome:'performed'}); }
          catch { auditSaved = false; }
          // An event was dispatched. Do not return a retryable error solely due to
          // an evidence-write failure: doing so could duplicate a real-world action.
          reply(res,200,{ok:true,data:{...result,
            approval_mode:usesSession?'delegated_session':'per_action',
            ...(delegated?{remaining_session_actions:delegated.remaining_actions}:{}),
            audit_receipt:auditSaved ? 'saved' : 'unavailable'}});
          return;
        }
      } finally { busy = false; }
      reply(res,404,{ok:false,error:'UNKNOWN_METHOD'});
    } catch (error) {
      // Never return OS diagnostics, personal URLs with query strings, tokens, or typed text.
      const allowedErrors = new Set(['INVALID_TARGET','INVALID_ACTION','INVALID_TEXT','INVALID_KEY',
        'INVALID_COORDINATES','INVALID_BODY','INVALID_BROWSER','USER_DENIED_ACTION','REQUEST_TOO_LARGE',
        'STALE_WINDOW','STALE_TAB','STALE_URL','TARGET_CHANGED','BROWSER_NOT_RUNNING',
        'MAC_AUTOMATION_PERMISSION_OR_SCRIPT_ERROR','EXPECTED_TITLE_REQUIRED',
        'STALE_TITLE','INVALID_SESSION_REQUEST','SESSION_ALREADY_ACTIVE',
        'SESSION_NOT_ACTIVE','SESSION_SCOPE_MISMATCH','USER_DENIED_SESSION',
        'COMPUTER_BUSY','BROWSER_APP_UNAVAILABLE','MUTATION_ORIGIN_DENIED',
        'MAC_DESKTOP_DISABLED','MAC_APP_NOT_ALLOWED','INVALID_MAC_OPERATION','INVALID_MAC_TARGET',
        'INVALID_MAC_ACTION','INVALID_MAC_ELEMENT','INVALID_MAC_TEXT','INVALID_MAC_KEY','INVALID_MAC_SCROLL',
        'STALE_MAC_PROCESS','STALE_MAC_WINDOW','STALE_MAC_TITLE','STALE_MAC_ELEMENT',
        'MAC_SENSITIVE_FIELD_DENIED','MAC_REQUEST_ALREADY_DISPATCHED','MAC_REQUEST_GATE_FULL','MAC_NATIVE_UNAVAILABLE',
        'MAC_DESKTOP_DISABLED',...['MAC_APP_NOT_ALLOWED','INVALID_MAC_TARGET','INVALID_MAC_ACTION',
        'INVALID_MAC_ELEMENT','INVALID_MAC_TEXT','INVALID_MAC_KEY','STALE_MAC_PROCESS',
        'STALE_MAC_WINDOW','STALE_MAC_TITLE','STALE_MAC_ELEMENT','MAC_PROTECTED_FIELD',
        'MAC_ACCESSIBILITY_UNAVAILABLE','MAC_SCROLL_UNSUPPORTED',
        'MAC_REQUEST_ALREADY_DISPATCHED','MAC_REQUEST_GATE_FULL']]);
      reply(res,400,{ok:false,error:error instanceof RuntimeFault ? error.message :
        allowedErrors.has(error?.message) ? error.message : 'NATIVE_UNAVAILABLE'});
    }
  });
  server.once('close', () => { if (runtime) void runtime.close().catch(() => {}); });
  return server;
}

function parseDotEnv(raw) {
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z_0-9]*)=(.*)$/);
    if (!m) continue;
    const value = m[2].trim();
    data[m[1]] = (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ? value.slice(1,-1) : value;
  }
  return data;
}

async function appendAudit(record) {
  const {default: os} = await import('node:os');
  const dir = path.join(os.homedir(),'.cloud-sandbox-mcp-data','audit');
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  await fs.appendFile(path.join(dir,'computer-use.jsonl'),
    JSON.stringify({timestamp:new Date().toISOString(),...record}) + '\n',{mode:0o600});
}

export async function startBridge(options = {}) {
  const source = options.envFile || process.env.COMPUTER_USE_ENV_FILE || path.join(here,'../.env');
  const environment = {...parseDotEnv(await fs.readFile(source,'utf8')),...process.env};
  if (environment.COMPUTER_USE_ENABLED !== 'true') throw new Error('COMPUTER_USE_NOT_ENABLED');
  const list = (environment.COMPUTER_USE_ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);
  // An explicit local operator opt-in unlocks dynamic Chrome/Edge tab discovery.
  // Delegated sessions still require one native approval when they begin.
  const dynamicTabs = environment.COMPUTER_USE_DYNAMIC_TABS === 'true';
  const mutationPolicyFlag = environment.COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY;
  if (mutationPolicyFlag !== undefined && !['true','false'].includes(mutationPolicyFlag)) {
    throw new Error('INVALID_MUTATION_POLICY');
  }
  const restrictBrowserWrites = mutationPolicyFlag === 'true';
  const enableBrowserRuntime = environment.COMPUTER_USE_BROWSER_V2 === 'true';
  const browserRouting = browserRoutingFromEnvironment(environment);
  const ledger = enableBrowserRuntime ? new AuditLedger(path.join(os.homedir(),
    'Library','Application Support','LCH','CloudSandboxComputerUse','audit-v2')) : null;
  const server = createBridgeServer({
    token: environment.COMPUTER_USE_BRIDGE_TOKEN, allowedOrigins: new Set(list),
    dynamicTabs, restrictBrowserWrites, auditHandler: appendAudit, enableBrowserRuntime,
    browserRouting,
    // Keep legacy provider metadata registered for the existing Mac installer
    // and for a later operator opt-in. Native-first never calls pool.get(),
    // so registration alone does not attach a debugger or request permission.
    browserProviders: enableBrowserRuntime ? providersFromEnvironment(environment) : {},
    browserAudit: event => ledger.append(event),
    dedicatedChromeAutoStart: environment.COMPUTER_USE_DEDICATED_CHROME_AUTO_START === 'true',
    bridgeToastEnabled: environment.COMPUTER_USE_BRIDGE_TOAST === 'true',
    desktopEnabled:environment.COMPUTER_USE_MAC_DESKTOP === 'true',
    desktopBundles:parseAllowedBundles(environment.COMPUTER_USE_MAC_ALLOWED_BUNDLES || ''),
    desktopEnabled: environment.COMPUTER_USE_DESKTOP_ENABLED === 'true',
    desktopAllowedBundles: parseAllowedBundles(environment.COMPUTER_USE_DESKTOP_ALLOWED_BUNDLES || '')
  });
  server.once('close', () => { if (ledger) void ledger.close().catch(() => {}); });
  const host = environment.COMPUTER_USE_BRIDGE_BIND || '0.0.0.0';
  const port = Number(environment.COMPUTER_USE_BRIDGE_PORT || '9764');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(port,host,resolve);
  });
  console.log('Mac Computer Use enabled on configured Docker Desktop gateway (' + port + ').');
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startBridge().catch(error => {
    console.error('Mac Computer Use startup: ' + error.message);
    process.exitCode = 1;
  });
}
