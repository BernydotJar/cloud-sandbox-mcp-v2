import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForLocalAXStatus,isTransientStartupFailure} from './startup-probe.mjs';

const token='t'.repeat(48);
const ready={
  provider:'same_mac_background_ax',
  same_machine_verified:true,
  ready:false,
  ax_permission:false,
  gui_session:true
};
const reply=(status=200,data=ready)=>({
  ok:status===200,status,
  json:async()=>({ok:status===200,data})
});
test('bootstrap startup race is retried and reaches authenticated local service',async()=>{
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url,options});
    if(calls.length<=2){
      const error=new TypeError('fetch failed');
      error.cause={code:'ECONNREFUSED'};
      throw error;
    }
    return reply();
  };
  const status=await waitForLocalAXStatus(token,{
    attempts:4,intervalMs:0,fetchImpl
  });
  assert.equal(calls.length,3);
  assert.equal(status.provider,'same_mac_background_ax');
  assert.equal(status.ax_permission,false);
  for(const call of calls){
    assert.equal(call.url,'http://127.0.0.1:9779/v1/status');
    assert.equal(call.options.headers.authorization,'Bearer '+token);
  }
});
test('unauthenticated 401 is terminal and never retried',async()=>{
  let calls=0;
  await assert.rejects(waitForLocalAXStatus(token,{
    attempts:30,intervalMs:0,
    fetchImpl:async()=>{calls++;return reply(401);}
  }),/SAME_MAC_STATUS_HTTP_401/);
  assert.equal(calls,1);
});
test('a wrong AX service on 9779 must not be considered ready',async()=>{
  let calls=0;
  await assert.rejects(waitForLocalAXStatus(token,{
    attempts:30,intervalMs:0,
    fetchImpl:async()=>{
      calls++;
      return reply(200,{provider:'unrelated_listener',
        same_machine_verified:true});
    }
  }),/SAME_MAC_STATUS_PROVIDER_MISMATCH/);
  assert.equal(calls,1);
});
test('permanently failed startup reports deterministic error after bounded retries',async()=>{
  let calls=0;
  await assert.rejects(waitForLocalAXStatus(token,{
    attempts:3,intervalMs:0,fetchImpl:async()=>{
      calls++;throw new TypeError('fetch failed');
    }
  }),/SAME_MAC_SERVICE_NOT_RESPONDING_USE_DOCTOR/);
  assert.equal(calls,3);
});
test('nontransport errors remain errors, not automatic retries',async()=>{
  assert.equal(isTransientStartupFailure(new TypeError('fetch failed')),true);
  assert.equal(isTransientStartupFailure(Object.assign(new Error(),{
    cause:{code:'ECONNREFUSED'}})),true);
  assert.equal(isTransientStartupFailure(new Error('SAME_MAC_AX_PERMISSION_REQUIRED')),false);
  await assert.rejects(waitForLocalAXStatus('short'),/SAME_MAC_STATUS_PROBE_INVALID/);
});
