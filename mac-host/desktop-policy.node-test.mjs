import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopRequestGate,validateMutation,parseAllowedBundles,validateDesktopConfig} from './desktop-policy.mjs';
import {createSessionStore} from './autonomy-session.mjs';
const bundles=parseAllowedBundles('com.apple.finder,com.apple.Terminal,com.microsoft.VSCode');
const base={bundle_id:'com.apple.Terminal',pid:123,window_index:1,expected_title:'Terminal',
 session_id:'a'.repeat(48),request_id:'native-action-id-0001',reason:'Inspect requested local terminal',
 action:'click',element_path:'0.1',expected_role:'AXButton',expected_name:'OK'};
test('desktop feature disabled by default, enabled needs explicit bundle allowlist',()=>{
 assert.doesNotThrow(()=>validateDesktopConfig({enabled:false,allowedBundles:new Set()}));
 assert.throws(()=>validateDesktopConfig({enabled:true,allowedBundles:new Set()}),/INVALID_MAC_ALLOWLIST/);
 assert.throws(()=>parseAllowedBundles('com.apple.Terminal,com.apple.Terminal'),/INVALID_MAC_ALLOWLIST/);
});
test('desktop actions enforce allowlist, identity and semantic AX element',()=>{
 assert.equal(validateMutation(base,bundles)[0],'com.apple.Terminal');
 assert.throws(()=>validateMutation({...base,bundle_id:'com.apple.keychainaccess'},bundles),/MAC_APP_NOT_ALLOWED/);
 assert.throws(()=>validateMutation({...base,pid:0},bundles),/INVALID_MAC_TARGET/);
 assert.throws(()=>validateMutation({...base,element_path:'0.__proto__'},bundles),/INVALID_MAC_ELEMENT/);
 assert.throws(()=>validateMutation({...base,expected_name:''},bundles),/INVALID_MAC_ELEMENT/);
 assert.throws(()=>validateMutation({...base,session_id:''},bundles),/SESSION_NOT_ACTIVE/);
});
test('mac desktop grant does not permit Chrome or Edge and browser grant does not permit desktop',()=>{
 const store=createSessionStore({randomId:()=> 'b'.repeat(48)});
 const mac=store.begin({scope:'mac',duration_minutes:1,max_actions:2,purpose:'Control allowlisted desktop UI'});
 assert.equal(store.authorize(mac.session_id,'mac').remaining_actions,2);
 assert.throws(()=>store.authorize(mac.session_id,'chrome'),/SESSION_SCOPE_MISMATCH/);
 store.end(mac.session_id);
 const browser=store.begin({scope:'both',duration_minutes:1,max_actions:2,purpose:'Control browser tabs only'});
 assert.throws(()=>store.authorize(browser.session_id,'mac'),/SESSION_SCOPE_MISMATCH/);
});
test('desktop request ids never dispatch twice',()=>{
 const gate=createDesktopRequestGate();
 gate.claim(base.request_id);
 assert.throws(()=>gate.claim(base.request_id),/MAC_REQUEST_ALREADY_DISPATCHED/);
});
