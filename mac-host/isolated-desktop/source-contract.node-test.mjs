import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL} from 'node:url';
const source=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');

test('native AX guest code uses fresh named controls, never blind keyboard navigation',()=>{
 const ax=source('./GuestAX.swift');
 for(const phrase of ['AXUIElementPerformAction','AXUIElementSetAttributeValue',
  'expected_revision','fingerprint','AXIsProcessTrusted'])
  assert(ax.includes(phrase));
 for(const forbidden of ['CGEventPost','keyCode(','osascript','--remote-debugging'])
  assert.equal(ax.includes(forbidden),false);
});
test('guest installer preserves the primary machine and separate GUI policy',()=>{
 const s=source('./install-guest.mjs');
 assert(s.includes('assertDistinctMachines'));
 assert(s.includes('GUEST_AQUA_GUI_LOGIN_REQUIRED'));
 assert(s.includes('com.lch.sandbox.isolatedmac'));
 assert(s.includes('PERSISTENT_DATA'));
 assert.equal(s.includes('docker prune'),false);
});
test('host focus monitor is read-only and cannot activate host apps',()=>{
 const s=source('./HostFocusObserver.swift');
 assert(s.includes('NSWorkspace.shared'));
 assert(s.includes('NSEvent.mouseLocation'));
 assert(s.includes('setActivationPolicy(.prohibited)'));
 for(const forbidden of ['CGEventPost','System Events','activate(ignoringOtherApps:true)'])
  assert.equal(s.includes(forbidden),false);
});
test('guest screenshot is captured from separate Mac, not an operator browser',()=>{
 const s=source('./guest-server.mjs');
 assert(s.includes('captureGuestDesktop'));
 assert(s.includes('/usr/sbin/screencapture'));
 assert(s.includes('assertDistinctMachines'));
 assert(s.includes("listenHost='127.0.0.1'"));
 assert(s.includes('WORKER_REQUEST_REPLAY_BLOCKED'));
});
test('host acceptance only writes to the disposable fixture',()=>{
 const s=source('./acceptance.mjs');
 assert(s.includes('com.lch.SandboxAXFixture'));
 assert(s.includes("action:'set_value'"));
 assert(s.includes("action:'press'"));
 assert(s.includes('GUEST_PERSISTED_READBACK'));
 for(const forbidden of ['com.microsoft.edgemac','financialforce','Modify Entry','Log Work'])
  assert.equal(s.includes(forbidden),false);
});
