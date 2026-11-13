import {colorsEnabled} from './art.mjs';
import process from 'node:process';
import {performance} from 'node:perf_hooks';
const nodeFetch=globalThis.fetch;
const abortTimeout=globalThis.AbortSignal.timeout;

export const PUBLIC_HEALTH_TARGETS=Object.freeze([
  {id:'LCH_PUBLIC',label:'lch-app.cloud',url:'https://lch-app.cloud/health'},
  {id:'IDO_PUBLIC',label:'ido.lch-app.cloud',url:'https://ido.lch-app.cloud/health'},
]);
export const LOCAL_BRIDGE_URL='http://127.0.0.1:9764/v1/status';

function classifyFetchError(error){
  const code=String(error?.cause?.code||error?.cause?.errors?.[0]?.code||
    error?.name||'').toUpperCase();
  if(code.includes('TIMEOUT')||code.includes('TIMEDOUT')||code.includes('ABORT'))return 'TIMEOUT';
  if(code.includes('ENOTFOUND')||code.includes('EAI_AGAIN'))return 'DNS';
  if(code.includes('CERT')||code.includes('TLS')||code.includes('SSL')||
     code.includes('UNABLE_TO_VERIFY')||code.includes('SELF_SIGNED'))
    return 'TLS';
  return 'CONNECTION';
}
export async function probePublicHttps(target,{fetchImpl=nodeFetch,
  now=()=>performance.now(),timeoutMs=4500}={}){
  if(!PUBLIC_HEALTH_TARGETS.some(item=>item.id===target?.id&&item.url===target.url))
    throw Error('UNTRUSTED_PUBLIC_HEALTH_TARGET');
  const started=now();
  try{
    const response=await fetchImpl(target.url,{
      method:'GET',redirect:'manual',
      headers:{accept:'application/json, text/plain;q=0.8'},
      signal:abortTimeout(timeoutMs),cache:'no-store',
    });
    const latencyMs=Math.max(0,Math.round(now()-started));
    if(response.status===200)
      return {id:target.id,label:target.label,status:'ok',code:'HTTPS_200',
        detail:'HTTPS 200 · '+latencyMs+' ms',latencyMs,httpStatus:200};
    return {id:target.id,label:target.label,status:'fail',
      code:'HTTP_'+response.status,detail:'HTTPS '+response.status,
      latencyMs,httpStatus:response.status};
  }catch(error){
    const category=classifyFetchError(error);
    return {id:target.id,label:target.label,status:'fail',
      code:'HTTPS_'+category,detail:{
        TIMEOUT:'Tiempo agotado',DNS:'DNS no responde',
        TLS:'Error de certificado TLS',CONNECTION:'Sin conexión HTTPS'
      }[category],latencyMs:null,httpStatus:null};
  }
}
export async function probePublicEndpoints(options={}){
  return Promise.all(PUBLIC_HEALTH_TARGETS.map(target=>
    probePublicHttps(target,options)));
}
export async function probeBrowserBridge({fetchImpl=nodeFetch,timeoutMs=2300}={}){
  try{
    const response=await fetchImpl(LOCAL_BRIDGE_URL,{
      method:'POST',redirect:'manual',
      headers:{'content-type':'application/json'},
      body:'{}',signal:abortTimeout(timeoutMs),
    });
    // This is ONLY a listener/auth-gate reachability test. An HTTP 403
    // does not prove browser automation or authenticated sessions work.
    if([401,403].includes(response.status))
      return {id:'MAC_BRIDGE',label:'Bridge macOS',status:'ok',
        code:'AUTH_GATE_'+response.status,
        detail:'Puerto activo · acceso protegido'};
    return {id:'MAC_BRIDGE',label:'Bridge macOS',status:'warn',
      code:'UNEXPECTED_HTTP_'+response.status,
      detail:'Respuesta HTTP '+response.status+' · revisar'};
  }catch(error){
    const type=classifyFetchError(error);
    return {id:'MAC_BRIDGE',label:'Bridge macOS',status:'warn',
      code:'BRIDGE_'+type,detail:'No disponible para diagnóstico'};
  }
}
const palette={
  ok:'\x1b[38;5;121m',
  fail:'\x1b[38;5;203m',
  warn:'\x1b[38;5;221m',
  unknown:'\x1b[38;5;147m',
  headline:'\x1b[38;5;87m',
  neutral:'\x1b[38;5;246m',
  reset:'\x1b[0m',
};
const emojiIcons={ok:'😎',fail:'👾',warn:'🥸',unknown:'🕵️'};
const asciiIcons={ok:'[OK]',fail:'[!!]',warn:'[?!]',unknown:'[??]'};
export function statusLine(row,{color=false,emoji=true,compact=false}={}){
  if(!row||!['ok','fail','warn','unknown'].includes(row.status)||
     typeof row.label!=='string'||typeof row.detail!=='string')
    throw Error('INVALID_HEALTH_ROW');
  const icon=(emoji?emojiIcons:asciiIcons)[row.status];
  const space=compact?1:23;
  const label=row.label.slice(0,space).padEnd(space);
  const prefix=emoji?'   '+icon+'  ':'   '+icon+' ';
  const line=prefix+label+'  '+row.detail.slice(0,67);
  return color?palette[row.status]+line+palette.reset:line;
}
export function formatDashboard(rows,{color=colorsEnabled(),
  emoji=process.stdout.isTTY&&!process.env.NO_EMOJI,
  columns=process.stdout.columns||80}={}){
  if(!Array.isArray(rows)||rows.length>24)
    throw Error('INVALID_HEALTH_ROWS');
  const compact=columns<67;
  const counts=rows.reduce((acc,row)=>{
    if(!['ok','fail','warn','unknown'].includes(row.status))
      throw Error('INVALID_HEALTH_ROW');
    acc[row.status]++;
    return acc;
  },{ok:0,fail:0,warn:0,unknown:0});
  const header=compact?
    '   ── SANDBOX V3 · SYSTEM SCAN ──':
    '   ╭─  S A N D B O X   V 3   ·   S Y S T E M   S C A N  ─────────';
  const summary=counts.fail>0?'DEGRADADO':counts.warn>0?'ATENCIÓN':'OPERATIVO';
  const summaryIcon=(emoji?emojiIcons:asciiIcons)[
    counts.fail>0?'fail':counts.warn>0?'warn':'ok'];
  const footer='   '+(compact?'── ':'╰─ ')+summaryIcon+' '+summary+
    '  /  '+counts.ok+' OK · '+counts.fail+
    (counts.fail===1?' fallo':' fallos')+' · '+counts.warn+
    (counts.warn===1?' aviso':' avisos')+' · '+
    counts.unknown+' sin verificar'+(compact?'':' ───');
  const paint=(input,key)=>color?palette[key]+input+palette.reset:input;
  return [
    '',
    paint(header,'headline'),
    '',
    ...rows.map(row=>statusLine(row,{color,emoji,compact})),
    '',
    paint(footer,counts.fail?'fail':counts.warn?'warn':'ok'),
    ''
  ].join('\n');
}
export function healthRow(id,label,ok,good,bad){
  return {id,label,status:ok?'ok':'fail',code:ok?'PASS':'FAIL',
    detail:ok?good:bad};
}
export function outcomeCode(rows){
  return rows.some(row=>row.status==='fail')?1:0;
}
