import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const folder=path.dirname(fileURLToPath(import.meta.url));
const source=name=>fs.readFileSync(path.join(folder,name),'utf8');

test('native AX on the same Mac never activates background targets or sends global input',()=>{
  const swift=source('SameMacAX.swift');
  assert.match(swift,/NSRunningApplication\.runningApplications/);
  assert.match(swift,/AXUIElementCreateApplication/);
  assert.match(swift,/AXUIElementSetAttributeValue/);
  assert.match(swift,/AXUIElementPerformAction/);
  assert.match(swift,/frontmost_unchanged/);
  assert.match(swift,/TARGET_IS_FRONTMOST_USE_FOREGROUND_MODE/);
  assert.match(swift,/FOREGROUND_CHANGED_BY_TARGET_APP/);
  for(const unsafe of ['.activate(','CGEventPost','CGEventCreate',
     'AXUIElementPostKeyboardEvent','System Events','keyCode(','--remote-debugging',
     'makeKeyAndOrderFront(']){
    assert.equal(swift.includes(unsafe),false,'forbidden native input: '+unsafe);
  }
});
test('Swift AX parser avoids known macOS typecheck errors and redacts sensitive input',()=>{
  const swift=source('SameMacAX.swift');
  assert.match(swift,/\.joined\(separator:" "\)\.lowercased\(\)/);
  assert.doesNotMatch(swift,/\)==\.success/);
  assert.doesNotMatch(swift,/\+\s*\n\s*" "\s*\+/);
  assert.match(swift,/AXIsProcessTrusted\(\)/);
  assert.match(swift,/isProtected\(/);
  assert.match(swift,/AX_VALUE_NOT_SETTABLE/);
});
test('disposable same-Mac fixture remains nonactivating',()=>{
  const fixture=source('SameMacAXFixture.swift');
  const executable=fixture.split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
  assert.match(fixture,/setActivationPolicy\(\.accessory\)/);
  assert.match(fixture,/panel\.orderBack\(nil\)/);
  assert.match(fixture,/Same Mac AX Fixture/);
  assert.match(fixture,/setAccessibilityLabel\("Hours"\)/);
  assert.match(fixture,/setAccessibilityLabel\("Apply"\)/);
  for(const forbidden of ['.activate(','makeKeyAndOrderFront(','CGEventPost'])
    assert.equal(executable.includes(forbidden),false);
});
test('installer targets the same Mac and changes no existing Bridge or browsers',()=>{
  const installer=source('install-on-mac.mjs');
  assert.match(installer,/SameMacBackgroundAX/);
  assert.match(installer,/com\.lch\.same-mac-ax/);
  assert.match(installer,/verifyManifest/);
  assert.match(installer,/SWIFT_TYPECHECK_/);
  assert.match(installer,/ACCESSIBILITY.*GRANT_ONCE/);
  assert.match(installer,/--allow-app/);
  assert.match(installer,/--certify-press/);
  for(const unsafe of [/\btart\s+(?:clone|create|run|pull)\b/,/docker\s+prune/,
    /remote-debugging/,/profile\s+delete/])
    assert.equal(unsafe.test(installer),false);
});
test('acceptance runs only on a disposable same-Mac AX fixture, without synthetic keystrokes',()=>{
  const acceptance=source('accept-on-mac.mjs');
  assert.match(acceptance,/open.*\['-g','-a',fixture\]/);
  assert.match(acceptance,/AX_VALUE_CHANGED_WITHOUT_FOCUS/);
  assert.match(acceptance,/PERSISTED_READBACK/);
  assert.match(acceptance,/frontmost_unchanged/);
  assert.match(acceptance,/OS_KEYSTROKES_SENT/);
  assert.doesNotMatch(acceptance,/osascript|CGEvent|Modify Entry|Log Work/);
});
