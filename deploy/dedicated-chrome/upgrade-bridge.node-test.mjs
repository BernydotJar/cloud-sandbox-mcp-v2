/* global process, fetch */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {upgradeBridgeSource,upgradeEnvSource} from './upgrade-bridge.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const snapshots='/shared-auth/deployment/handoff/cloud-sandbox-computer-use';
const variants=[
  ['per-browser','edge-playwright-75d5a19'],
  ['scalar','browser-native-first-47a9513']
];
for(const [variant,release] of variants){
  const snapshot=path.join(snapshots,release,'bridge.mjs');
  test('preserves custom Bridge features ('+variant+')',{
    skip:!fs.existsSync(snapshot)
  },()=>{
    const source=fs.readFileSync(snapshot,'utf8');
    const migrated=upgradeBridgeSource(source);
    assert.equal(migrated.variant,variant);
    assert.equal(migrated.applied,true);
    assert.match(migrated.source,/LCH_DEDICATED_CHROME_AUTOSTART_V3/);
    assert.match(migrated.source,/DEDICATED_CHROME_ATTACH_FAILED/);
    execFileSync(process.execPath,['--check','--input-type=module'],{input:migrated.source,timeout:8000});
    assert.deepEqual(upgradeBridgeSource(migrated.source),
      {source:migrated.source,applied:false,variant});
    // Outside the guarded insertion points original native fallback must remain.
    const chunk=source.slice(source.indexOf('export function nativeDiscoveryFallback'),
      source.indexOf('export function browserRoutingFromEnvironment'));
    assert(migrated.source.includes(chunk));
  });
}

test('refuses incompatible and partially patched Bridge source',()=>{
  assert.throws(()=>upgradeBridgeSource('wrong version'),/BRIDGE_SIZE_INVALID/);
  assert.throws(()=>upgradeBridgeSource('x'.repeat(11000)),/INCOMPATIBLE_BRIDGE_INVARIANT/);
  assert.throws(()=>upgradeBridgeSource('// LCH_DEDICATED_CHROME_AUTOSTART_V3'.repeat(450)),
    /PARTIAL_DEDICATED_PATCH/);
});

test('configuration upgrades Chrome without changing Edge or existing credentials',()=>{
  const source='COMPUTER_USE_BRIDGE_TOKEN=example-not-a-real-secret\n'+
    'COMPUTER_USE_CHROME_ROUTING=native_first\n'+
    'COMPUTER_USE_EDGE_ROUTING=native_first\n';
  const updated=upgradeEnvSource(source,'per-browser').source;
  assert.match(updated,/COMPUTER_USE_CHROME_ROUTING=prefer_persistent/);
  assert.match(updated,/COMPUTER_USE_CHROME_ENDPOINT=http:\/\/127.0.0.1:9223/);
  assert.match(updated,/COMPUTER_USE_CHROME_PROTOCOL=cdp/);
  assert.match(updated,/COMPUTER_USE_DEDICATED_CHROME_AUTO_START=true/);
  assert.match(updated,/COMPUTER_USE_EDGE_ROUTING=native_first/);
  assert.match(updated,/COMPUTER_USE_BRIDGE_TOKEN=example-not-a-real-secret/);
  assert.equal(upgradeEnvSource(updated,'per-browser').source,updated);
});

test('duplicate keys or absent credential sources cause fail-closed',()=>{
  assert.throws(()=>upgradeEnvSource('SOMETHING=else','scalar'),/BRIDGE_ENV_INVALID/);
  assert.throws(()=>upgradeEnvSource(
    'COMPUTER_USE_BRIDGE_TOKEN=a\nCOMPUTER_USE_CHROME_ENDPOINT=a\nCOMPUTER_USE_CHROME_ENDPOINT=b\n',
    'scalar'),/DUPLICATE_ENV_KEY/);
});

test('transformed per-browser bridge refuses native fallback when auto-start fails',{
  skip:!fs.existsSync(path.join(snapshots,'edge-playwright-75d5a19','bridge.mjs'))
},async()=>{
  const original=fs.readFileSync(path.join(snapshots,'edge-playwright-75d5a19','bridge.mjs'),'utf8');
  const upgraded=upgradeBridgeSource(original).source;
  const testName='.dedicated-chrome-smoke-'+crypto.randomBytes(4).toString('hex')+'.mjs';
  const fixture=path.resolve(dir,'../../mac-host',testName);
  fs.writeFileSync(fixture,upgraded,{mode:0o600,flag:'wx'});
  let server;
  try{
    const {createBridgeServer}=await import(pathToFileURL(fixture).href);
    let attempted=0;
    const token='this-is-a-testing-token-that-is-long-enough-for-tests';
    server=createBridgeServer({
      token,platform:'darwin',
      allowedOrigins:new Set(['https://example.com']),
      browserRouting:{chrome:'prefer_persistent',edge:'native_first'},
      enableBrowserRuntime:true,
      browserProviders:{chrome:{endpoint:'http://127.0.0.1:9223',protocol:'cdp'}},
      dedicatedChromeAutoStart:true,
      ensureDedicatedChromeHandler:async()=>{attempted++;return {ready:false};}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/v2/browser/tabs',{
      method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify({browser:'chrome'})
    });
    assert.equal(response.status,400);
    const result=await response.json();
    assert.equal(result.error,'DEDICATED_CHROME_ATTACH_FAILED');
    assert.equal(attempted,1);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.unlinkSync(fixture);
  }
});
