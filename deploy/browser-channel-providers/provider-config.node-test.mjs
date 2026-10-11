import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDebugMarker,reconcileProviderEnv,matchingTabs,registeredProviders} from './provider-config.mjs';

test('macOS debugging marker parses only valid numeric local ports',()=>{
  assert.equal(inspectDebugMarker('42429\n/devtools/browser/abc').port,42429);
  for(const invalid of ['','abc','3','9222x','99999','1\n','http://host:9222',
    '22\nbad','12345;whoami','4000'.repeat(100)])
    assert.throws(()=>inspectDebugMarker(invalid),/REMOTE_DEBUGGING_MARKER_INVALID/);
});
test('channel provider settings are added without changing existing unrelated env or tokens',()=>{
  const original='SECRET=redacted\nCOMPUTER_USE_BROWSER_V2=true\n';
  const patched=reconcileProviderEnv(original);
  assert(patched.startsWith(original));
  assert.equal((patched.match(/COMPUTER_USE_CHROME_ENDPOINT=chrome/g)||[]).length,1);
  assert.equal((patched.match(/COMPUTER_USE_EDGE_ENDPOINT=msedge/g)||[]).length,1);
  assert.equal(reconcileProviderEnv(patched),patched);
  assert(patched.includes('SECRET=redacted'));
});
test('CRLF, empty placeholders and duplicate/conflicting provider settings are handled',()=>{
  const old='A=b\r\nCOMPUTER_USE_CHROME_ENDPOINT=\r\n';
  const patched=reconcileProviderEnv(old);
  assert(patched.includes('COMPUTER_USE_CHROME_ENDPOINT=chrome'));
  assert(!patched.includes('\nCOMPUTER_USE_EDGE_ENDPOINT=msedge\n'));
  assert.throws(()=>reconcileProviderEnv('COMPUTER_USE_CHROME_ENDPOINT=chrome\nCOMPUTER_USE_CHROME_ENDPOINT=chrome\n'),/DUPLICATE_PROVIDER_SETTING/);
  assert.throws(()=>reconcileProviderEnv('COMPUTER_USE_EDGE_ENDPOINT=http://127.0.0.1:9223\n'),/PROVIDER_CONFIG_ALREADY_CUSTOMIZED/);
});
test('tab correlation never uses URL secrets or fragments, and demands enough native overlap',()=>{
  const native=['https://luma.lch-app.cloud/learn?session=secret',
    'https://admin.cloud.microsoft/?token=abc'];
  const connected=['https://luma.lch-app.cloud/learn?session=other',
    'https://admin.cloud.microsoft/#section'];
  assert.equal(matchingTabs(connected,native).verified,true);
  assert.equal(matchingTabs(['https://luma.lch-app.cloud/learn'],native).verified,false);
  assert.equal(matchingTabs(['https://attacker.invalid/'],native).verified,false);
  assert.equal(matchingTabs(connected,[]).verified,false);
});
test('both provider entries are required before calling the runtime configured',()=>{
  assert.equal(registeredProviders({providers:[]}),false);
  assert.equal(registeredProviders({providers:[{browser:'chrome',protocol:'cdp',configured:true}]}),false);
  assert.equal(registeredProviders({providers:[
    {browser:'chrome',protocol:'cdp',configured:true},
    {browser:'edge',protocol:'cdp',configured:true}]}),true);
});
