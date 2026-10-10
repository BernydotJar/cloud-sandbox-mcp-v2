import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const nativeFile = path.join(here, 'native.jxa');
const browsers = new Set(['chrome', 'edge']);
const keys = new Set(['tab','escape','enter','space','backspace','up','down','left','right']);

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
function verifyTarget(t, origins) {
  if (!browsers.has(t.browser) || !Number.isInteger(t.window_index) ||
      !Number.isInteger(t.tab_index) || t.window_index < 1 || t.tab_index < 1 ||
      typeof t.expected_url !== 'string' || safeUrl(t.expected_url) !== t.expected_url ||
      !origins.has(new URL(t.expected_url).origin)) throw new Error('INVALID_TARGET');
  return [t.browser, String(t.window_index), String(t.tab_index), t.expected_url];
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
export function createBridgeServer({token, allowedOrigins, nativeHandler = native,
                                   approvalHandler = approve, captureHandler = capture,
                                   auditHandler = async () => {}, platform = process.platform}) {
  if (platform !== 'darwin') throw new Error('MACOS_REQUIRED');
  if (typeof token !== 'string' || token.length < 32) throw new Error('TOKEN_REQUIRED');
  if (!(allowedOrigins instanceof Set) || !allowedOrigins.size ||
      [...allowedOrigins].some(v => !v.startsWith('https://') || new URL(v).origin !== v)) {
    throw new Error('EXPLICIT_HTTPS_ALLOWLIST_REQUIRED');
  }
  let busy = false;
  return http.createServer(async (req, res) => {
    if (!allowedPeer(req.socket.remoteAddress) || !authorized(req.headers.authorization, token)) {
      reply(res, 403, {ok:false,error:'UNAUTHORIZED'}); return;
    }
    if (req.method !== 'POST' ||
        !['/v1/status','/v1/state','/v1/focus','/v1/action','/v1/screenshot'].includes(req.url)) {
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
      if (req.url === '/v1/status') {
        reply(res, 200, {ok:true,data:{backend:'macos-automation',
          browsers:['chrome','edge'],native_approval:true,allowlisted_origins:allowedOrigins.size}});
        return;
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
                .filter(t => t && isAllowlistedTabUrl(t.url, allowedOrigins)).map(t => ({
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
      const args = verifyTarget(input,allowedOrigins);
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
          if (!await approvalHandler(prompt)) {
            await auditHandler({...audit,outcome:'denied'});
            throw new Error('USER_DENIED_ACTION');
          }
          await auditHandler({...audit,outcome:'approved'});
          // Native JXA checks target identity again AFTER the local approval.
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
          reply(res,200,{ok:true,data:{...result,audit_receipt:auditSaved ? 'saved' : 'unavailable'}});
          return;
        }
      } finally { busy = false; }
      reply(res,404,{ok:false,error:'UNKNOWN_METHOD'});
    } catch (error) {
      // Never return OS diagnostics, personal URLs with query strings, tokens, or typed text.
      const allowedErrors = new Set(['INVALID_TARGET','INVALID_ACTION','INVALID_TEXT','INVALID_KEY',
        'INVALID_COORDINATES','INVALID_BODY','INVALID_BROWSER','USER_DENIED_ACTION','REQUEST_TOO_LARGE',
        'STALE_WINDOW','STALE_TAB','STALE_URL','TARGET_CHANGED','BROWSER_NOT_RUNNING',
        'MAC_AUTOMATION_PERMISSION_OR_SCRIPT_ERROR']);
      reply(res,400,{ok:false,error:allowedErrors.has(error?.message) ? error.message : 'NATIVE_UNAVAILABLE'});
    }
  });
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
  const server = createBridgeServer({
    token: environment.COMPUTER_USE_BRIDGE_TOKEN, allowedOrigins: new Set(list),
    auditHandler: appendAudit
  });
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
