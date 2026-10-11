import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

Object.defineProperty(process,'platform',{value:'darwin'});
const originalOpen=fs.openSync;
const originalRead=fs.readSync;
const originalWrite=fs.writeSync;
const originalClose=fs.closeSync;
const reply=Buffer.from((process.env.FAKE_APPROVAL||'DENY')+'\n');
let index=0;
fs.openSync=function(file,...args){
  return file==='/dev/tty'?9001:originalOpen(file,...args);
};
fs.readSync=function(fd,out,offset,length,position){
  if(fd!==9001)return originalRead(fd,out,offset,length,position);
  if(index>=reply.length)return 0;
  out[offset]=reply[index++];
  return 1;
};
fs.writeSync=function(fd,...args){
  return fd===9001?1:originalWrite(fd,...args);
};
fs.closeSync=function(fd){
  return fd===9001?undefined:originalClose(fd);
};
globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,
  data:{delegated_session:{active:process.env.FAKE_ACTIVE==='1'}}})});
process.argv=[process.execPath,process.env.FAKE_SCRIPT,process.env.FAKE_MODE];
await import(pathToFileURL(process.env.FAKE_SCRIPT).href);
