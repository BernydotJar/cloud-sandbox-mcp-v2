#!/usr/bin/env node
/**
 * Read-only macOS AX source validation; no CUA actions, AX permissions,
 * bridge installation, browser manipulation, debugging flags or OS events.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.join(here,'AXBrowserHelper.swift');
const digestFile=path.join(here,'AXBrowserHelper.sha256');
const say=(key,value)=>console.log('[AX Readback] '+key+'='+String(value));
function verify(){
  const src=fs.lstatSync(source),dig=fs.lstatSync(digestFile);
  if(!src.isFile()||src.isSymbolicLink()||src.size>150000||
     !dig.isFile()||dig.isSymbolicLink()||dig.size>256)
    throw Error('UNSAFE_AX_SOURCE');
  const expected=fs.readFileSync(digestFile,'utf8').trim();
  const actual=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if(expected!==actual)throw Error('AX_SOURCE_SHA256_MISMATCH');
  return actual;
}
function typecheck(){
  try{
    execFileSync('/usr/bin/xcrun',['swiftc','-typecheck',source],{
      timeout:120000,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1000000});
    say('SWIFT_TYPECHECK','PASS');
  }catch(error){
    say('SWIFT_TYPECHECK','FAIL');
    const raw=String(error?.stderr||error?.stdout||error?.message||'UNKNOWN')
      .replaceAll(os.homedir(),'~').replaceAll(source,'AXBrowserHelper.swift');
    for(const item of raw.split(/\r?\n/).filter(Boolean).slice(0,45))
      say('SWIFT_DIAGNOSTIC',item.slice(0,350));
    throw Error('MAC_AX_SWIFT_TYPECHECK_FAILED');
  }
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--inspect')
    throw Error('READ_ONLY_INSPECT_ONLY');
  say('SOURCE_SHA256',verify());
  say('NO_BROWSER_DEBUGGING','YES');
  say('NO_GUI_MUTATION','YES');
  say('NO_BRIDGE_INSTALL','YES');
  if(process.platform!=='darwin'){
    say('PLATFORM','MAC_REQUIRED_TO_COMPILE');return;
  }
  typecheck();
  say('AX_SOURCE_COMPILE','VERIFIED_ONLY_NOT_INSTALLED');
  say('BACKGROUND_NATIVE_CUA','NOT_AVAILABLE_WITHOUT_ISOLATED_WORKER');
}
try{main();}
catch(error){say('STOP',String(error.message||error).split('\n')[0].slice(0,150));process.exitCode=2;}
