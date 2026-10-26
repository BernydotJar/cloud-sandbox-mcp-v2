import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
import {edgeCdpVerdict} from './edge-cdp-diagnosis.mjs';

const base={
  edgeRunning:true,marker:'valid',packageReady:true,attached:true,
  identityVerified:true,bridgeConfigured:true,browserRouting:'prefer_persistent'
};
test('successful live CDP proof requires matching native profile and provider',()=>{
  assert.equal(edgeCdpVerdict(base),'CDP_IDENTITY_PASS_RETRY_BROWSER_TABS');
  assert.equal(edgeCdpVerdict({...base,identityVerified:false}),
    'EDGE_PROFILE_IDENTITY_UNVERIFIED');
  assert.equal(edgeCdpVerdict({...base,browserRouting:'native_first'}),
    'BRIDGE_EDGE_PROVIDER_NOT_READY');
  assert.equal(edgeCdpVerdict({...base,bridgeConfigured:false}),
    'BRIDGE_EDGE_PROVIDER_NOT_READY');
});
test('status triage never confuses native access with verified Playwright CDP',()=>{
  assert.equal(edgeCdpVerdict({...base,marker:'missing'}),
    'ENABLE_EDGE_REMOTE_DEBUGGING');
  assert.equal(edgeCdpVerdict({...base,marker:'invalid'}),
    'EDGE_DEBUG_MARKER_INVALID');
  assert.equal(edgeCdpVerdict({...base,attached:false}),
    'EDGE_CHANNEL_ATTACH_FAILED');
  assert.equal(edgeCdpVerdict({...base,packageReady:false}),
    'MAC_PLAYWRIGHT_RUNTIME_UNAVAILABLE');
  assert.equal(edgeCdpVerdict({...base,edgeRunning:false}),
    'EDGE_NOT_RUNNING');
});
test('Mac diagnostic never launches browsers or leaks raw page information',()=>{
  const script=fs.readFileSync(fileURLToPath(
    new URL('./edge-cdp-doctor.mjs',import.meta.url)),'utf8');
  for(const expected of [
    "connectOverCDP('msedge'",
    "noDefaults:true",
    'matchingTabs(urls,nativeUrls)',
    '/v1/state','/v2/browser/status',
    'READ_ONLY_NO_BROWSER_CHANGES',
    'DO_NOT_CLAIM_GH04_GH05_PASS',
    'NO_PAGE_URLS_NO_TITLES_NO_TOKENS',
    'DevToolsActivePort'
  ])assert(script.includes(expected),expected);
  for(const bad of ['--remote-debugging-port=','execFileSync(\'open\'',
    'open -a','document.cookie','localStorage','page.fill('])
    assert(!script.includes(bad),'Unexpected browser mutation: '+bad);
});
