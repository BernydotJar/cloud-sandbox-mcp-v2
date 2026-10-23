import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import {evaluateAgentPlan} from './agent-preflight.mjs';
import {gradeReinforcementCases} from './reinforcement-eval.mjs';

const fixture=new URL('../../docs/computer-use-v2/evals/agent-behavior-v1.json',import.meta.url);
const suite=JSON.parse(fs.readFileSync(fixture,'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));

test('all curated critical browser/desktop decision regression cases pass',()=>{
  const result=gradeReinforcementCases(suite);
  assert.equal(result.status,'PASS');
  assert.equal(result.failed,0);
  assert.equal(result.critical_pass_rate,1);
  assert(result.total>=25);
  assert(result.negative_control_cases>=10);
  assert.equal(result.production_go,false);
});
test('a fabricated expected PASS on a denied operation makes reinforcement FAIL',()=>{
  const broken=clone(suite);
  const caseId='EDGE-011';
  const item=broken.cases.find(x=>x.id===caseId);
  assert(item);
  item.expected={state:'PLAN_VALIDATED',code:'BROWSER_PREFLIGHT'};
  const result=gradeReinforcementCases(broken);
  assert.equal(result.status,'FAIL');
  assert.deepEqual(result.failures.map(x=>x.id),[caseId]);
});
test('suite rejects duplicate case IDs, absent negative controls and missing critical cases',()=>{
  const duplicate=clone(suite);
  duplicate.cases[1].id=duplicate.cases[0].id;
  assert.throws(()=>gradeReinforcementCases(duplicate),/INVALID_REINFORCEMENT_CASE/);
  const onlyPass=clone(suite);
  onlyPass.cases=onlyPass.cases.filter(x=>x.expected.state==='PLAN_VALIDATED');
  assert.throws(()=>gradeReinforcementCases(onlyPass),/REINFORCEMENT_NEGATIVE_CONTROLS_MISSING|INVALID_REINFORCEMENT_SUITE/);
});
test('native QA cannot be promoted to semantic E2E by changing only the proposed operation',()=>{
  const item=suite.cases.find(x=>x.id==='EDGE-011');
  assert(item);
  const result=evaluateAgentPlan(item.input);
  assert.equal(result.state,'BLOCKED');
  assert.equal(result.code,'OPERATION_SCOPE_ESCALATION');
});
test('a policy preflight never authorizes a real Mac dispatch or production release',()=>{
  const item=suite.cases.find(x=>x.id==='WRITE-002');
  assert(item);
  const result=evaluateAgentPlan(item.input);
  assert.equal(result.state,'PLAN_VALIDATED');
  assert.equal(result.dispatch_authorized,false);
  assert.equal(result.production_go,false);
  assert.equal(result.evidence_status,'metadata_only');
});


test('preflight CLI accepts synthetic isolated Playwright plan over stdin',()=>{
  const item=suite.cases.find(x=>x.id==='WEB-002');
  assert(item);
  const command=new URL('./agent-preflight.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[command.pathname],{
    input:JSON.stringify(item.input),encoding:'utf8'
  });
  assert.equal(result.status,0);
  const output=JSON.parse(result.stdout);
  assert.equal(output.state,'PLAN_VALIDATED');
  assert.equal(output.dispatch_authorized,false);
  assert.equal(output.production_go,false);
});
test('preflight CLI blocks forbidden Edge origin before host action',()=>{
  const item=suite.cases.find(x=>x.id==='EDGE-006');
  assert(item);
  const command=new URL('./agent-preflight.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[command.pathname],{
    input:JSON.stringify(item.input),encoding:'utf8'
  });
  assert.equal(result.status,3);
  const output=JSON.parse(result.stdout);
  assert.equal(output.code,'MUTATION_ORIGIN_NOT_ALLOWED');
  assert.equal(output.dispatch_authorized,false);
});
test('the repository, npm scripts and CI route agents through reinforcement gates',()=>{
  const root=new URL('../../',import.meta.url);
  const instructions=fs.readFileSync(new URL('./AGENTS.md',root),'utf8');
  const config=JSON.parse(fs.readFileSync(new URL('./package.json',root),'utf8'));
  const workflow=fs.readFileSync(new URL('./.github/workflows/browser-runtime-v2.yml',root),'utf8');
  assert.match(instructions,/AGENT_REINFORCEMENT.md/);
  assert.match(instructions,/browser:agent-preflight/);
  assert.match(instructions,/test:browser:reinforcement/);
  assert.match(config.scripts.verify,/test:browser:reinforcement/);
  assert.match(config.scripts['test:browser:reinforcement'],/reinforcement-eval.mjs/);
  assert.match(workflow,/Mandatory adversarial agent reinforcement evals/);
});
