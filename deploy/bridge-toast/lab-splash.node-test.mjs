import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const swift=fs.readFileSync(path.join(root,'bridge-toast.swift'),'utf8');
test('splash is native macOS AppKit overlay, never a web page',()=>{
  assert.match(swift,/import AppKit/);
  assert.match(swift,/NSPanel\(contentRect:/);
  assert.match(swift,/styleMask: \[\.borderless, \.nonactivatingPanel\]/);
  assert.match(swift,/panel\.collectionBehavior = \[\.canJoinAllSpaces, \.fullScreenAuxiliary, \.stationary\]/);
  assert.match(swift,/connectionLifetime: TimeInterval = 5\.0/);
  assert.match(swift,/panel\.ignoresMouseEvents = !\(delegated \|\| alerted\)/);
});
test('laboratory particle burst is local and honors macOS Reduce Motion',()=>{
  assert.match(swift,/private final class LabBurstView: NSView/);
  assert.match(swift,/\.systemCyan, \.systemPink, \.systemOrange/);
  assert.match(swift,/CAKeyframeAnimation\(keyPath: "opacity"\)/);
  assert.match(swift,/accessibilityDisplayShouldReduceMotion/);
  assert.doesNotMatch(swift,/(?:https?:\/\/|--remote-debugging)/);
});
test('alert modes have bounded lifetime, restricted codes and actionable native controls',()=>{
  for(const label of ['storage','edge','terminal','recovery'])
    assert.match(swift,new RegExp('"'+label+'":'));
  assert.match(swift,/let alerted = alertInfo != nil/);
  assert.match(swift,/alertLifetime: TimeInterval = 20\.0/);
  assert.match(swift,/NSButton\(title: "Ver registros"/);
  assert.match(swift,/NSWorkspace\.shared\.open\(folder\)/);
  assert.match(swift,/if delegated \|\| alerted/);
  assert.match(swift,/closing revokes a session|closing revokes a session|closing revokes a session/i);
  assert.doesNotMatch(swift,/shell -c|Process\(\)|URLSession/);
});

test('all global values constructed from private Swift view types are also private',()=>{
  const privateTypes=[...swift.matchAll(/^private (?:final )?class (\w+)/gm)]
    .map(m=>m[1]);
  for(const type of privateTypes){
    const declarations=[...swift.matchAll(
      new RegExp('^(?:private )?let \\w+ = '+type+'\\(', 'gm'))];
    for(const match of declarations){
      assert(match[0].startsWith('private let '),
        'private '+type+' must not leak through a non-private global binding');
    }
  }
  assert.match(swift,/private let burst = LabBurstView\(/);
});

test('Mac preview exposes Swift diagnostics instead of swallowing stderr',()=>{
  const script=fs.readFileSync(path.join(root,'preview-on-mac.mjs'),'utf8');
  assert.match(script,/SWIFT_DIAGNOSTIC/);
  assert.match(script,/error\?\.stderr/);
  assert.match(script,/compilerStep\('SWIFT_TOOLCHAIN'/);
  assert.match(script,/compilerStep\('SWIFT_TYPECHECK'/);
  assert.match(script,/compilerStep\('SWIFT_COMPILE'/);
  assert.match(script,/SOURCE_DIGEST_MISMATCH/);
  assert.match(script,/INSTALLED_BRIDGE_UNCHANGED/);
  assert.doesNotMatch(script,/xcode-select\s+--switch|--remote-debugging/);
});
