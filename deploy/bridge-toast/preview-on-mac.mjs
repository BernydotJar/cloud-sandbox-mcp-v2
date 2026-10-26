#!/usr/bin/env node
/**
 * Standalone native macOS splash preview (does not install the Bridge).
 * The Swift compiler output is surfaced and redacted on failures.
 */
import fs from 'node:fs';
import os from 'node:os';
import console from 'node:console';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const source=path.join(root,'bridge-toast.swift');
const manifest=path.join(root,'bridge-toast.sha256');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const say=(k,v)=>console.log('[Akira Preview] '+k+'='+String(v));

function compilerDiagnostic(error){
  const message=String(error?.stderr || error?.stdout || error?.message ||
    'UNKNOWN_SWIFT_ERROR').slice(0,14000);
  return message
    .replaceAll(source,'bridge-toast.swift')
    .replaceAll(os.homedir(),'~')
    .replace(/\/private\/var\/folders\/[^\s:]+/g,'[MAC_TEMP]')
    .split(/\r?\n/)
    .map(line=>Array.from(line).map(char=>{
      const code=char.charCodeAt(0);
      return code<32||code===127?' ':char;
    }).join('').trim())
    .filter(Boolean).slice(0,65);
}
function compilerStep(name,args){
  try{
    execFileSync('/usr/bin/xcrun',args,{
      timeout:120000,encoding:'utf8',stdio:['ignore','pipe','pipe'],
      maxBuffer:1024*1024
    });
    say(name,'PASS');
  }catch(error){
    say(name,'FAIL');
    say('COMPILER_EXIT',error?.status ?? error?.code ?? 'UNKNOWN');
    for(const line of compilerDiagnostic(error))say('SWIFT_DIAGNOSTIC',line);
    throw Error('SWIFT_BUILD_FAILED_AT_'+name);
  }
}
function verify(){
  const st=fs.lstatSync(source);
  if(!st.isFile()||st.isSymbolicLink()||st.size>250000)
    throw Error('UNSAFE_SWIFT_SOURCE');
  const expected=fs.readFileSync(manifest,'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(expected)||
      hash(fs.readFileSync(source))!==expected)
    throw Error('SOURCE_DIGEST_MISMATCH');
  return expected;
}
async function main(){
  const digest=verify();
  if(process.argv.length===3&&process.argv[2]==='--inspect'){
    say('SOURCE_SHA256',digest);
    say('ON_SCREEN_PREVIEW_AVAILABLE',process.platform==='darwin'?'YES':'NO');
    say('NO_BROWSER_DEBUGGING','YES');
    say('NO_DEPLOYMENT','YES');
    if(process.platform==='darwin'){
      const version=(bin,args)=>{
        try{return execFileSync(bin,args,{encoding:'utf8',timeout:5000,
          stdio:['ignore','pipe','pipe']}).trim().slice(0,120);}
        catch{return 'UNAVAILABLE';}
      };
      const osVersion=version('/usr/bin/sw_vers',['-productVersion']);
      const sdkVersion=version('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-version']);
      const compiler=version('/usr/bin/xcrun',['swiftc','--version']);
      say('MACOS_VERSION',osVersion);
      say('SDK_VERSION',sdkVersion);
      say('SWIFT_VERSION',compiler.split('\n')[0]);
      const major=v=>Number.parseInt(v.split('.')[0],10);
      say('NATIVE_GLASS_SDK_AND_OS_READY',
        major(osVersion)>=26 && major(sdkVersion)>=26 ? 'YES' : 'NO_OR_UNKNOWN');
    }
    return;
  }
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  const args=process.argv.slice(2);
  const allowed=args.length===0||
    (args.length===2&&args[0]==='--status-alert'&&
      ['storage','storage-warning','edge','terminal','recovery'].includes(args[1]));
  if(!allowed)throw Error('INVALID_PREVIEW_MODE');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akira-splash-preview-'));
  fs.chmodSync(temp,0o700);
  try{
    const binary=path.join(temp,'akira-preview');
    compilerStep('SWIFT_TOOLCHAIN',['--find','swiftc']);
    compilerStep('SWIFT_TYPECHECK',['swiftc','-typecheck',source,
      '-framework','AppKit','-framework','QuartzCore']);
    compilerStep('SWIFT_COMPILE',['swiftc',source,'-o',binary,
      '-framework','AppKit','-framework','QuartzCore']);
    say('SCREEN_PREVIEW','SHOWING');
    execFileSync(binary,args,{timeout:45000,stdio:'inherit'});
    say('SCREEN_PREVIEW','COMPLETED');
    say('INSTALLED_BRIDGE_UNCHANGED','YES');
  }finally{
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{
  say('STOP',String(error?.message||error?.code||'UNKNOWN').split('\n')[0].slice(0,150));
  process.exitCode=1;
});
