import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_HEALTH_TARGETS,LOCAL_BRIDGE_URL,probePublicHttps,
  probePublicEndpoints,probeBrowserBridge,formatDashboard,
  statusLine,healthRow,outcomeCode
} from './health.mjs';

test('only hardcoded HTTPS health URLs are eligible for public checks',async()=>{
  assert.equal(PUBLIC_HEALTH_TARGETS.length,2);
  assert.equal(PUBLIC_HEALTH_TARGETS[0].url,'https://lch-app.cloud/health');
  assert.equal(PUBLIC_HEALTH_TARGETS[1].url,'https://ido.lch-app.cloud/health');
  await assert.rejects(probePublicHttps({id:'LCH_PUBLIC',
    url:'http://127.0.0.1/private'}),/UNTRUSTED_PUBLIC_HEALTH_TARGET/);
});
test('200 health endpoint returns safe semantic success with measured latency',async()=>{
  const called=[];
  let now=100;
  const result=await probePublicHttps(PUBLIC_HEALTH_TARGETS[0],{
    now:()=>{now+=47;return now;},
    fetchImpl:async (url,options)=>{
      called.push({url,options});
      return {status:200};
    }
  });
  assert.equal(result.status,'ok');
  assert.equal(result.code,'HTTPS_200');
  assert.equal(result.latencyMs,47);
  assert.equal(called[0].options.method,'GET');
  assert.equal(called[0].options.redirect,'manual');
  assert.equal(called[0].options.cache,'no-store');
  assert(!JSON.stringify(called[0]).includes('authorization'));
});
test('bad HTTP and redirects must not falsely pass health',async()=>{
  for(const code of [301,302,401,403,404,429,500,503]){
    const result=await probePublicHttps(PUBLIC_HEALTH_TARGETS[0],{
      fetchImpl:async()=>({status:code})
    });
    assert.equal(result.status,'fail');
    assert.equal(result.code,'HTTP_'+code);
  }
});
test('network timeouts, DNS and TLS errors classify without leaking URLs or credentials',async()=>{
  const examples=[
    {code:'ETIMEDOUT',want:'HTTPS_TIMEOUT'},
    {code:'ENOTFOUND',want:'HTTPS_DNS'},
    {code:'CERT_HAS_EXPIRED',want:'HTTPS_TLS'},
    {code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE',want:'HTTPS_TLS'},
    {code:'ECONNREFUSED',want:'HTTPS_CONNECTION'}
  ];
  for(const example of examples){
    const result=await probePublicHttps(PUBLIC_HEALTH_TARGETS[1],{
      fetchImpl:async()=>{const error=new Error('SECRET_TOKEN=X');
        error.cause={code:example.code};throw error;}
    });
    assert.equal(result.status,'fail');
    assert.equal(result.code,example.want);
    assert(!JSON.stringify(result).includes('SECRET_TOKEN'));
  }
});
test('the two endpoints probe concurrently and remain separately attributed',async()=>{
  const urls=[];
  const result=await probePublicEndpoints({
    fetchImpl:async(url)=>{urls.push(url);
      return {status:url.includes('ido.')?503:200};}
  });
  assert.deepEqual(urls,PUBLIC_HEALTH_TARGETS.map(target=>target.url));
  assert.equal(result[0].status,'ok');
  assert.equal(result[1].status,'fail');
});
test('Bridge local 403 or 401 shows listener with auth gate, not full E2E',async()=>{
  for(const status of [401,403]){
    const result=await probeBrowserBridge({
      fetchImpl:async(url,options)=>{
        assert.equal(url,LOCAL_BRIDGE_URL);
        assert.equal(options.body,'{}');
        assert(!JSON.stringify(options).includes('authorization'));
        return {status};
      }
    });
    assert.equal(result.status,'ok');
    assert.equal(result.code,'AUTH_GATE_'+status);
    assert(result.detail.includes('protegido'));
  }
  const down=await probeBrowserBridge({
    fetchImpl:async()=>{throw new Error('fetch failed');}
  });
  assert.equal(down.status,'warn');
  assert.equal(down.code,'BRIDGE_CONNECTION');
});
test('retro status panel uses sunglasses/alien/unknown icons with a legible 80s tone',()=>{
  const rows=[
    healthRow('DOCKER','Docker',true,'Motor listo','No responde'),
    healthRow('PUBLIC','lch-app.cloud',false,'HTTPS 200','HTTPS 503'),
    {id:'V3',label:'ChatGPT V3',status:'unknown',detail:'Verificar en ChatGPT'},
    {id:'BRIDGE',label:'Bridge',status:'warn',detail:'Sin acceso'}
  ];
  const full=formatDashboard(rows,{color:false,emoji:true,columns:90});
  assert(full.includes('😎'));
  assert(full.includes('👾'));
  assert(full.includes('🥸'));
  assert(full.includes('🕵️'));
  assert(full.includes('1 OK · 1 fallo · 1 aviso · 1 sin verificar'));
  assert.equal(outcomeCode(rows),1);
  const ascii=formatDashboard(rows,{color:false,emoji:false,columns:50});
  assert(ascii.includes('[OK]'));
  assert(ascii.includes('[!!]'));
  assert(!ascii.includes('\x1b['));
  assert(ascii.includes('SANDBOX V3'));
});
test('NO_COLOR and non-TTY can avoid colored output while ANSI is optional',()=>{
  const row={id:'CF',label:'Cloudflare',status:'ok',detail:'RUNNING'};
  const plain=statusLine(row,{color:false,emoji:true});
  assert(plain.includes('😎'));
  assert(!plain.includes('\x1b['));
  const colored=statusLine(row,{color:true,emoji:true});
  assert(colored.includes('\x1b[38;5;121m'));
  assert.equal(outcomeCode([row,{...row,status:'unknown'}]),0);
});
