#!/bin/sh
set -eu
PORT="${BRIDGE_PORT:-9223}"
case "$PORT" in *[!0-9]*|'') exit 2;; esac
node - "$PORT" <<'NODE'
const port=Number(process.argv[2]);
if(!Number.isInteger(port)||port<1024||port>65535)process.exit(2);
(async()=>{
for(const endpoint of ['version','list']){
const response=await fetch('http://127.0.0.1:'+port+'/json/'+endpoint,{signal:AbortSignal.timeout(3000)});
if(!response.ok)throw Error('CDP_'+endpoint.toUpperCase()+'_FAILED');
const payload=await response.json();
if(endpoint==='version')console.log('CDP_READY '+payload.Browser);
else console.log('PAGE_TARGETS '+payload.filter(t=>t.type==='page').length);
}
})().catch(e=>{console.error(e.message);process.exitCode=1});
NODE
