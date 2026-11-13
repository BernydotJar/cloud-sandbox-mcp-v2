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
import * as requireTrustedMigrator from './upgrade-trusted-notice.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const releases=path.join(here,'fixtures');
const variations=[
  ['per-browser','edge-playwright-bridge.mjs.fixture'],
  ['scalar','native-first-bridge.mjs.fixture']
];
for(const [variant,name] of variations) {
  const file=path.join(releases,name);
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
  skip:!fs.existsSync(path.join(releases,'edge-playwright-bridge.mjs.fixture'))
},async()=>{
  const source=fs.readFileSync(path.join(releases,'edge-playwright-bridge.mjs.fixture'),'utf8');
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

test('Akira splash is a 5-second click-through nonmodal overlay at upper right',()=>{
  const swift=fs.readFileSync(path.join(here,'bridge-toast.swift'),'utf8');
  assert.match(swift,/static let connectionLifetime: TimeInterval = 5\.0/);
  assert.match(swift,/area\.maxX - PortalSplash\.width - PortalSplash\.margin/);
  assert.match(swift,/area\.maxY - height - PortalSplash\.margin/);
  assert.match(swift,/\.nonactivatingPanel/);
  assert.match(swift,/panel\.ignoresMouseEvents = !\(delegated \|\| alerted\)/);
  assert.match(swift,/\.accessory/);
  assert.match(swift,/accessibilityDisplayShouldReduceMotion/);
  assert.match(swift,/asyncAfter\(deadline: \.now\(\) \+ lifetime\)/);
  assert.match(swift,/application\.terminate\(nil\)/);
  assert.match(swift,/Portal conectado/);
  assert.match(swift,/private final class PortalView/);
  assert.doesNotMatch(swift,/NSAlert|NSCriticalAlertStyle|UIAlertController/);
  const installer=fs.readFileSync(path.join(here,'install-on-mac.mjs'),'utf8');
  assert.match(installer,/log\('AUTO_DISMISS_MS',5000\)/);
  assert.match(installer,/swiftc/);
  assert.match(installer,/ROLLED_BACK/);
});

test('Akira splash builds with Apple Swift on macOS', {skip:process.platform!=='darwin'},()=>{
  execFileSync('/usr/bin/xcrun',['swiftc','-typecheck',
    path.join(here,'bridge-toast.swift'),'-framework','AppKit','-framework','QuartzCore'],
  {timeout:120000,stdio:['ignore','pipe','pipe']});
});


test('Akira one-shot release includes guarded CDP AX runtime files',()=>{
  const installer=fs.readFileSync(path.join(here,'install-on-mac.mjs'),'utf8');
  const candidate=fs.readFileSync(path.join(here,'runtime.mjs'),'utf8');
  const helper=fs.readFileSync(path.join(here,'cdp-semantic.mjs'),'utf8');
  assert.match(installer,/previousRuntimeSha/);
  assert.match(installer,/UNKNOWN_MAC_RUNTIME_VERSION_NO_OVERWRITE/);
  assert.match(installer,/runtime\.previous\.mjs/);
  assert.match(installer,/autonomy-session\.previous\.mjs/);
  assert.match(installer,/UNKNOWN_SESSION_STORE_VERSION_NO_OVERWRITE/);
  assert.match(installer,/TRUSTED_SESSION_RUNTIME_HEALTH_GATE_FAILED/);
  assert.match(installer,/CDP_CHANGES/);
  assert.match(installer,/CDP_AX_RUNTIME_HEALTH_GATE_FAILED/);
  assert.match(installer,/SWIFT_COMPILER_DIAGNOSTIC/);
  assert.match(candidate,/inspection_mode: inspectionMode/);
  assert.match(candidate,/cdp_ax_fallback/);
  assert.match(helper,/Accessibility\.getFullAXTree/);
  assert.match(helper,/DOM\.focus/);
  assert.match(helper,/Input\.insertText/);
  assert.doesNotMatch(helper,/session\.send\(['"](?:Runtime\.evaluate|Input\.dispatchMouseEvent)/);
});


test('CDP fallback preserves accessible field labels without exposing values',async()=>{
  const {scrubContent}=await import('../../mac-host/browser-runtime/contracts.mjs');
  const raw='- textbox "Start writing lyrics": [REDACTED_FIELD_VALUE]';
  assert.equal(scrubContent(raw),raw);
  const source=fs.readFileSync(path.join(here,'cdp-semantic.mjs'),'utf8');
  assert.match(source,/lines\.push\('- '\+role\+' "'\+quoted\+'": \[REDACTED_FIELD_VALUE\]'\)/);
});

test('delegated Edu notification is 20 seconds and dismissible without ending session',()=>{
  const swift=fs.readFileSync(path.join(here,'bridge-toast.swift'),'utf8');
  assert.match(swift,/static let connectionLifetime: TimeInterval = 5\.0/);
  assert.match(swift,/static let delegatedLifetime: TimeInterval = 20\.0/);
  assert.match(swift,/min\(200, Int/);
  assert.doesNotMatch(swift,/acciones sin límite/);
  assert.match(swift,/--session-notice/);
  assert.match(swift,/let brand = label/);
  assert.match(swift,/Edu!.*SANDBOX V3/);
  assert.match(swift,/Sesión delegada activa/);
  assert.match(swift,/class NoticeDismissal/);
  assert.match(swift,/close\.setAccessibilityLabel\("Cerrar aviso"\)/);
  assert.match(swift,/panel\.ignoresMouseEvents = !\(delegated \|\| alerted\)/);
  assert.doesNotMatch(swift,/NSAlert|NSCriticalAlertStyle|UIAlertController/);
});

test('trusted notice patch supports installed per-browser and legacy scalar routing',()=>{
  const source=fs.readFileSync(
    path.join(releases,'edge-playwright-bridge.mjs.fixture'),'utf8');
  const {upgradeTrustedNoticeBridgeSource,upgradeTrustedNoticeEnvSource}=
    requireTrustedMigrator;
  const patch=upgradeTrustedNoticeBridgeSource(source);
  assert.equal(patch.variant,'per-browser');
  assert(patch.applied);
  assert(patch.source.includes('TRUSTED_SESSION_LIMITS_EXCEEDED'));
  assert(patch.source.includes('trustedSessionNoticeHandler'));
  assert(patch.source.includes('unlimited_actions:true'));
  execFileSync(process.execPath,['--check','--input-type=module'],
    {input:patch.source,timeout:8000});
  assert.equal(upgradeTrustedNoticeBridgeSource(patch.source).applied,false);
  const env='COMPUTER_USE_BRIDGE_TOKEN=dummy-12345678901234567890123456789\n'+
    'COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY=false\n';
  const authorized=upgradeTrustedNoticeEnvSource(env,{enabled:true});
  assert(authorized.includes('COMPUTER_USE_TRUSTED_SESSION_NOTICE=true'));
  assert(authorized.includes('COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY=true'));
  assert.equal(upgradeTrustedNoticeEnvSource(authorized,{enabled:true}),authorized);
});

test('terminal and shared agent policy reinforce the live Mac Bridge contract without assuming an unverified CLI alias',()=>{
  const {readFileSync}=fs;
  const doc=readFileSync(path.resolve(here,'../../docs/computer-use-v2/TERMINAL_SANDBOX_CONTRACT.md'),'utf8');
  const guide=readFileSync(path.resolve(here,'../../AGENTS.md'),'utf8');
  const registered=readFileSync(path.resolve(here,'../../src/mcp/server.ts'),'utf8');
  for(const term of [
    'computer_use_status',
    'trusted_delegation_notice.enabled',
    'unlimited_actions',
    'remaining_actions=null',
    '20-second',
    'sandbox -c'
  ]) assert(doc.includes(term),'Missing Terminal Bridge contract: '+term);
  assert(doc.includes('do not define its implementation or flags'));
  assert(doc.includes('not machine-learning') || doc.includes('not machine-learning'));
  assert(guide.includes('TERMINAL_SANDBOX_CONTRACT.md'));
  assert(guide.includes('unlimited_actions=false'));
  assert(registered.includes('finite per-session action budget'));
});


test('Akira reinstallation recognizes only the approved LCH HTTPS wildcard',()=>{
  const script=fs.readFileSync(path.join(here,'install-on-mac.mjs'),'utf8');
  assert(script.includes("origin==='https://*.lch-app.cloud'"));
  assert(script.includes("origin.includes('*')"));
  assert(script.includes('TRUSTED_NOTICE_REQUIRES_EXACT_HTTPS_ALLOWLIST'));
});
