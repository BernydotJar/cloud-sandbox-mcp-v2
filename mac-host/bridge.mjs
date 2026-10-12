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

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const nativeFile = path.join(here, 'native.jxa');
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

export function nativeDiscoveryFallback(browser, state, input, dynamicTabs, origins) {
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
  return {
    browser,provider:'native',semantic_available:false,
    fallback_reason:'PERSISTENT_BROWSER_UNAVAILABLE',
    running:Boolean(state?.running),launch_available:!state?.running,
    tabs,
    next_step:state?.running?'Use computer_use_screenshot and computer_use_action with native_target':
      'Call browser_open to launch the existing browser profile'
  };
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
                                   launchBrowserHandler = launchBrowser}) {
  if (platform !== 'darwin') throw new Error('MACOS_REQUIRED');
  if (typeof token !== 'string' || token.length < 32) throw new Error('TOKEN_REQUIRED');
  if (typeof dynamicTabs !== 'boolean') throw new Error('INVALID_DISCOVERY_MODE');
  if (typeof restrictBrowserWrites !== 'boolean') throw new Error('INVALID_MUTATION_POLICY');
  if (!(allowedOrigins instanceof Set) || !allowedOrigins.size ||
      [...allowedOrigins].some(v => !v.startsWith('https://') || new URL(v).origin !== v)) {
    throw new Error('EXPLICIT_HTTPS_ALLOWLIST_REQUIRED');
  }
  const runtime = enableBrowserRuntime ? new BrowserRuntime({ providers: browserProviders,
    sessionStore, audit: browserAudit, dynamicTabs, allowedOrigins,
    restrictMutationsToAllowlist: restrictBrowserWrites }) : null;
  let busy = false;
  const server = http.createServer(async (req, res) => {
    if (!allowedPeer(req.socket.remoteAddress) || !authorized(req.headers.authorization, token)) {
      reply(res, 403, {ok:false,error:'UNAUTHORIZED'}); return;
    }
    if (req.method !== 'POST' ||
        !['/v1/status','/v1/state','/v1/focus','/v1/action','/v1/screenshot',
          '/v1/session/begin','/v1/session/status','/v1/session/end',
          '/v2/browser/status','/v2/browser/tabs','/v2/browser/inspect',
          '/v2/browser/screenshot','/v2/browser/action','/v2/browser/open'].includes(req.url)) {
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
      if (req.url.startsWith('/v2/browser/')) {
        if (req.url === '/v2/browser/status') {
          reply(res, 200, {ok:true, data:runtime ? {enabled:true,...runtime.status()} :
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
          try {
            result=await runtime.discover(input);
            result.provider='persistent';
            result.semantic_available=true;
          } catch(error) {
            // Downgrade ONLY temporary/unavailable transport failures.
            // Never bypass a denied target, invalid request or stale revision.
            if(!attachFallbackCodes.has(error?.message))throw error;
            if(!browsers.has(input.browser) || (input.title!==undefined &&
              (typeof input.title!=='string'||input.title.length<1||input.title.length>300)) ||
              (input.exact!==undefined && typeof input.exact!=='boolean'))
              throw new RuntimeFault('INVALID_RUNTIME_REQUEST');
            const nativeState=await nativeHandler('state',input.browser);
            result=nativeDiscoveryFallback(input.browser,nativeState,input,dynamicTabs,allowedOrigins);
          }
        }
        else if (req.url === '/v2/browser/inspect') result=await runtime.inspect(input);
        else result=await runtime.screenshot(input);
        reply(res,200,{ok:true,data:result}); return;
      }
      if (req.url === '/v1/status') {
        reply(res, 200, {ok:true,data:{backend:'macos-automation',
          browsers:['chrome','edge'],native_approval:true,allowlisted_origins:allowedOrigins.size,
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
        if (!['chrome','edge','both'].includes(input.scope) ||
            !Number.isInteger(input.duration_minutes) || input.duration_minutes < 1 ||
            input.duration_minutes > 30 ||
            !Number.isInteger(input.max_actions) || input.max_actions < 1 ||
            input.max_actions > 200 ||
            typeof input.purpose !== 'string' || input.purpose.length < 10 ||
            input.purpose.length > 300) throw new Error('INVALID_SESSION_REQUEST');
        busy=true;
        try {
          const request = input.scope === 'both' ? 'Chrome AND Edge' : input.scope;
          const prompt = 'Cloud Sandbox requests a temporary delegated Computer Use session.\n' +
            'TASK: ' + input.purpose.replace(/\p{Cc}+/gu,' ').replace(/\s+/g,' ').slice(0,300) + '\n' +
            'BROWSERS: ' + request + '\n' +
            'DURATION: ' + input.duration_minutes + ' minutes\n' +
            'MAXIMUM CLICKS/KEY EVENTS: ' + input.max_actions + '\n\n' +
            'After approving this ONCE, the agent can click, type, and submit on these ' +
            'browser tabs WITHOUT another Mac prompt until the session expires, ' +
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
        'COMPUTER_BUSY','BROWSER_APP_UNAVAILABLE','MUTATION_ORIGIN_DENIED']);
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
  const ledger = enableBrowserRuntime ? new AuditLedger(path.join(os.homedir(),
    'Library','Application Support','LCH','CloudSandboxComputerUse','audit-v2')) : null;
  const server = createBridgeServer({
    token: environment.COMPUTER_USE_BRIDGE_TOKEN, allowedOrigins: new Set(list),
    dynamicTabs, restrictBrowserWrites, auditHandler: appendAudit, enableBrowserRuntime,
    browserProviders: enableBrowserRuntime ? providersFromEnvironment(environment) : {},
    browserAudit: event => ledger.append(event)
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
