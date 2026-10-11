/* global process, console */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-v2-promotion-mock-'));
const home=path.join(tmp,'home');
const bin=path.join(tmp,'bin');
const working=path.join(home,'mock-controller');
fs.mkdirSync(home,{recursive:true});
fs.mkdirSync(bin,{recursive:true});
fs.mkdirSync(working,{recursive:true});
fs.writeFileSync(path.join(working,'compose.yaml'),
  'name: mock-sandbox\nservices:\n  mcp:\n    image: mock-controller:legacy\n');
fs.writeFileSync(path.join(working,'.env'),
  'COMPUTER_USE_ENABLED=true\nCOMPUTER_USE_BRIDGE_TOKEN='+('z'.repeat(48))+'\n');
const docker=path.join(bin,'docker');
fs.writeFileSync(docker,
  '#!/bin/sh\nexec python3 "'+path.join(root,'test-docker-mock.py')+'" "$@"\n',
  {mode:0o755});
fs.chmodSync(docker,0o755);
const stateFile=path.join(tmp,'state.json');
const dockerLog=path.join(tmp,'docker.log');
const initial=()=>({
 container_id:'c'.repeat(64),
 image_ref:'mock-controller:legacy',
 compose_files:[path.join(working,'compose.yaml')]
});
fs.writeFileSync(stateFile,JSON.stringify(initial()));
function action(mode,options={}){
 const result=spawnSync(process.execPath,[path.join(root,'test-driver.mjs')],{
  encoding:'utf8',timeout:25000,
  env:{...process.env,
    HOME:home,PATH:bin+':'+process.env.PATH,
    FAKE_MODE:mode,FAKE_SCRIPT:path.join(root,'promote-on-mac.mjs'),
    FAKE_STATE:stateFile,FAKE_WORKING:working,FAKE_LOG:dockerLog,
    FAKE_APPROVAL:options.approval||'DENY',FAKE_ACTIVE:options.active?'1':'0',
    FAKE_COMPOSE_DRIFT:options.drift?'1':'0',
    FAKE_FAIL_NEW:options.failNew?'1':'0',
    FAKE_RUNTIME_V2_CODE:options.v2Installed?'1':'0'
  }
 });
 const out=(result.stdout||'')+(result.stderr||'');
 if(result.error)throw result.error;
 return {status:result.status,out};
}
const override=path.join(home,'.cloud-sandbox-mcp-data','shared-auth',
  'deployment','compose-overrides','browser-runtime-v2-mcp-image.compose.yaml');
function mustPass(result,label){
 assert.equal(result.status,0,label+' failed: '+result.out);
}
try{
 const first=action('--inspect');
 mustPass(first,'Read-only preflight');
 assert.match(first.out,/PREFLIGHT_PASS/);
 assert.match(first.out,/COMPOSE_DIFFERENCE=image-only/);
 assert(!fs.existsSync(override));
 console.log('PROMOTION_SIM_READ_ONLY_PREFLIGHT_PASS');

 const declined=action('--promote');
 assert.equal(declined.status,2);
 assert.match(declined.out,/DECLINED/);
 assert(!fs.existsSync(override));
 console.log('PROMOTION_SIM_NO_OPERATOR_APPROVAL_NO_CHANGE_PASS');

 const active=action('--inspect',{active:true});
 assert.equal(active.status,2);
 assert.match(active.out,/ACTIVE_COMPUTER_USE_SESSION_STOP_FIRST/);
 assert(!fs.existsSync(override));
 console.log('PROMOTION_SIM_ACTIVE_TASK_REFUSAL_PASS');

 const drift=action('--inspect',{drift:true});
 assert.equal(drift.status,2);
 assert.match(drift.out,/COMPOSE_CONFIG_DRIFT/);
 assert(!fs.existsSync(override));
 console.log('PROMOTION_SIM_NETWORK_PORT_DRIFT_REFUSAL_PASS');

 const promoted=action('--promote',{approval:'PROMOTE_MCP_IMAGE'});
 mustPass(promoted,'MCP image promotion');
 assert.match(promoted.out,/MCP_IMAGE_PROMOTION_PASS/);
 assert.equal(JSON.parse(fs.readFileSync(stateFile)).image_ref,
  'cloud-sandbox-mcp:deps-v2-55be5b2aa44d-d1b4b0f9afe9');
 assert(fs.existsSync(override));
 console.log('PROMOTION_SIM_IMAGE_ONLY_SWITCH_AND_REGISTRY_CHECK_PASS');

 const repeated=action('--inspect');
 mustPass(repeated,'Idempotent inspection');
 assert.match(repeated.out,/ALREADY_PROMOTED/);
 console.log('PROMOTION_SIM_IDEMPOTENT_INSPECTION_PASS');

 const blockedCodeRollback=action('--rollback',{v2Installed:true});
 assert.equal(blockedCodeRollback.status,2);
 assert.match(blockedCodeRollback.out,/ROLLBACK_V2_CODE_FIRST_THEN_IMAGE/);
 assert.equal(JSON.parse(fs.readFileSync(stateFile)).image_ref,
  'cloud-sandbox-mcp:deps-v2-55be5b2aa44d-d1b4b0f9afe9');
 console.log('PROMOTION_SIM_INCOMPATIBLE_RUNTIME_ROLLBACK_BLOCKED_PASS');

 const rollback=action('--rollback',{approval:'ROLLBACK_MCP_IMAGE'});
 mustPass(rollback,'Image rollback');
 assert.match(rollback.out,/MCP_IMAGE_ROLLBACK_PASS/);
 assert.equal(JSON.parse(fs.readFileSync(stateFile)).image_ref,
  'cloud-sandbox-mcp:base-55be5b2aa44d164a');
 console.log('PROMOTION_SIM_EXPLICIT_ROLLBACK_PASS');

 const failed=action('--promote',{approval:'PROMOTE_MCP_IMAGE',failNew:true});
 assert.equal(failed.status,2);
 assert.match(failed.out,/AUTOMATIC_ROLLBACK_VERIFIED/);
 assert.equal(JSON.parse(fs.readFileSync(stateFile)).image_ref,
  'cloud-sandbox-mcp:base-55be5b2aa44d164a');
 console.log('PROMOTION_SIM_AUTOMATIC_ROLLBACK_PASS');

 const log=fs.readFileSync(dockerLog,'utf8');
 assert(!/^rm |^kill |^stop |^restart |^system prune /m.test(log));
 console.log('PROMOTION_SIM_NO_UNRELATED_CONTAINER_MUTATION_PASS');
 console.log('ALL_ISOLATED_PROMOTION_SIM_TESTS_PASS');
}finally{
 fs.rmSync(tmp,{recursive:true,force:true});
}
