import test from 'node:test';
import assert from 'node:assert/strict';
import {
  overlayFor,comparableConfig,confirmOnlyImageChanged,verifyControllerMetadata,
  ORIGINAL_IMAGE,V2_IMAGE,V2_TAG,BASE_TAG
} from './promotion-core.mjs';

const base = {
  name:'sandbox',
  services:{
    mcp:{build:{context:'/custom'},environment:{PORT:'3000'},restart:'unless-stopped',
      volumes:[{type:'bind',source:'/existing',target:'/app/dist'}]},
    n8n:{image:'n8nio/n8n:latest'}
  },
  networks:{default:{name:'sandbox_default'}}
};
function next(){return JSON.parse(JSON.stringify(base));}
test('only changing mcp image is accepted',()=>{
  const after=next();after.services.mcp.image=V2_TAG;
  assert.equal(confirmOnlyImageChanged(base,after,V2_TAG),true);
  const rollback=next();rollback.services.mcp.image=BASE_TAG;
  assert.equal(confirmOnlyImageChanged(base,rollback,BASE_TAG),true);
});
test('any network, env, mount, restart, build or other-service drift is rejected',()=>{
  for(const mutate of [
    v=>v.services.mcp.environment.PORT='4444',
    v=>v.services.mcp.volumes=[],
    v=>v.services.mcp.restart='always',
    v=>v.services.mcp.build.context='/other',
    v=>v.services.n8n.image='n8nio/n8n:changed',
    v=>v.networks.default.name='another'
  ]){
    const after=next();after.services.mcp.image=V2_TAG;mutate(after);
    assert.throws(()=>confirmOnlyImageChanged(base,after,V2_TAG),/COMPOSE_CONFIG_DRIFT/);
  }
});
test('invalid image reference cannot be promoted or rendered',()=>{
  assert.throws(()=>overlayFor('ubuntu:latest'),/IMAGE_NOT_RELEASE_APPROVED/);
  assert.match(overlayFor(V2_TAG),/services:\n  mcp:\n    image: cloud-sandbox/);
  assert.throws(()=>confirmOnlyImageChanged(base,base,V2_TAG),/TARGET_IMAGE_OVERRIDE_MISSING/);
  assert.match(ORIGINAL_IMAGE,/^sha256:/);
  assert.match(V2_IMAGE,/^sha256:/);
});
test('unexpected Compose controller identity fails closed',()=>{
  const item={Id:'c'.repeat(64),Image:ORIGINAL_IMAGE,State:{Running:true},
    Config:{Labels:{'com.docker.compose.service':'mcp'}}};
  assert.equal(verifyControllerMetadata([item]),item);
  assert.throws(()=>verifyControllerMetadata([{...item,State:{Running:false}}]),
    /CONTROLLER_IDENTITY_OR_RUNTIME_DRIFT/);
  assert.throws(()=>verifyControllerMetadata([item,item]),
    /CONTROLLER_IDENTITY_OR_RUNTIME_DRIFT/);
  assert.throws(()=>verifyControllerMetadata([{...item,Config:{Labels:{'com.docker.compose.service':'dev-main'}}}]),
    /CONTROLLER_IDENTITY_OR_RUNTIME_DRIFT/);
});
