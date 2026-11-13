/* global document, setTimeout */
/** Read-only macOS Playwright channel probe; does not print page content or secrets. */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const print = (step, status) => process.stdout.write(`[Browser inspect diagnostic] ${step}=${status}\n`);
function errorClass(error) {
  const text = String(error?.message || error).toLowerCase();
  if (text.includes('timeout')) return 'TIMEOUT';
  if (text.includes('detached') || text.includes('target closed')) return 'TARGET_CLOSED';
  if (text.includes('execution context')) return 'EXECUTION_CONTEXT_UNAVAILABLE';
  if (text.includes('permission') || text.includes('access denied')) return 'BROWSER_PERMISSION_DENIED';
  if (text.includes('protocol')) return 'PROTOCOL_ERROR';
  if (text.includes('not found')) return 'NOT_FOUND';
  return 'OTHER';
}
async function main() {
  if (process.platform !== 'darwin') throw Error('MACOS_ONLY');
  const location = path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse/node_modules/playwright-core/index.mjs');
  if (!fs.existsSync(location)) throw Error('PLAYWRIGHT_NOT_INSTALLED_ON_MAC_BRIDGE');
  const { chromium } = await import(pathToFileURL(location).href);
  let browser;
  try {
    browser = await chromium.connectOverCDP('chrome', { timeout: 12000, noDefaults:true });
    print('ATTACH','PASS');
    const pages = browser.contexts().flatMap(c=>c.pages());
    const page = pages.find(p=>!p.isClosed() && p.url().startsWith('https://suno.com/create'));
    if (!page) { print('SUNO_TARGET','NOT_FOUND'); return; }
    print('SUNO_TARGET','PASS');
    for (const [name,operation] of [
      ['TITLE',()=>page.title()],
      ['DOM_CONTENT',()=>page.content()],
      ['EVALUATE',()=>page.evaluate(() => document.readyState)],
      ['BODY_COUNT',()=>page.locator('body').count()],
      ['BODY_INNER_TEXT',()=>page.locator('body').innerText({timeout:4000})],
      ['BODY_ARIA',()=>page.locator('body').ariaSnapshot({timeout:4000})],
      ['CDP_DOM',async()=>{const session=await page.context().newCDPSession(page);try{return await session.send('DOM.getDocument',{depth:0});}finally{await session.detach();}}]
    ]) {
      try { await Promise.race([operation(),new Promise((_,reject)=>setTimeout(()=>reject(Error('probe timeout')),6500))]); print(name,'PASS'); }
      catch(e) { print(name,'FAIL_'+errorClass(e)); }
    }
  } finally { await browser?.close().catch(()=>{}); }
}
main().catch(e=>{print('DIAGNOSTIC','STOP_'+errorClass(e));process.exitCode=2;});
