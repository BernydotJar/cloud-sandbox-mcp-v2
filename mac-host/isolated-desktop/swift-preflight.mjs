#!/usr/bin/env node
/**
 * Read-only Apple Swift compiler preflight for the isolated Mac CUA bundle.
 * Runs no app, requires no Accessibility permissions, and never configures
 * browser debugging, macOS developer paths, disks or virtual machines.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const names=['GuestAX.swift','AXFixture.swift','HostFocusObserver.swift'];
const print=(key,value)=>console.log('[Mac CUA Swift] '+key+'='+String(value));
function checkBundle(){
  const manifest=path.join(dir,'manifest.json');
  const expected=fs.existsSync(manifest)?
    JSON.parse(fs.readFileSync(manifest,'utf8')).files_sha256:null;
  for(const name of names){
    const filename=path.join(dir,name);
    const stat=fs.lstatSync(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>150000)
      throw Error('UNSAFE_SWIFT_SOURCE:'+name);
    const digest=crypto.createHash('sha256')
      .update(fs.readFileSync(filename)).digest('hex');
    if(expected && expected[name]!==digest)
      throw Error('RELEASE_SHA256_MISMATCH:'+name);
    print('SOURCE_SHA256_'+name,digest);
  }
}
function typecheck(name){
  try{
    execFileSync('/usr/bin/xcrun',['swiftc','-typecheck',path.join(dir,name)],
      {timeout:120000,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:2000000});
    print('TYPECHECK_'+name,'PASS');
    return true;
  }catch(error){
    print('TYPECHECK_'+name,'FAIL');
    const reason=String(error.stderr||error.stdout||error.message||'UNKNOWN')
      .replaceAll(path.join(dir,name),name).replaceAll(os.homedir(),'~');
    for(const line of reason.split(/\r?\n/).filter(Boolean).slice(0,60))
      print('SWIFT_DIAGNOSTIC',line.slice(0,360));
    return false;
  }
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--inspect')
    throw Error('READ_ONLY_INSPECT_ONLY');
  checkBundle();
  print('NO_BRIDGE_INSTALL','YES');
  print('NO_VM_PROVISIONING','YES');
  print('NO_GUI_INPUT','YES');
  print('NO_REMOTE_DEBUGGING','YES');
  if(process.platform!=='darwin'){
    print('RESULT','MAC_REQUIRED_FOR_SWIFT_TYPECHECK');return;
  }
  const outcomes=names.map(typecheck);
  if(outcomes.some(ok=>!ok))throw Error('MAC_CUA_SWIFT_TYPECHECK_FAILED');
  print('RESULT','THREE_SWIFT_SOURCES_COMPILE_SOURCE_ONLY');
}
try{main();}
catch(error){print('STOP',String(error.message||'UNKNOWN').slice(0,170));process.exitCode=2;}
