import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {setTimeout} from 'node:timers';
const home=path.dirname(fileURLToPath(import.meta.url));
function read(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('DOM_HOST_CONFIG_DENIED');return fs.readFileSync(file,'utf8');}
try{
 const cfg=JSON.parse(read(path.join(home,'config.json'))),token=read(path.join(home,'token')).trim(),origin=process.argv[2];
 if(cfg.enabled!==true||!/^[a-p]{32}$/.test(cfg.extension_id)||origin!=='chrome-extension://'+cfg.extension_id+'/'||!/^[a-f0-9]{96}$/.test(token))throw Error('DOM_HOST_ORIGIN_DENIED');
 let socket=null,hello=null,stdin=Buffer.alloc(0),line='',closed=false,retry=0;
 const sendNative=m=>{const b=Buffer.from(JSON.stringify(m));if(b.length>256000)throw Error('DOM_HOST_MESSAGE_TOO_LARGE');const h=Buffer.alloc(4);h.writeUInt32LE(b.length);process.stdout.write(Buffer.concat([h,b]));};
 const connect=()=>{
  if(closed)return;const c=net.createConnection(path.join(home,'dom.sock'));socket=c;
  c.once('connect',()=>{retry=0;c.write(JSON.stringify({kind:'native_host',origin,token})+'\n');if(hello)c.write(JSON.stringify(hello)+'\n');});
  c.on('data',data=>{line+=data.toString('utf8');if(Buffer.byteLength(line)>256000){c.destroy();return;}for(let n;(n=line.indexOf('\n'))>=0;){const part=line.slice(0,n);line=line.slice(n+1);try{const m=JSON.parse(part);if(m.kind==='request')sendNative(m);}catch{c.destroy();}}});
  c.on('error',()=>{});c.once('close',()=>{if(socket===c)socket=null;line='';if(!closed)setTimeout(connect,Math.min(5000,250*2**Math.min(retry++,5)));});
 };
 process.stdin.on('data',data=>{
  stdin=Buffer.concat([stdin,data]);if(stdin.length>256004){process.exit(2);return;}
  while(stdin.length>=4){const n=stdin.readUInt32LE(0);if(n>256000){process.exit(2);return;}if(stdin.length<n+4)break;
   let m;try{m=JSON.parse(stdin.subarray(4,n+4).toString('utf8'));}catch{process.exit(2);return;}stdin=stdin.subarray(n+4);
   if(m.kind==='extension_hello')hello=m;else if(m.kind!=='reply')continue;
   if(socket&&!socket.connecting&&!socket.destroyed)socket.write(JSON.stringify(m)+'\n');
  }
 });
 process.stdin.once('end',()=>{closed=true;socket?.destroy();process.exit(0);});connect();
}catch{process.stderr.write('[Sandbox DOM] DOM_HOST_START_FAILED\n');process.exitCode=2;}
