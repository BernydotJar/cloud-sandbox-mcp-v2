import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore} from './autonomy-session.mjs';
const request={scope:'both',duration_minutes:2,max_actions:2,purpose:'Navigate both browsers in a bounded task'};
test('delegation is time limited and expires without needing an explicit revoke',()=>{
 let t=1_000_000;
 const store=createSessionStore({now:()=>t,randomId:()=> 'a'.repeat(48)});
 const grant=store.begin(request);
 assert.equal(store.authorize(grant.session_id,'edge').remaining_actions,2);
 t+=120000;
 assert.equal(store.status().active,false);
 assert.throws(()=>store.authorize(grant.session_id,'edge'),/SESSION_NOT_ACTIVE/);
});
test('action budgets exhaust and end sessions automatically',()=>{
 const store=createSessionStore({randomId:()=> 'b'.repeat(48)});
 const grant=store.begin(request);
 assert.equal(store.authorize(grant.session_id,'chrome',{consume:true}).remaining_actions,1);
 assert.equal(store.authorize(grant.session_id,'edge',{consume:true}).remaining_actions,0);
 assert.equal(store.status().active,false);
 assert.throws(()=>store.authorize(grant.session_id,'edge',{consume:true}),/SESSION_NOT_ACTIVE/);
});
test('browser scope and random capability are enforced',()=>{
 const store=createSessionStore({randomId:()=> 'c'.repeat(48)});
 const grant=store.begin({...request,scope:'chrome'});
 assert.throws(()=>store.authorize(grant.session_id,'edge'),/SESSION_SCOPE_MISMATCH/);
 assert.throws(()=>store.authorize('d'.repeat(48),'chrome'),/SESSION_NOT_ACTIVE/);
 assert.throws(()=>store.begin(request),/SESSION_ALREADY_ACTIVE/);
 assert.equal(store.end().revoked,true);
});
test('stop revokes capability without a model-side token and does not persist',()=>{
 const store=createSessionStore({randomId:()=> 'e'.repeat(48)});
 const grant=store.begin(request);
 assert.equal(store.end().revoked,true);
 assert.equal(store.status().active,false);
 assert.throws(()=>store.authorize(grant.session_id,'chrome'),/SESSION_NOT_ACTIVE/);
});


test('operator-trusted grants remain prompt-free but exhaust after 200 actions',()=>{
  let now=7000;
  const store=createSessionStore({now:()=>now,randomId:()=> 'f'.repeat(48)});
  assert.throws(()=>store.begin({
    scope:'edge',duration_minutes:30,max_actions:200,unlimited_actions:true,
    purpose:'Reject unbounded delegation regardless of operator trust'
  }),/INVALID_SESSION_REQUEST/);
  const grant=store.begin({
    scope:'edge',duration_minutes:30,max_actions:200,
    purpose:'Allow a bounded operator trusted session for verified browser QA'
  });
  assert.equal(grant.remaining_actions,200);
  assert.equal(grant.unlimited_actions,false);
  for(let i=0;i<200;i++){
    const step=store.authorize(grant.session_id,'edge',{consume:true});
    assert.equal(step.remaining_actions,199-i);
  }
  assert.equal(store.status().active,false);
  assert.throws(()=>store.authorize(grant.session_id,'edge',{consume:true}),/SESSION_NOT_ACTIVE/);
  now+=30*60*1000;
  assert.equal(store.status().active,false);
});
