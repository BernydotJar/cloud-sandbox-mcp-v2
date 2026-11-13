import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const current=fs.readFileSync(path.join(root,'native-ax/AXBrowserHelper.swift'),'utf8');
const guest=fs.readFileSync(path.join(root,'isolated-desktop/GuestAX.swift'),'utf8');

test('macOS AX uses labeled path argument and Swift enum error comparisons',()=>{
  assert.match(current,/targetNode\(area,path: path\)/);
  assert.doesNotMatch(current,/targetNode\(area,path\)/);
  for(const swift of [current,guest]){
    assert.match(swift,/AXUIElementPerformAction\([^\n]+\) == \.success/);
    assert.doesNotMatch(swift,/\)==\.success/);
    assert.match(swift,/AXUIElementSetAttributeValue\(/);
    assert.doesNotMatch(swift,/\)==\.success/);
  }
});
test('sensitive AX text detection is built from an unambiguous joined Swift array',()=>{
  for(const swift of [current,guest]){
    assert.match(swift,/\.joined\(separator: " "\)\.lowercased\(\)/);
    assert.doesNotMatch(swift,/\+\s*\n\s*" "\s*\+/);
  }
  assert.match(current,/AXProtectedContent/);
  assert.match(guest,/AXIsProcessTrusted/);
});
test('AX helper remains semantic, not global input',()=>{
  for(const swift of [current,guest]){
    assert.doesNotMatch(swift,/CGEventPost|keyCode\(|osascript|--remote-debugging/);
    assert.match(swift,/AXUIElementSetAttributeValue/);
  }
});

test('handoff AX source and digest track authoritative helper exactly',()=>{
  const staged=fs.readFileSync(path.join(root,'../deploy/ax-readback/AXBrowserHelper.swift'),'utf8');
  const digest=fs.readFileSync(path.join(root,'../deploy/ax-readback/AXBrowserHelper.sha256'),'utf8').trim();
  const expected=crypto.createHash('sha256').update(Buffer.from(current)).digest('hex');
  assert.equal(staged,current);
  assert.equal(digest,expected);
});
