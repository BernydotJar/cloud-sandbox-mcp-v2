/**
 * Isolated UI interaction gate. Playwright owns a temporary headless Linux Chromium
 * profile and never attaches to, opens, or automates a daily-driver browser.
 *
 * This is a browser infrastructure smoke, not certification of Chessy or LUMA.
 * Set CUA_OFFSCREEN_QA=1 to opt in. No network, no persisted profile, no PII.
 */
/* global window, document, innerWidth */
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright-core';

if (process.env.CUA_OFFSCREEN_QA !== '1' || process.platform !== 'linux') {
  throw Error('CUA_OFFSCREEN_QA=1 on Linux is required; host Chrome/Edge must not be used.');
}
const iterations = Number(process.env.CUA_OFFSCREEN_ITERATIONS || '25');
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) {
  throw Error('CUA_OFFSCREEN_ITERATIONS must be an integer from 1 to 100');
}

let executablePath = '/usr/bin/chromium';
try { await fs.access(executablePath); }
catch { executablePath = chromium.executablePath(); }
await fs.access(executablePath);

const fixture = String.raw`<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Independent gesture QA fixture</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 12px; font-family: sans-serif; }
  .board { display: flex; gap: 14px; margin-top: 16px; }
  .square { width: 78px; height: 78px; touch-action: none; border: 1px solid #555; }
  input { display:block; width: min(240px, 95vw); margin-top: 12px; }
</style>
</head>
<body>
  <h1>Practice</h1>
  <button id="start" aria-label="Start practice">Start practice</button>
  <div class="board" role="group" aria-label="Practice board">
    <button class="square" data-square="e2" aria-label="White pawn e2">Pawn</button>
    <button class="square" data-square="e4" aria-label="Empty square e4">e4</button>
  </div>
  <p role="status" aria-live="polite" id="status">Ready</p>
  <label for="note">Learner note</label>
  <input id="note" autocomplete="off">
  <script>
    let started=false, active=null;
    window.__testMoves=[];
    document.querySelector('#start').addEventListener('click',()=>{
      started=true; document.querySelector('#status').textContent='Started';
    });
    document.querySelector('[data-square="e2"]').addEventListener('pointerdown',event=>{
      if(started) active={id:event.pointerId,from:'e2'};
    });
    document.addEventListener('pointerup',event=>{
      if(!active || event.pointerId!==active.id) return;
      const target=document.elementFromPoint(event.clientX,event.clientY);
      if(target?.closest('[data-square="e4"]')){
        window.__testMoves.push('e2-e4');
        document.querySelector('[data-square="e4"]').textContent='Pawn';
        document.querySelector('#status').textContent='Move e2-e4';
      }
      active=null;
    });
    document.addEventListener('pointercancel',()=>{active=null;});
  </script>
</body>
</html>`;

function center(bounds) {
  assert(bounds, 'Expected an onscreen target');
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

const startedAt = performance.now();
let passedDesktop = 0;
let passedMobile = 0;
let passedKeyboard = 0;
let passedAccessibility = 0;
let passedIsolation = 0;
let screenshotBytes = 0;
let browser;
let server;
try {
  server = await chromium.launchServer({
    executablePath, headless: true, host: '127.0.0.1',
    args: ['--no-sandbox', '--renderer-process-limit=2']
  });
  const argumentsList = server.process()?.spawnargs || [];
  browser = await chromium.connect(server.wsEndpoint());
  const profileArg = argumentsList.find(arg => arg.startsWith('--user-data-dir='));
  assert(profileArg, 'A Playwright temporary browser profile is mandatory');
  const browserProfile = profileArg.slice('--user-data-dir='.length);
  assert(browserProfile.startsWith('/tmp/playwright_'),
    'Refuse a browser profile outside the isolated Playwright /tmp path');
  assert(argumentsList.some(arg => arg.includes('--headless')), 'Refuse non-headless browser launches');

  for (let run = 0; run < iterations; run++) {
    const mobile = run % 2 === 1;
    const context = await browser.newContext({
      viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 },
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1
    });
    try {
      const page = await context.newPage();
      await page.setContent(fixture, { waitUntil: 'domcontentloaded' });
      assert.deepEqual(await page.evaluate(() => window.__testMoves), [], 'Browser contexts must be isolated');
      passedIsolation++;

      const before = await page.locator('body').ariaSnapshot();
      assert(before.includes('White pawn e2'), 'Accessible name is required for source square');
      assert(before.includes('Empty square e4'), 'Accessible name is required for target square');
      passedAccessibility++;

      await page.getByRole('button', { name: 'Start practice' }).click();
      assert.equal(await page.getByRole('status').innerText(), 'Started');
      const note = page.getByRole('textbox', { name: 'Learner note' });
      await note.focus();
      await page.keyboard.type('QA run ' + run);
      assert.equal(await note.inputValue(), 'QA run ' + run);
      await page.keyboard.press('Tab');
      passedKeyboard++;

      const from = center(await page.getByRole('button', { name: 'White pawn e2' }).boundingBox());
      const to = center(await page.getByRole('button', { name: 'Empty square e4' }).boundingBox());
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        try {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ ...from, radiusX: 2, radiusY: 2 }]
          });
          for (let step = 1; step <= 5; step++) {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{
                x: from.x + (to.x - from.x) * step / 5,
                y: from.y + (to.y - from.y) * step / 5,
                radiusX: 2, radiusY: 2
              }]
            });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally { await cdp.detach(); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true, 'Mobile fixture must not require horizontal scrolling');
        passedMobile++;
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 6 });
        await page.mouse.up();
        passedDesktop++;
      }
      assert.deepEqual(await page.evaluate(() => window.__testMoves), ['e2-e4']);
      assert.equal(await page.getByRole('status').innerText(), 'Move e2-e4');
      const screenshot = await page.screenshot({ type: 'png', animations: 'disabled' });
      assert.equal(screenshot.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      screenshotBytes += screenshot.byteLength;
    } finally { await context.close(); }
  }
  assert.equal(passedDesktop + passedMobile, iterations);
  console.log(JSON.stringify({
    result: 'PASS',
    test_type: 'isolated_browser_infrastructure_smoke_not_product_e2e',
    environment: 'Linux headless Chromium with disposable Playwright context per iteration',
    browser_version: browser.version(),
    fixture_sha256: crypto.createHash('sha256').update(fixture).digest('hex'),
    iterations,
    passed_desktop_drag: passedDesktop,
    passed_mobile_cdp_touch_drag: passedMobile,
    passed_keyboard: passedKeyboard,
    passed_accessibility_names: passedAccessibility,
    passed_context_isolation: passedIsolation,
    captured_png_bytes_in_memory: screenshotBytes,
    host_mac_browser_touched: false,
    elapsed_ms: Math.round(performance.now() - startedAt)
  }));
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
