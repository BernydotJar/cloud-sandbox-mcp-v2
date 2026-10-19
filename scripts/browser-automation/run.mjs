import console from "node:console";
import { URL } from "node:url";
/** Isolated background browser executor. No connection to personal Mac Chrome/Edge. */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

const [site, destination] = process.argv.slice(2);
if (!site || !destination || !/^https:\/\//.test(destination)) {
  console.error('Usage: node scripts/browser-automation/run.mjs <site-id> <https-url>');
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(site)) throw Error('INVALID_SITE_ID');
if (process.platform !== 'linux') throw Error('ISOLATED_LINUX_WORKSTATION_REQUIRED');
const url = new URL(destination);
if (url.username || url.password || !['https:'].includes(url.protocol)) throw Error('UNSAFE_URL');
const root = process.env.BROWSER_AUTOMATION_ROOT || '/workspace/.browser-automation';
const profile = path.join(root, 'profiles', site);
const output = path.join(root, 'evidence', site);
await fs.mkdir(profile, { recursive:true, mode:0o700 });
await fs.mkdir(output, { recursive:true, mode:0o700 });
await fs.chmod(profile, 0o700); await fs.chmod(output, 0o700);
const run = crypto.randomUUID();
const result = { run, site, started:new Date().toISOString(), status:'unknown', initialOrigin:url.origin, finalOrigin:null, title:null, evidence:[], headless:true };
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless:true, executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args:['--no-sandbox','--disable-dev-shm-usage'],
    viewport:{ width:1280, height:900 },
    acceptDownloads:false
  });
  await context.tracing.start({ screenshots:true, snapshots:true, sources:false });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(destination, { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForTimeout(1200);
  const final = new URL(page.url());
  result.finalOrigin = final.origin;
  result.finalPath = final.pathname;
  result.title = (await page.title()).slice(0,120);
  result.status = /(?:sign-in|login|signin|auth)(?:\/|$)/i.test(final.pathname) ? 'auth_required' : 'page_loaded_not_auth_verified';
  const screenshot = path.join(output, `${run}.png`);
  await page.screenshot({ path:screenshot, fullPage:false }); result.evidence.push(screenshot);
  const trace = path.join(output, `${run}.zip`);
  await context.tracing.stop({ path:trace }); result.evidence.push(trace);
} catch (error) {
  result.status='error'; result.error=String(error.message||error).slice(0,400);
  if(context) await context.tracing.stop({path:path.join(output,`${run}-error.zip`)}).catch(()=>{});
} finally { if(context) await context.close().catch(()=>{}); }
result.finished = new Date().toISOString();
const report = path.join(output,`${run}.json`);
await fs.writeFile(report, JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify({...result,report},null,2));
if (result.status === 'error') process.exitCode=1;
