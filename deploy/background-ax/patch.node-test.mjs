import {URL} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patchBackgroundBridge,patchBackgroundTabs} from './patch-bridge.mjs';
test('additive background patch preserves existing browser routes, grant and origin guards',()=>{
 const original=fs.readFileSync(new URL('../../mac-host/bridge.mjs',import.meta.url),'utf8');
 const patched=patchBackgroundTabs(patchBackgroundBridge(original));
 for(const retained of ['sessionStore.authorize','verifyTarget','restrictBrowserWrites','/v1/action','/v1/session/begin','/v2/browser/action'])assert(patched.includes(retained),retained);
 assert(patched.includes('backgroundTabs.has(input.tab_ref)'));assert(patched.includes('backgroundTabs.augment(result)'));
 assert.throws(()=>patchBackgroundBridge(patched),/ALREADY_PATCHED/);assert.throws(()=>patchBackgroundTabs(patched),/ALREADY_PATCHED/);
});
test('unknown host source refuses promotion instead of guessing patch anchors',()=>{
 assert.throws(()=>patchBackgroundBridge('unknown service'),/ANCHOR_UNKNOWN/);assert.throws(()=>patchBackgroundTabs('unknown service'),/ANCHOR/);
});
