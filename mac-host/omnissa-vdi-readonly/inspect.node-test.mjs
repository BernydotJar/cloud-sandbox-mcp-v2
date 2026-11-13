import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {classify} from './inspect-on-mac.mjs';

const valid={
  schema:'omnissa.vdi.host-readonly.v1',running:true,candidate_count:1,
  bundle_id:'com.example.horizon',accessibility_trusted:true,
  screen_capture_preflight:false,window_count:1,role_count:12,
  interactive_role_count:2,foreground_unchanged:true,
  captured_remote_content:false,sent_input:false
};
test('host AX presence is NOT proof that Windows VDI DOM is available',()=>{
  assert.equal(classify(valid),'HOST_AX_VISIBLE_WINDOWS_GUEST_SEMANTICS_UNVERIFIED');
  assert.equal(classify({...valid,role_count:0,interactive_role_count:0}),
    'HOST_AX_VISIBLE_WINDOWS_GUEST_SEMANTICS_UNVERIFIED');
});
test('client absent, ambiguous PID, no AX permission and no window are distinct',()=>{
  assert.equal(classify({...valid,running:false,candidate_count:0,bundle_id:''}),
    'OMNISSA_CLIENT_NOT_RUNNING');
  assert.equal(classify({...valid,candidate_count:2,bundle_id:''}),
    'OMNISSA_APP_IDENTITY_AMBIGUOUS');
  assert.equal(classify({...valid,accessibility_trusted:false}),
    'HOST_ACCESSIBILITY_PERMISSION_NOT_GRANTED');
  assert.equal(classify({...valid,window_count:0}), 'NO_ACCESSIBLE_HORIZON_WINDOW');
  assert.equal(classify({...valid,foreground_unchanged:false}),
    'FOREGROUND_CHANGED_DURING_READ_STOP');
});
test('fail closed when the reported inspection claims screenshots, mutations or malformed data',()=>{
  for(const patch of [
    {captured_remote_content:true},{sent_input:true},
    {candidate_count:-1},{window_count:45},{interactive_role_count:100},
    {bundle_id:'bad bundle <credential>'},{schema:'wrong'},
    {role_count:400}
  ])assert.throws(()=>classify({...valid,...patch}),/INVALID_NATIVE_INSPECTION/);
});
test('one-shot tool hashes Swift source and performs no input, capture or policy mutation',()=>{
  const swift=fs.readFileSync(new URL('./OmnissaReadOnlyDoctor.swift',import.meta.url),'utf8');
  const node=fs.readFileSync(new URL('./inspect-on-mac.mjs',import.meta.url),'utf8');
  const hash=createHash('sha256').update(swift).digest('hex');
  assert(node.includes("SOURCE_SHA256='"+hash+"'"));
  for(const forbidden of [
    'AXUIElementPerformAction','AXUIElementSetAttributeValue','CGEventPost',
    'CGWindowListCreateImage','CGRequestScreenCaptureAccess',
    'AXIsProcessTrustedWithOptions','AXValue','kAXValueAttribute',
    'kAXTitleAttribute','activate(options:', 'screencapture', 'AXPress'
  ])assert(!swift.includes(forbidden),'non-read-only Swift primitive '+forbidden);
  for(const forbidden of [
    'kickstart','docker restart','--activate',
    'fs.writeFileSync','fs.appendFileSync','osascript',
    "['--worker']","['--client']"
  ])assert(!node.includes(forbidden),'non-read-only doctor action '+forbidden);
  assert(swift.includes('CGPreflightScreenCaptureAccess()'));
  assert(swift.includes('AXIsProcessTrusted()'));
  assert(node.includes("'--inspect'"));
});
