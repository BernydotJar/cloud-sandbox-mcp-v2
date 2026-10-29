import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backgroundBrowserRequest} from './background-browser.mjs';
const target={browser:'edge',window_index:1,tab_index:6,expected_url:'https://teams.cloud.microsoft/',expected_title:'Teams',window_title:'Teams - Microsoft Edge'};
function setup({denied=false,sessionDenied=false,uncertain=false}={}) {
 const calls=[];
 const deps={validate:(t,mutate)=>{calls.push(['validate',mutate]);if(denied&&mutate)throw Error('MUTATION_ORIGIN_DENIED');return [t.browser];},inspect:async()=>{calls.push(['inspect']);},sessionStore:{authorize:(id,b,opts)=>{if(sessionDenied||id!=='own')throw Error('SESSION_INVALID');calls.push(['authorize',Boolean(opts?.consume)]);}},audit:async e=>{calls.push(['audit',e.outcome]);},request:async(route,body)=>{calls.push(['request',route,body]);if(route==='identity')return {browser_url:target.expected_url,window_title:target.window_title,frontmost_unchanged:true};if(uncertain)throw Error('SAME_MAC_AX_ACTION_UNCERTAIN_INSPECT_BEFORE_RETRY');return {dispatched:true,frontmost_unchanged:true};}};
 return {calls,deps};
}
const action={...target,action:'set_value',session_id:'own',node_ref:'a'.repeat(64),expected_revision:'b'.repeat(64),request_id:'c'.repeat(64),reason:'Testing authorized own chat only',value:''};
test('background status and windows never inspect, focus or consume grants',async()=>{
 const f=setup();await backgroundBrowserRequest('status',{},f.deps);await backgroundBrowserRequest('windows',{browser:'edge'},f.deps);assert.equal(f.calls.filter(x=>x[0]==='inspect').length,0);assert.equal(f.calls.filter(x=>x[0]==='authorize').length,0);
});
test('background snapshot binds exact browser and AX window identity',async()=>{
 const f=setup();await assert.rejects(backgroundBrowserRequest('snapshot',{...target,window_title:'Other'},f.deps),/BACKGROUND_WINDOW_IDENTITY_REQUIRED/);assert(!f.calls.some(x=>x[0]==='request'));
 await backgroundBrowserRequest('snapshot',target,f.deps);const body=f.calls.find(x=>x[0]==='request'&&x[1]==='snapshot')[2];assert.equal(body.bundle_id,'com.microsoft.edgemac');
});
test('background mutation preserves strict allowlist before AX dispatch',async()=>{
 const f=setup({denied:true});await assert.rejects(backgroundBrowserRequest('action',action,f.deps),/MUTATION_ORIGIN_DENIED/);assert(!f.calls.some(x=>x[0]==='request'));
});
test('foreign or missing browser grants fail closed',async()=>{
 const f=setup({sessionDenied:true});await assert.rejects(backgroundBrowserRequest('action',action,f.deps),/SESSION_INVALID/);assert(!f.calls.some(x=>x[0]==='request'));
 const g=setup();await assert.rejects(backgroundBrowserRequest('action',{...action,session_id:undefined},g.deps),/BACKGROUND_TASK_SESSION_REQUIRED/);
});
test('authorized clear uses two identity checks and one budget consume',async()=>{
 const f=setup();await backgroundBrowserRequest('action',action,f.deps);assert.equal(f.calls.filter(x=>x[0]==='inspect').length,0);assert.equal(f.calls.filter(x=>x[0]==='request'&&x[1]==='identity').length,2);assert.equal(f.calls.filter(x=>x[0]==='authorize'&&x[1]).length,1);assert.equal(f.calls.filter(x=>x[0]==='request'&&x[1]==='action').length,1);assert.equal(f.calls.find(x=>x[0]==='request'&&x[1]==='action')[2].value,'');
});
test('uncertain AX dispatch is never replayed and returns uncertainty',async()=>{
 const f=setup({uncertain:true});await assert.rejects(backgroundBrowserRequest('action',action,f.deps),/UNCERTAIN/);assert.equal(f.calls.filter(x=>x[0]==='request'&&x[1]==='action').length,1);
});
test('no arbitrary application or endpoint enters the background gateway',async()=>{
 const f=setup();await assert.rejects(backgroundBrowserRequest('windows',{browser:'terminal'},f.deps),/INVALID_BROWSER/);await assert.rejects(backgroundBrowserRequest('shell',{},f.deps),/BACKGROUND_ROUTE_DENIED/);
});
test('AX URL identity drift blocks dispatch even if the title is unchanged',async()=>{
 const f=setup();const original=f.deps.request;
 f.deps.request=async(route,body)=>route==='identity'?{browser_url:'https://wrong.example/',window_title:target.window_title,frontmost_unchanged:true}:original(route,body);
 await assert.rejects(backgroundBrowserRequest('action',action,f.deps),/BACKGROUND_BROWSER_IDENTITY_CHANGED/);
 assert(!f.calls.some(c=>c[0]==='authorize'&&c[1]));assert(!f.calls.some(c=>c[0]==='request'&&c[1]==='action'));
});
test('background identity validation works with a broken legacy Apple Events inspect',async()=>{
 const f=setup();f.deps.inspect=async()=>{throw Error('NATIVE_UNAVAILABLE');};
 await backgroundBrowserRequest('action',action,f.deps);
 assert.equal(f.calls.filter(c=>c[0]==='request'&&c[1]==='action').length,1);
});
test('AX identity target requires no transient Apple Events indices and preserves origin policy',async()=>{
 const {verifyBackgroundTarget}=await import('./background-browser.mjs');
 const origins=new Set(['https://teams.cloud.microsoft']);const t={browser:'edge',expected_title:'Own chat',expected_url:'https://teams.cloud.microsoft/'};
 assert.doesNotThrow(()=>verifyBackgroundTarget(t,origins,true,true));
 assert.throws(()=>verifyBackgroundTarget({...t,expected_url:'https://wrong.example/'},origins,true,true),/MUTATION_ORIGIN_DENIED/);
 assert.throws(()=>verifyBackgroundTarget({...t,expected_url:'https://teams.cloud.microsoft/?token=x'},origins,true,false),/INVALID_TARGET/);
});
test('foreground error survives the existing MCP code-length boundary without revealing raw diagnostics',async()=>{
 const {backgroundErrorCode}=await import('./background-browser.mjs');
 const code=backgroundErrorCode('SAME_MAC_NATIVE_TARGET_IS_FRONTMOST_USE_FOREGROUND_MODE');
 assert.equal(code,'BACKGROUND_TARGET_FRONTMOST');assert(code.length<=50);
 assert.equal(backgroundErrorCode('private https://example.test/?token=secret'),'BACKGROUND_AX_UNAVAILABLE');
});
