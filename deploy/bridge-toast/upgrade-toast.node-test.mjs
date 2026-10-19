/* global process, fetch */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setImmediate} from 'node:timers';
import {upgradeToastBridgeSource,upgradeToastEnvSource,TOAST_MARKER} from './upgrade-toast.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const releases='/shared-auth/deployment/handoff/cloud-sandbox-computer-use';
const variations=[
  ['per-browser','edge-playwright-75d5a19'],
  ['scalar','browser-native-first-47a9513']
];
for(const [variant,name] of variations) {
  const file=path.join(releases,name,'bridge.mjs');
  test('native glass toast migrates existing '+variant+' Mac Bridge without deleting code',{
    skip:!fs.existsSync(file)
  },()=>{
    const old=fs.readFileSync(file,'utf8');
    const patch=upgradeToastBridgeSource(old);
    assert.equal(patch.variant,variant);
    assert.equal(patch.applied,true);
    assert.match(patch.source,/LCH_DEDICATED_CHROME_AUTOSTART_V3/);
    assert(patch.source.includes(TOAST_MARKER));
    assert.match(patch.source,/bridgeToastShown/);
    assert.match(patch.source,/Promise\.resolve\(\)\.then/);
    execFileSync(process.execPath,['--check','--input-type=module'],
      {input:patch.source,timeout:10000});
    assert.deepEqual(upgradeToastBridgeSource(patch.source),
      {source:patch.source,applied:false,variant});
    assert(patch.source.includes('function allowedPeer('));
    assert(patch.source.includes('delegated_session'));
  });
}

test('toast opt-in env preserves unrelated settings and is idempotent',()=>{
  const env='COMPUTER_USE_BRIDGE_TOKEN=test-only-credential\r\n'+
    'COMPUTER_USE_EDGE_ROUTING=prefer_persistent\r\n';
  const next=upgradeToastEnvSource(env);
  assert(next.includes('COMPUTER_USE_BRIDGE_TOAST=true'));
  assert(next.includes('COMPUTER_USE_EDGE_ROUTING=prefer_persistent'));
  assert(next.includes('\r\nCOMPUTER_USE_BRIDGE_TOAST=true'));
  assert.equal(upgradeToastEnvSource(next),next);
  assert.throws(()=>upgradeToastEnvSource(next+
    '\r\nCOMPUTER_USE_BRIDGE_TOAST=false'),/DUPLICATE_TOAST_KEY/);
});

test('toast reports an incompatible source instead of writing a partial patch',()=>{
  assert.throws(()=>upgradeToastBridgeSource('definitely invalid'),/BRIDGE_SIZE_INVALID/);
});

test('toast is emitted once after persistent Chrome discovery and never blocks actions',{
  skip:!fs.existsSync(path.join(releases,'edge-playwright-75d5a19','bridge.mjs'))
},async()=>{
  const source=fs.readFileSync(path.join(releases,'edge-playwright-75d5a19','bridge.mjs'),'utf8');
  const patch=upgradeToastBridgeSource(source);
  const original="result=await runtime.discover(input);";
  const count=patch.source.split(original).length-1;
  assert.equal(count,1);
  const testSource=patch.source.replace(original,
    "result={provider_epoch:1,tabs:[{title:'QA smoke',url:'https://example.com'}]};");
  const temp=path.resolve(here,'../../mac-host',
    '.glass-toast-smoke-'+crypto.randomBytes(5).toString('hex')+'.mjs');
  fs.writeFileSync(temp,testSource,{mode:0o600,flag:'wx'});
  const token='valid-demo-token-123456789012345678901234567890';
  let server;
  try{
    const {createBridgeServer}=await import(pathToFileURL(temp).href);
    let opens=0,shows=0;
    server=createBridgeServer({
      token,platform:'darwin',
      allowedOrigins:new Set(['https://example.com']),
      browserRouting:{chrome:'prefer_persistent',edge:'native_first'},
      enableBrowserRuntime:true,dedicatedChromeAutoStart:true,
      browserProviders:{chrome:{endpoint:'http://127.0.0.1:9223',protocol:'cdp'}},
      ensureDedicatedChromeHandler:async()=>{opens++;return {ready:true};},
      bridgeToastEnabled:true,
      bridgeToastHandler:async()=>{shows++;}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+server.address().port+'/v2/browser/tabs';
    for(let i=0;i<2;i++){
      const response=await fetch(url,{
        method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
        body:JSON.stringify({browser:'chrome'})
      });
      const result=await response.json();
      assert.equal(response.status,200);
      assert.equal(result.data.provider,'persistent');
    }
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(opens,2);
    assert.equal(shows,1);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.unlinkSync(temp);
  }
});
