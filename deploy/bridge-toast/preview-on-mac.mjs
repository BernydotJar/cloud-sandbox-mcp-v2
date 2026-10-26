#!/usr/bin/env node
/**
 * Self-contained macOS screen preview for Akira laboratory splash.
 * No Bridge restart, browser startup/debugging, installation or config writes.
 * Compiles to a disposable private temp directory; validates source digest.
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
function verify(){
  const st=fs.lstatSync(source);
  if(!st.isFile()||st.isSymbolicLink()||st.size>250000)throw Error('UNSAFE_SWIFT_SOURCE');
  const expected=fs.readFileSync(manifest,'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(expected)||hash(fs.readFileSync(source))!==expected)
    throw Error('SOURCE_DIGEST_MISMATCH');
  return expected;
}
async function main(){
  const digest=verify();
  if(process.argv.length===3 && process.argv[2]==='--inspect'){
    say('SOURCE_SHA256',digest);
    say('ON_SCREEN_PREVIEW_AVAILABLE',process.platform==='darwin'?'YES':'NO');
    say('NO_BROWSER_DEBUGGING','YES');
    say('NO_DEPLOYMENT','YES');
    return;
  }
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  const args=process.argv.slice(2);
  const allowed=args.length===0 || 
    (args.length===2&&args[0]==='--status-alert' &&
     ['storage','edge','terminal','recovery'].includes(args[1]));
  if(!allowed)throw Error('INVALID_PREVIEW_MODE');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akira-splash-preview-'));
  fs.chmodSync(temp,0o700);
  try{
    const binary=path.join(temp,'akira-preview');
    execFileSync('/usr/bin/xcrun',['swiftc','-typecheck',source,
      '-framework','AppKit','-framework','QuartzCore'],{timeout:120000,stdio:'pipe'});
    say('SWIFT_TYPECHECK','PASS');
    execFileSync('/usr/bin/xcrun',['swiftc',source,'-o',binary,
      '-framework','AppKit','-framework','QuartzCore'],{timeout:120000,stdio:'pipe'});
    say('SCREEN_PREVIEW','SHOWING');
    execFileSync(binary,args,{timeout:45000,stdio:'inherit'});
    say('SCREEN_PREVIEW','COMPLETED');
    say('INSTALLED_BRIDGE_UNCHANGED','YES');
  }finally{
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
main().catch(e=>{
  say('STOP',String(e?.message||e?.code||'UNKNOWN').split('\n')[0].slice(0,150));
  process.exitCode=1;
});
