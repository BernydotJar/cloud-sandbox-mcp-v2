import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';
import process from 'node:process';
import {LCH_APEX,LCH_WILDCARD,validAllowlistEntry,allowsWebOrigin}
  from './allowed-origins.mjs';
import {addLchOrigins,HCL_ITIME_ORIGIN} from './wildcard-config.mjs';
import {patchBridgeForLchWildcard,patchRuntimeForLchWildcard}
  from './upgrade-lch-wildcard.mjs';
const here=fileURLToPath(new URL('.',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
const original=fs.readFileSync(new URL('../../mac-host/allowed-origins.mjs',import.meta.url));
test('release helper matches the canonical Mac helper exactly',()=>{
  assert.deepEqual(fs.readFileSync(here+'allowed-origins.mjs'),original);
});
test('operator wildcard syntax is recognized only for the exact named HTTPS domain',()=>{
  for(const valid of [LCH_APEX,LCH_WILDCARD,'https://www.linkedin.com','https://luma.lch-app.cloud'])
    assert.equal(validAllowlistEntry(valid),true,valid);
  for(const invalid of ['http://*.lch-app.cloud','https://*.com','https://*lch-app.cloud',
    'https://*.*.lch-app.cloud','https://*.evil.lch-app.cloud',
    'https://*.lch-app.cloud:8443','https://*.lch-app.cloud/',
    'https://*.lch-app.cloud.evil.example'])
    assert.equal(validAllowlistEntry(invalid),false,invalid);
});
test('strict DNS hostname boundary and HTTPS-only wildcard matching',()=>{
  const allow=new Set([LCH_APEX,LCH_WILDCARD,'https://www.linkedin.com','https://*.linkedin.com',
    'https://cloud.uipath.com','https://*.cloud.uipath.com',
    'https://atlassian.net','https://*.atlassian.net']);
  for(const permitted of [
    'https://lch-app.cloud','https://lch-app.cloud/',
    'https://luma.lch-app.cloud/studio',
    'https://meridian.lch-app.cloud/login',
    'https://a.b.lch-app.cloud/admin',
    'https://WWW.LCH-APP.CLOUD/data',
    'https://foo.lch-app.cloud:443/path?private=hide',
    'https://www.linkedin.com/feed','https://business.linkedin.com/',
    'https://www.linkedin.com/profile','https://a.b.linkedin.com/',
    'https://cloud.uipath.com/','https://tenant.cloud.uipath.com/robots',
    'https://a.b.cloud.uipath.com/','https://atlassian.net/',
    'https://myteam.atlassian.net/jira','https://a.b.atlassian.net/'
  ])assert.equal(allowsWebOrigin(permitted,allow),true,permitted);
  for(const denied of [
    'http://lch-app.cloud',
    'http://foo.lch-app.cloud',
    'https://evil-lch-app.cloud','https://evillch-app.cloud',
    'https://foo.lch-app.cloud:4444',
    'https://lch-app.cloud:8443',
    'https://foo.lch-app.cloud./',
    'https://foo..lch-app.cloud/',
    'https://-foo.lch-app.cloud/',
    'https://foo-.lch-app.cloud/',
    'https://user:pass@foo.lch-app.cloud/',
    'https://linkedin.com/feed','https://evil-linkedin.com/',
    'https://foo.linkedin.com.evil.example/',
    'https://cloud.uipath.com.evil.example/','https://evilcloud.uipath.com/',
    'https://tenant.cloud.uipath.com:8443/',
    'http://tenant.cloud.uipath.com/',
    'https://atlassian.net.evil.example/',
    'https://evil-atlassian.net/',
    'https://tenant.atlassian.net:8080/',
    'http://tenant.atlassian.net/',
    'data:text/html,hello','javascript:alert(1)','not-a-url'
  ])assert.equal(allowsWebOrigin(denied,allow),false,denied);
  assert.equal(allowsWebOrigin('https://lch-app.cloud',new Set([LCH_WILDCARD])),false);
  assert.equal(allowsWebOrigin('https://a.lch-app.cloud',new Set([LCH_APEX])),false);
  assert.equal(allowsWebOrigin('https://x.lch-app.cloud',new Set()),false);
  assert.equal(allowsWebOrigin('http://127.0.0.1:3000',
    new Set(['http://127.0.0.1:3000'])),true);
  assert.equal(allowsWebOrigin('http://a.lch-app.cloud',
    new Set(['https://*.lch-app.cloud'])),false);
});
test('user wildcard expands to apex and explicit dot-bounded rule, keeping previous allowlist',()=>{
  const input='SOME_SECRET=do-not-touch\nCOMPUTER_USE_ALLOWED_ORIGINS=https://admin.microsoft.com,https://www.linkedin.com\nOTHER=alive\n';
  const result=addLchOrigins(input);
  assert.equal(result.changed,true);
  assert.equal(result.beforeCount,2);
  assert.equal(result.afterCount,10);
  assert(result.updated.includes('https://admin.microsoft.com,https://www.linkedin.com,'+
    LCH_APEX+','+LCH_WILDCARD));
  assert(result.updated.includes('SOME_SECRET=do-not-touch\n'));
  assert(result.updated.endsWith('OTHER=alive\n'));
  assert.deepEqual(addLchOrigins(result.updated),{
    updated:result.updated,beforeCount:10,afterCount:10,changed:false,
    alreadyApex:true,alreadyWildcard:true
  });
});
test('single or double quoting and CRLF remain byte preserving',()=>{
  for(const quote of ['"',"'"]){
    for(const eol of ['\n','\r\n']){
      const input=['X=y','COMPUTER_USE_ALLOWED_ORIGINS='+quote+'https://www.linkedin.com'+quote,'Y=z',''].join(eol);
      const result=addLchOrigins(input);
      assert.equal(result.afterCount,9);
      assert(result.updated.includes(quote+'https://www.linkedin.com,'+LCH_APEX+','+LCH_WILDCARD));
      assert(result.updated.includes('https://*.atlassian.net'+quote));
      assert.equal(addLchOrigins(result.updated).updated,result.updated);
    }
  }
});
test('arbitrary wildcard or malformed settings fail closed',()=>{
  for(const value of ['https://*.example.com','https://*lch-app.cloud',
    'https://*.lch-app.cloud.evil.example','http://example.com',
    'https://good.example,https://good.example',
    'https://foo.example # comment',
    'https://lch-app.cloud/path','https://www.linkedin.com,'
  ])assert.throws(()=>addLchOrigins('COMPUTER_USE_ALLOWED_ORIGINS='+value+'\n'),undefined,value);
  assert.throws(()=>addLchOrigins('X=1\n'),/MISSING_ALLOWED_ORIGINS_KEY/);
  assert.throws(()=>addLchOrigins('COMPUTER_USE_ALLOWED_ORIGINS=https://foo.example\n'+
    'COMPUTER_USE_ALLOWED_ORIGINS=https://foo.example\n'),/DUPLICATE_ALLOWED_ORIGINS_KEY/);
});
test('source transformations for native Bridge and persistent runtime are idempotent',()=>{
  for(const [file,patch] of [
    ['mac-host/bridge.mjs',patchBridgeForLchWildcard],
    ['mac-host/browser-runtime/runtime.mjs',patchRuntimeForLchWildcard]
  ]){
    const installed=fs.readFileSync(root+file,'utf8');
    assert.equal(patch(installed).changed,false);
    assert(patch(installed).source.includes('LCH_ORIGIN_WILDCARD_V1'));
  }
  const scratchBridge=fs.readFileSync(root+'mac-host/bridge.mjs','utf8');
  const scratchRuntime=fs.readFileSync(root+'mac-host/browser-runtime/runtime.mjs','utf8');
  for(const [src,patch] of [[scratchBridge,patchBridgeForLchWildcard],
    [scratchRuntime,patchRuntimeForLchWildcard]]){
    const source=src.replace('// LCH_ORIGIN_WILDCARD_V1','// LCH_ORIGIN_WILDCARD_DISABLED');
    assert.throws(()=>patch(source),/UNKNOWN_WILDCARD_SOURCE/);
  }
});
test('patched Bridge and Runtime modules pass Node syntax parsing',()=>{
  for(const file of ['mac-host/bridge.mjs','mac-host/browser-runtime/runtime.mjs']){
    execFileSync(process.execPath,['--check','--input-type=module'],{
      input:fs.readFileSync(root+file,'utf8'),timeout:10000
    });
  }
});

test('Mac migration rejects drift and installer fail-closes on active sessions',()=>{
  const code=fs.readFileSync(here+'install-lch-wildcard-on-mac.mjs','utf8');
  for(const guard of [
    'ACTIVE_DELEGATED_SESSION_NO_CHANGES',
    'CONCURRENT_CONFIGURATION_CHANGE',
    'CONCURRENT_ORIGIN_HELPER_CHANGE',
    'MIGRATED_JAVASCRIPT_SYNTAX_FAILURE',
    'UNKNOWN_MAC_BRIDGE_VERSION_NO_CHANGES',
    'BRIDGE_POLICY_OR_COUNT_MISMATCH',
    'WILDCARD_NOT_ACTIVE_IN_BOTH_DRIVERS',
    "command('/bin/launchctl',['kickstart','-k',launchLabel])",
    'ROLLED_BACK',
    'CloudSandboxBackups',
    'POST_WRITE_CONFIG_VALIDATION_FAILED'
  ])assert(code.includes(guard),'Missing guarded Mac migration invariant '+guard);
  assert(!code.includes('remote-debugging-port='));
  assert(!code.includes('chrome://inspect'));
  assert(!code.includes('docker restart'));
});

test('HCL iTime is an exact HTTPS host, not a blanket myhcl.com wildcard',()=>{
  const env='COMPUTER_USE_ALLOWED_ORIGINS=https://www.linkedin.com\n';
  const result=addLchOrigins(env);
  assert(result.updated.includes(HCL_ITIME_ORIGIN));
  assert.equal(addLchOrigins(result.updated).changed,false);
  const policy=new Set([HCL_ITIME_ORIGIN]);
  assert.equal(allowsWebOrigin('https://wf24.myhcl.com/iTime/ngiTime/home',policy),true);
  for(const denied of ['https://myhcl.com/', 'https://other.myhcl.com/',
    'http://wf24.myhcl.com/','https://wf24.myhcl.com.evil.example/',
    'https://wf24.myhcl.com:8443/'])
    assert.equal(allowsWebOrigin(denied,policy),false,denied);
});
