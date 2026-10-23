/* global URL */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {addLinkedInOrigin,LINKEDIN_ORIGIN} from './linkedin-config.mjs';

const origins=[
  'https://admin.microsoft.com',
  'https://admin.cloud.microsoft',
  'https://dash.cloudflare.com',
  'https://dcc.godaddy.com',
  'https://account.godaddy.com',
  'https://suno.com'
];
const fixture = ({quote='',eol='\n'}={}) => [
  '# Do not modify unrelated settings',
  'COMPUTER_USE_ENABLED=true',
  'COMPUTER_USE_BRIDGE_TOKEN=private_test_token_never_print',
  'COMPUTER_USE_ALLOWED_ORIGINS='+quote+origins.join(',')+quote,
  'COMPUTER_USE_TRUSTED_SESSION_NOTICE=true',
  '# End'
].join(eol)+eol;

test('LinkedIn exact HTTPS origin is appended once, preserving keys, order, secrets and comments',()=>{
  const input=fixture();
  const result=addLinkedInOrigin(input);
  assert.equal(result.changed,true);
  assert.equal(result.origin,LINKEDIN_ORIGIN);
  assert.equal(result.beforeCount,6);
  assert.equal(result.afterCount,7);
  assert.equal(result.updated.replace(','+LINKEDIN_ORIGIN,'') ,input);
  assert(!result.updated.includes('https://linkedin.com,'));
  assert(!result.updated.includes('https://*.linkedin.com'));
  assert(result.updated.includes('COMPUTER_USE_BRIDGE_TOKEN=private_test_token_never_print'));
  assert.equal(addLinkedInOrigin(result.updated).changed,false);
  assert.equal(addLinkedInOrigin(result.updated).updated,result.updated);
});

test('double and single quoted allowlists retain exact quotes and line endings',()=>{
  for(const eol of ['\n','\r\n'])for(const quote of ["'",'"']){
    const input=fixture({quote,eol});
    const result=addLinkedInOrigin(input);
    assert(result.updated.includes('COMPUTER_USE_ALLOWED_ORIGINS='+quote+
      origins.join(',')+','+LINKEDIN_ORIGIN+quote));
    assert.equal(result.updated.split(eol).length,input.split(eol).length);
    assert.equal(addLinkedInOrigin(result.updated).updated,result.updated);
  }
});
test('pre-existing LinkedIn allowlist is not modified, even when not last',()=>{
  const input=fixture().replace('https://dash.cloudflare.com',
    'https://www.linkedin.com,https://dash.cloudflare.com');
  const result=addLinkedInOrigin(input);
  assert.equal(result.changed,false);
  assert.equal(result.afterCount,7);
  assert.equal(result.updated,input);
});
test('reject missing or multiple origin settings without creating a new key',()=>{
  assert.throws(()=>addLinkedInOrigin(fixture().replace(/COMPUTER_USE_ALLOWED_ORIGINS=.*\n/,''))
    ,/MISSING_ALLOWED_ORIGINS_KEY/);
  assert.throws(()=>addLinkedInOrigin(fixture()+'COMPUTER_USE_ALLOWED_ORIGINS=https://www.linkedin.com\n'),
    /DUPLICATE_ALLOWED_ORIGINS_KEY/);
});
test('reject unsafe wildcard, invalid URL, non-HTTPS or non-origin values',()=>{
  for(const unsafe of [
    'http://www.linkedin.com',
    'https://www.linkedin.com/path',
    'https://www.linkedin.com/',
    'https://evil.example?continue=https://www.linkedin.com',
    'https://evil.example#fragment',
    'https://u:p@example.com',
    'https://a.example,https://a.example',
    'not-an-origin','https://foo.example,'
  ]) {
    assert.throws(()=>addLinkedInOrigin(
      'COMPUTER_USE_ALLOWED_ORIGINS='+unsafe+'\n'),
    /INVALID_|DUPLICATE_/,'unsafe '+unsafe);
  }
});
test('reject malformed dotenv, comments, escape codes and newline drift',()=>{
  for(const env of [
    'COMPUTER_USE_ALLOWED_ORIGINS=\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://x.example # malicious comment\n',
    'COMPUTER_USE_ALLOWED_ORIGINS="https://x.example\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://x.example\0\n',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://x.example\r',
    'COMPUTER_USE_ALLOWED_ORIGINS=https://x.example\r\nNEXT=x\n'
  ])assert.throws(()=>addLinkedInOrigin(env));
});
test('50 existing trusted origins do not silently exceed the configured limit',()=>{
  const longList=Array.from({length:50},(_,i)=>'https://tenant-'+i+'.example').join(',');
  assert.throws(()=>addLinkedInOrigin('COMPUTER_USE_ALLOWED_ORIGINS='+longList+'\n'),
    /ALLOWED_ORIGINS_LIMIT/);
});

test('operator installer validates live policy, session inactivity and rollback before reporting success',()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('./install-linkedin-on-mac.mjs',import.meta.url)),'utf8');
  for(const expected of [
    'ACTIVE_DELEGATED_SESSION_NO_CHANGES',
    'CONTROLLER_ENV_CHANGED_NO_CHANGES',
    'ALREADY_ALLOWED',
    'ROLLED_BACK',
    'launchctl',
    'CloudSandboxBackups',
    'UNEXPECTED_BRIDGE_POLICY_OR_ORIGIN_COUNT',
    'CHROME_PROFILES',
    'atomicReplace'
  ]) assert(source.includes(expected),expected+' missing');
  assert(!source.includes('COMPUTER_USE_DEDICATED_CHROME_AUTO_START='));
});


test('LinkedIn reinstallation remains idempotent after the LCH wildcard release',()=>{
  const input='COMPUTER_USE_ALLOWED_ORIGINS=https://admin.microsoft.com,'+
    'https://www.linkedin.com,https://lch-app.cloud,https://*.lch-app.cloud\n';
  const updated=addLinkedInOrigin(input);
  assert.equal(updated.changed,false);
  assert.equal(updated.afterCount,4);
  assert.equal(updated.updated,input);
});

test('specifically allowed LinkedIn wildcard is valid after enterprise policy upgrade',()=>{
  const source='COMPUTER_USE_ALLOWED_ORIGINS=https://www.linkedin.com,https://*.linkedin.com\n';
  assert.equal(addLinkedInOrigin(source).updated,source);
});
