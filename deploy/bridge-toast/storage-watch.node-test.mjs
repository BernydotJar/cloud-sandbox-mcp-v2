import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL} from 'node:url';
import {capacityLevel,alertDecision,parseDf} from './storage-watch-on-mac.mjs';

const reading=(availableGiB,usedPercent)=>({availableGiB,usedPercent});

test('native monitor uses identical warning and critical thresholds',()=>{
  assert.equal(capacityLevel(19.2,96),'CRITICAL');
  assert.equal(capacityLevel(200,95),'CRITICAL');
  assert.equal(capacityLevel(52,80),'WARNING');
  assert.equal(capacityLevel(200,91),'WARNING');
  assert.equal(capacityLevel(140,72),'OK');
});
test('notify only on new, severity-changed, or >=5 GiB degradation',()=>{
  const critical=reading(20,96);
  assert.equal(alertDecision(critical,null).notify,true);
  assert.equal(alertDecision(reading(19,96),{level:'CRITICAL',availableGiB:20}).notify,false);
  assert.equal(alertDecision(reading(14,97),{level:'CRITICAL',availableGiB:20}).notify,true);
  assert.equal(alertDecision(critical,{level:'WARNING',availableGiB:20}).notify,true);
  assert.equal(alertDecision(reading(170,60),{level:'CRITICAL',availableGiB:14}).notify,false);
  assert.equal(alertDecision(reading(19,96),{level:'OK',availableGiB:170}).notify,true);
});
test('df parser reads KiB, not virtiofs block size, and rejects malformed output',()=>{
  const data=parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n'+
    'virtiofs0 494384795 472568389 21816406 96% /workspace\n');
  assert.equal(data.availableGiB,20.81);
  assert.equal(data.usedPercent,96);
  assert.throws(()=>parseDf('junk'),/INVALID_DF_RESULT/);
});
test('host watchdog only calls read-only Docker df, no cleanup or browser modification',()=>{
  const src=fs.readFileSync(new URL('./storage-watch-on-mac.mjs',import.meta.url),'utf8');
  assert(src.includes("['docker','exec','cloud-sandbox-dev-main','df','-Pk','/workspace']"));
  assert.match(src,/StartInterval/);
  assert.match(src,/21600/);
  assert.match(src,/STABLE_SUPPRESS_REPEAT/);
  assert.match(src,/--status-alert/);
  assert.doesNotMatch(src,/docker.*(prune|rm)|remote-debugging|launchctl.*kickstart/);
});
