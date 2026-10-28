import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeHealthRows} from './cli.mjs';
import {formatDashboard,outcomeCode} from './health.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.join(dir,'cli.mjs'),'utf8');
const work={active:true,health:'none'};
const healthyPublic=[
  {id:'LCH_PUBLIC',label:'lch-app.cloud',status:'ok',
    code:'HTTPS_200',detail:'HTTPS 200 · 122 ms'},
  {id:'IDO_PUBLIC',label:'ido.lch-app.cloud',status:'ok',
    code:'HTTPS_200',detail:'HTTPS 200 · 138 ms'}
];
const bridge={id:'MAC_BRIDGE',label:'Bridge macOS',status:'ok',
  code:'AUTH_GATE_403',detail:'Puerto activo · acceso protegido'};
const ready={docker:true,controller:work,workstation:work,
  controllerHttp:true,cloudflare:{running:true},
  publicEndpoints:healthyPublic,bridge};

test('dashboard includes every expected operational component with one icon per row',()=>{
  const rows=composeHealthRows(ready);
  assert.deepEqual(rows.map(row=>row.id),[
    'DOCKER','CONTROLLER','WORKSTATION','MCP_HTTP','CLOUDFLARE',
    'LCH_PUBLIC','IDO_PUBLIC','MAC_BRIDGE','V3_PLUGIN'
  ]);
  assert.equal(rows.filter(row=>row.status==='ok').length,8);
  assert.equal(rows[8].status,'unknown');
  assert.equal(outcomeCode(rows),0);
  const display=formatDashboard(rows,{color:false,emoji:true,columns:110});
  assert.equal((display.match(/😎/gu)||[]).length,9); // Eight rows + summary
  assert.equal((display.match(/🕵️/gu)||[]).length,1);
  assert(display.includes('HTTPS 200 · 122 ms'));
  assert(display.includes('cloud-sandbox-mac'));
});
test('public website outage is not hidden by a running Cloudflare daemon',()=>{
  const rows=composeHealthRows({...ready,publicEndpoints:[
    healthyPublic[0],{...healthyPublic[1],status:'fail',
      code:'HTTP_503',detail:'HTTPS 503'}
  ]});
  assert.equal(rows[4].status,'ok'); // launchd running
  assert.equal(rows[6].status,'fail'); // public HTTPS failed
  assert.equal(outcomeCode(rows),1);
  const text=formatDashboard(rows,{color:false,emoji:true,columns:100});
  assert(text.includes('👾'));
  assert(text.includes('DEGRADADO'));
  assert(text.includes('1 fallo'));
});
test('Docker down still allows separate public endpoint checks to be shown',()=>{
  const rows=composeHealthRows({...ready,docker:false,
    controller:null,workstation:null,controllerHttp:false,
    cloudflare:{running:false,selected:null}});
  assert.equal(rows[0].status,'fail');
  assert.equal(rows[1].status,'fail');
  assert.equal(rows[2].status,'fail');
  assert.equal(rows[3].status,'fail');
  assert.equal(rows[4].status,'fail');
  assert.equal(rows[5].status,'ok');
  assert.equal(rows[6].status,'ok');
  assert.equal(outcomeCode(rows),1);
});
test('the CLI executes HTTPS probes in status AND start, without external plugin false pass',()=>{
  assert.match(source,/async function collectHealthRows/);
  assert.match(source,/probePublicEndpoints\(\)/);
  assert.match(source,/probeBrowserBridge\(\)/);
  assert.match(source,/showHealthRows\(rows,\{json:option==='--json'/);
  assert.match(source,/const rows=await collectHealthRows\(\);/);
  assert.match(source,/if\(degraded\)process\.exitCode=1/);
  assert.match(source,/Conexión MCP: verificar desde ChatGPT/);
  assert.doesNotMatch(source,/fetch.*cloudflared.*restart/);
});
