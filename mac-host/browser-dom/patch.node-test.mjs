import fs from 'node:fs';import {test} from 'node:test';import assert from 'node:assert/strict';import {patchDOMBridge} from '../../deploy/browser-dom/patch-bridge.mjs';import {patchBackgroundBridge,patchBackgroundTabs} from '../../deploy/background-ax/patch-bridge.mjs';
test('DOM routes are additive on both canonical and customized background bridges',()=>{
 const original=fs.readFileSync(new URL('../bridge.mjs',import.meta.url),'utf8');
 for(const source of [original,patchBackgroundTabs(patchBackgroundBridge(original))]){
  const result=patchDOMBridge(source);for(const retained of ['sessionStore.authorize','restrictBrowserWrites','/v1/action','/v2/browser/action','nativeHandler'])assert(result.includes(retained));
  assert(result.indexOf("domTabs.available(input.browser)")<result.indexOf("if (!runtime) throw"));
  assert.throws(()=>patchDOMBridge(result),/ALREADY_PATCHED/);
 }
 assert.throws(()=>patchDOMBridge('unknown host'),/ANCHOR_CHANGED/);
});
test('extension requests only the reviewed Teams origin and native messaging/profile storage',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../../deploy/browser-dom/extension/manifest.json',import.meta.url)));
 assert.deepEqual(manifest.permissions,['nativeMessaging','storage']);assert.deepEqual(manifest.host_permissions,['https://teams.cloud.microsoft/*']);assert.deepEqual(manifest.content_scripts[0].matches,manifest.host_permissions);assert.equal(manifest.content_scripts[0].all_frames,false);
 const worker=fs.readFileSync(new URL('../../deploy/browser-dom/extension/worker.js',import.meta.url),'utf8');for(const forbidden of ['tabs.update','windows.update','cookies','debugger','executeScript'])assert(!worker.includes(forbidden),forbidden);
});
