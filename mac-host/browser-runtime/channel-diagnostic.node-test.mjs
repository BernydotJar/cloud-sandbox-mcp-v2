import {test} from 'node:test';
import assert from 'node:assert/strict';
import {channelMarkerState,channelRemediation} from './connection-pool.mjs';

test('edge disabled debugger is diagnosed without launching Edge or exposing a port',()=>{
  const result=channelMarkerState('edge',{home:'/mock',readFile:()=>{
    const error=Error('missing');error.code='ENOENT';throw error;
  }});
  assert.equal(result,'missing');
  assert.equal(channelRemediation({connected:false,attachFailure:'BROWSER_ATTACH_FAILED',
    marker:result}),'OPERATOR_ENABLE_REMOTE_DEBUGGING_NO_BROWSER_RESTART_AUTOMATION');
});
test('read-only marker validation returns status but never port number',()=>{
  const marker=channelMarkerState('chrome',{readFile:()=> '9223\n/devtools/browser/session' });
  assert.equal(marker,'valid');
  assert(!marker.includes('9223'));
  assert.equal(channelRemediation({connected:true,attachFailure:null,marker}),'NONE');
  assert.equal(channelMarkerState('edge',{readFile:()=> 'not-a-port'}),'invalid');
  assert.equal(channelRemediation({connected:false,attachFailure:'BROWSER_ATTACH_FAILED',
    marker:'invalid'}),'INVALID_DEBUG_MARKER_DO_NOT_GUESS_PORT');
});
test('unverified marker cannot be treated as CDP success',()=>{
  assert.equal(channelRemediation({connected:false,attachFailure:null,marker:'valid'}),'NOT_TESTED');
  assert.equal(channelRemediation({connected:false,attachFailure:'BROWSER_ATTACH_FAILED',
    marker:'valid'}),'READ_ONLY_MAC_CHANNEL_DIAGNOSTIC_REQUIRED');
});
