import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import process from 'node:process';
import {setTimeout,clearTimeout} from 'node:timers';
const scope='https://teams.cloud.microsoft',idPattern=/^[a-p]{32}$/;
const safeError=value=>/^DOM_[A-Z_]{3,45}$/.test(value||'')?value:'DOM_REQUEST_FAILED_INSPECT';
function privateFile(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('DOM_CONFIG_UNTRUSTED');return fs.readFileSync(file,'utf8');}
export class DOMBroker {
 constructor({home=path.join(os.homedir(),'Library/Application Support/LCH/SandboxDOM'),timeoutMs=12000}={}){
  this.home=home;this.timeoutMs=timeoutMs;this.peer=null;this.pending=new Map();this.generation=0;this.enabled=false;this.ready=false;this.server=null;this.failure=null;
  const file=path.join(home,'config.json');if(!fs.existsSync(file))return;
  const cfg=JSON.parse(privateFile(file));if(cfg.enabled!==true)return;
  if(!idPattern.test(cfg.extension_id)||cfg.scope!==scope)throw Error('DOM_CONFIG_INVALID');
  this.extensionId=cfg.extension_id;this.token=privateFile(path.join(home,'token')).trim();if(!/^[a-f0-9]{96}$/.test(this.token))throw Error('DOM_CONFIG_INVALID');
  this.socketPath=path.join(home,'dom.sock');if(Buffer.byteLength(this.socketPath)>100)throw Error('DOM_SOCKET_PATH_TOO_LONG');this.enabled=true;
 }
 status(){return {enabled:this.enabled,connected:this.ready,profile_pinned:this.ready,semantic_available:this.ready,os_input_required:false,provider:'extension_dom',scope,transport:'native_messaging_private_unix',remote_debugging:false,...(this.failure?{error:this.failure}:{})};}
 async start(){
  if(!this.enabled||this.server)return;
  const dir=fs.lstatSync(this.home);if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()||(dir.mode&0o077))throw Error('DOM_CONFIG_UNTRUSTED');
  if(fs.existsSync(this.socketPath)){
   const s=fs.lstatSync(this.socketPath);if(!s.isSocket()||s.uid!==process.getuid())throw Error('DOM_SOCKET_UNTRUSTED');
   const live=await new Promise(resolve=>{const c=net.createConnection(this.socketPath);c.once('connect',()=>{c.destroy();resolve(true);});c.once('error',()=>resolve(false));});
   if(live)throw Error('DOM_BROKER_ALREADY_RUNNING');fs.unlinkSync(this.socketPath);
  }
  this.server=net.createServer(socket=>this.accept(socket));await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.socketPath,()=>{fs.chmodSync(this.socketPath,0o600);resolve();});});
 }
 accept(socket){
  let auth=false,buffer='';const timer=setTimeout(()=>socket.destroy(),3000);
  socket.on('data',chunk=>{
   try{
   buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>512000){socket.destroy();return;}
   for(let newline;(newline=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let m;try{m=JSON.parse(line);}catch{socket.destroy();return;}
    if(!auth){
     const a=Buffer.from(typeof m.token==='string'?m.token:''),b=Buffer.from(this.token);
     if(m.kind!=='native_host'||m.origin!=='chrome-extension://'+this.extensionId+'/'||a.length!==b.length||!crypto.timingSafeEqual(a,b)||this.peer){socket.destroy();return;}
     clearTimeout(timer);auth=true;this.peer=socket;this.generation++;this.ready=false;continue;
    }
    if(m.kind==='extension_hello'){
     if(m.extension_id!==this.extensionId||m.protocol!==1||m.scope!==scope||m.incognito===true||!/^[a-f0-9-]{36}$/.test(m.profile_instance||'')){socket.destroy();return;}
     const pin=path.join(this.home,'paired-profile.json');
     if(fs.existsSync(pin)){if(JSON.parse(privateFile(pin)).profile_instance!==m.profile_instance){this.failure='DOM_PROFILE_MISMATCH';socket.destroy();return;}}
     else fs.writeFileSync(pin,JSON.stringify({profile_instance:m.profile_instance})+'\n',{flag:'wx',mode:0o600});
     this.ready=true;this.failure=null;continue;
    }
    if(m.kind==='reply'&&typeof m.id==='string'){
     const p=this.pending.get(m.id);if(!p)continue;this.pending.delete(m.id);clearTimeout(p.timer);if(m.ok===true)p.resolve(m.data);else p.reject(Error(safeError(m.error)));
    }
   }
   }catch{this.failure='DOM_PROTOCOL_REFUSED';socket.destroy();}
  });
  socket.on('error',()=>{});socket.once('close',()=>{
   clearTimeout(timer);if(this.peer!==socket)return;this.peer=null;this.ready=false;this.generation++;
   for(const [id,p] of this.pending){clearTimeout(p.timer);p.reject(Error('DOM_DISCONNECTED_INSPECT'));this.pending.delete(id);}
  });
 }
 async request(operation,input={}){
  if(!this.ready||!this.peer)throw Error('DOM_EXTENSION_NOT_CONNECTED');
  if(!['tabs','inspect','action','reload'].includes(operation))throw Error('DOM_OPERATION_DENIED');
  const id=crypto.randomUUID(),body=JSON.stringify({kind:'request',id,operation,input});if(Buffer.byteLength(body)>20000)throw Error('DOM_REQUEST_TOO_LARGE');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('DOM_TIMEOUT_INSPECT'));},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});this.peer.write(body+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('DOM_DISCONNECTED_INSPECT'));}});});
 }
 async close(){this.peer?.destroy();const server=this.server;this.server=null;this.ready=false;if(server)await new Promise(resolve=>server.close(resolve));if(this.socketPath&&fs.existsSync(this.socketPath))fs.unlinkSync(this.socketPath);}
}
