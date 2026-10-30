import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL} from 'node:url';
import {exactHttpsOrigin,parseOriginSettings,changeExactOrigin,MAX_ORIGINS,SHORTCUT_SCRIPT}
  from './origin-manager-config.mjs';

const ENV='TOKEN=do-not-print\nCOMPUTER_USE_ALLOWED_ORIGINS="https://www.linkedin.com,https://*.lch-app.cloud"\nOTHER_FLAG=left-intact\n';

test('full page URLs normalize to a single exact hostname without exposing query',()=>{
  assert.equal(exactHttpsOrigin(
    'https://admin.powerplatform.microsoft.com/environments?code=private#frag'),
  'https://admin.powerplatform.microsoft.com');
  assert.equal(exactHttpsOrigin('https://ADMIN.PowerPlatform.Microsoft.com/'),
    'https://admin.powerplatform.microsoft.com');
  assert.equal(exactHttpsOrigin('https://www.Example.COM'), 'https://www.example.com');
});
test('reject arbitrary wildcard, unsafe hosts, protocols, ports, credentials and injection',()=>{
  for(const bad of [
    'http://admin.powerplatform.microsoft.com','https://*.microsoft.com',
    'https://admin.powerplatform.microsoft.com:4444/path',
    'https://admin.powerplatform.microsoft.com:443/path',
    'https://user:password@admin.powerplatform.microsoft.com/',
    'https://127.0.0.1','https://[::1]','https://localhost',
    'https://foo.local','https://a..example.com','https://-foo.example.com',
    'https://foo-.example.com','https://evil.example.com.',
    'https://foo.example.com.evil.invalid:8080/',
    'https://xn--e1afmkfd.example.com','https://bad_host.example.com',
    'https://example.com\nCOMPUTER_USE_ALLOWED_ORIGINS=https://evil.example',
    'https://example.com\t',' javascript:alert(1)', 'https://example.com ',
    'https://example.com:1337','example.com','https://domain',
    'https://ü.example.com','https://example.com\\evil',
    'https://example.com:443@evil.example','ftp://example.com'
  ])assert.throws(()=>exactHttpsOrigin(bad),undefined,bad);
});
test('single local add is additive, preserves unrelated exact bytes, and idempotent',()=>{
  const next=changeExactOrigin(ENV,'add',
    'https://admin.powerplatform.microsoft.com/environments');
  assert.equal(next.entry,'https://admin.powerplatform.microsoft.com');
  assert.equal(next.changed,true);
  assert.equal(next.beforeCount,2);
  assert.equal(next.afterCount,3);
  assert(next.updated.startsWith('TOKEN=do-not-print\n'));
  assert(next.updated.endsWith('OTHER_FLAG=left-intact\n'));
  assert(next.updated.includes('"https://www.linkedin.com,https://*.lch-app.cloud,https://admin.powerplatform.microsoft.com"'));
  const twice=changeExactOrigin(next.updated,'add',next.entry);
  assert.equal(twice.changed,false);
  assert.equal(twice.updated,next.updated);
  assert.equal(twice.alreadyAllowed,true);
});
test('known approved wildcard covers subdomains without redundant origin entry',()=>{
  const result=changeExactOrigin(ENV,'add','https://app.lch-app.cloud/project');
  assert.equal(result.changed,false);
  assert.equal(result.alreadyAllowed,true);
  assert.equal(result.updated,ENV);
  assert.equal(result.afterCount,2);
});
test('check is strictly read-only and remove revokes only exact origin',()=>{
  assert.equal(changeExactOrigin(ENV,'check',
    'https://admin.powerplatform.microsoft.com').changed,false);
  const added=changeExactOrigin(ENV,'add',
    'https://admin.powerplatform.microsoft.com');
  const removed=changeExactOrigin(added.updated,'remove',
    'https://admin.powerplatform.microsoft.com');
  assert.equal(removed.changed,true);
  assert.equal(removed.allowedAfter,false);
  assert.equal(removed.updated,ENV);
  assert.equal(changeExactOrigin(ENV,'remove',
    'https://admin.powerplatform.microsoft.com').changed,false);
});
test('a wildcard-authorized origin cannot be falsely revoked',()=>{
  assert.throws(()=>changeExactOrigin(ENV,'remove',
    'https://learning.lch-app.cloud'),/ORIGIN_STILL_ALLOWED_BY_WILDCARD/);
  const explicit=ENV.replace('https://*.lch-app.cloud',
    'https://*.lch-app.cloud,https://learning.lch-app.cloud');
  assert.throws(()=>changeExactOrigin(explicit,'remove',
    'https://learning.lch-app.cloud'),/ORIGIN_STILL_ALLOWED_BY_WILDCARD/);
});
test('fail closed on mixed newline, duplicate, invalid wildcard or quota',()=>{
  for(const source of [
    'COMPUTER_USE_ALLOWED_ORIGINS=https://good.example\r\nX=1\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://good.example\nCOMPUTER_USE_ALLOWED_ORIGINS=https://evil.example\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://*.not-approved.example\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://valid.example,https://valid.example\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://valid.example/path\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://valid.example,\n',
    'OTHER=1\n','COMPUTER_USE_ALLOWED_ORIGINS=',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://valid.example\nCORRUPT=\r'
  ])assert.throws(()=>parseOriginSettings(source),undefined,source);
  const full=Array.from({length:MAX_ORIGINS},(_,n)=>
    'https://host'+n+'.example.com').join(',');
  assert.throws(()=>changeExactOrigin(
    'COMPUTER_USE_ALLOWED_ORIGINS='+full+'\n','add',
    'https://another.example.com'),/ORIGIN_ALLOWLIST_CAPACITY_REACHED/);
});
test('CRLF, quoting and other config lines are preserved byte-for-byte',()=>{
  for(const eol of ['\n','\r\n']){
    for(const quote of ['"',"'"]){
      const source=['A=1','COMPUTER_USE_ALLOWED_ORIGINS='+quote+
        'https://www.linkedin.com'+quote,'B=2',''].join(eol);
      const next=changeExactOrigin(source,'add','https://example.com/x?q=secret');
      assert(next.updated.startsWith('A=1'+eol));
      assert(next.updated.endsWith(eol+'B=2'+eol));
      assert(next.updated.includes(quote+'https://www.linkedin.com,https://example.com'+quote));
      assert.equal(changeExactOrigin(next.updated,'remove','https://example.com').updated,source);
    }
  }
});
test('Mac operator tool is inspectable and preserves code/runtime gates',()=>{
  const code=fs.readFileSync(new URL('./manage-on-mac.mjs',import.meta.url),'utf8');
  for(const invariant of [
    "process.platform!=='darwin'",'RUN_AS_MAC_OPERATOR_NOT_ROOT',
    'ACTIVE_DELEGATED_SESSION_RETRY_AFTER_COMPLETION',
    'DELEGATED_SESSION_STARTED_DURING_PREFLIGHT',
    'CONCURRENT_CONTROLLER_ENV_CHANGE','ORIGIN_MANAGER_BUSY',
    'CloudSandboxBackups','controller.env.previous',
    "['kickstart','-k',launchLabel]",
    "'/v1/status'","'/v2/browser/status'",
    'assertSafePolicy(after,update.origins)',
    'POST_WRITE_CONFIG_MISMATCH','ROLLBACK',
    'OPERATION','check','remove',
    'MAC_PRIVATE_PINNED','INSTALLED_RELEASE_DRIFT_REVIEW_REQUIRED'
  ])assert(code.includes(invariant),'missing operator safety invariant '+invariant);
  for(const unsafe of [
    'docker restart','--remote-debugging-port','eval(', 'process.env.NODE_ENV'
  ])assert(!code.includes(unsafe),'unsafe operation in Mac manager '+unsafe);
});


test('short Mac Terminal shortcut delegates without changing Sandbox V3 CLI',()=>{
  assert(SHORTCUT_SCRIPT.startsWith('#!/bin/sh\n'));
  assert(SHORTCUT_SCRIPT.endsWith('"$@"\n'));
  assert(SHORTCUT_SCRIPT.includes('exec node "$HOME/.local/share/sandbox-v3-origins/'));
  assert(SHORTCUT_SCRIPT.includes('v1/manage-on-mac.mjs'));
  assert(!SHORTCUT_SCRIPT.includes('.cloud-sandbox-mcp-data'));
  assert(!SHORTCUT_SCRIPT.includes('sudo'));
  assert(!SHORTCUT_SCRIPT.includes('docker'));
});
