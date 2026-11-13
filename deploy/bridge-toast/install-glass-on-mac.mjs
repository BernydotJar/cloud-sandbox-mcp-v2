#!/usr/bin/env node
/**
 * Operator-invoked UX-only upgrade of the Mac screen splash.
 * Never touches bridge.mjs, Docker, launchctl, browsers, or debugging settings.
 * Compiles Swift before taking a verified rollback backup, and updates only
 * the already-used ~/Library/.../ux/bridge-toast executable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.join(here,'bridge-toast.swift');
const sourceDigest=path.join(here,'bridge-toast.sha256');
const parent=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse/ux');
const binary=path.join(parent,'bridge-toast');
const backups=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxBackups/akira-glass');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const out=(key,value)=>process.stdout.write('[Akira Glass] '+key+'='+String(value)+'\n');
function safeFile(file,{maxBytes=16*1024*1024,requireOwner=true}={}){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||(requireOwner&&st.uid!==process.getuid())||
     st.size<1||st.size>maxBytes)throw Error('UNSAFE_OR_UNOWNED_FILE');
  return {bytes:fs.readFileSync(file),mode:st.mode&0o777};
}
function safeDirectory(folder){
  const st=fs.lstatSync(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())
    throw Error('UNSAFE_OR_UNOWNED_DIRECTORY');
}
function verifySource(){
  const digest=safeFile(source,{maxBytes:250000,requireOwner:false});
  const expected=safeFile(sourceDigest,{maxBytes:256,requireOwner:false}).bytes.toString().trim();
  if(!/^[a-f0-9]{64}$/.test(expected)||hash(digest.bytes)!==expected)
    throw Error('SOURCE_DIGEST_MISMATCH');
  return expected;
}
function diagnostics(error){
  const raw=String(error?.stderr||error?.stdout||error?.message||'COMPILER_UNAVAILABLE')
    .replaceAll(os.homedir(),'~').replaceAll(source,'bridge-toast.swift');
  for(const line of raw.split(/\r?\n/).map(v=>v.trim()).filter(Boolean).slice(0,50))
    out('SWIFT_DIAGNOSTIC',Array.from(line).filter(c=>c.charCodeAt(0)>=32).join('').slice(0,550));
}
function compile(type,args){
  try {
    execFileSync('/usr/bin/xcrun',args,{timeout:120000,maxBuffer:1024*1024,
      encoding:'utf8',stdio:['ignore','pipe','pipe']});
    out(type,'PASS');
  } catch(error){
    out(type,'FAIL');
    diagnostics(error);
    throw Error('SWIFT_BUILD_FAILED_AT_'+type);
  }
}
function atomicReplace(file,data,mode=0o700){
  const next=path.join(path.dirname(file),'.akira-'+crypto.randomUUID());
  fs.writeFileSync(next,data,{flag:'wx',mode});
  try{
    const fd=fs.openSync(next,'r');
    try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.chmodSync(next,mode);
    fs.renameSync(next,file);
  }finally{if(fs.existsSync(next))fs.unlinkSync(next);}
}
function inspect(){
  const expected=verifySource();
  out('SOURCE_SHA256',expected);
  if(!fs.existsSync(parent)){out('TARGET','NOT_INSTALLED');return;}
  safeDirectory(parent);
  if(!fs.existsSync(binary)){out('TARGET','NOT_INSTALLED');return;}
  const installed=safeFile(binary);
  out('TARGET','EXISTS');
  out('CURRENT_BINARY_SHA256',hash(installed.bytes));
  out('BRIDGE_RESTART_REQUIRED','NO');
  out('CHANGES_BROWSER_DEBUGGING','NO');
}
function restore(){
  safeDirectory(backups);
  const pointer=safeFile(path.join(backups,'latest.json'),{maxBytes:4096});
  const meta=JSON.parse(pointer.bytes.toString());
  if(meta.target!==binary||!/^[a-f0-9]{64}$/.test(meta.installed_sha256)||
     (meta.previous_sha256!==null && (typeof meta.backup!=='string'||
       !meta.backup.startsWith(backups+path.sep))))
    throw Error('INVALID_BACKUP_MANIFEST');
  if(meta.previous_sha256!==null)safeDirectory(path.dirname(meta.backup));
  const current=safeFile(binary);
  if(hash(current.bytes)!==meta.installed_sha256)
    throw Error('INSTALLED_BINARY_CHANGED_NO_OVERWRITE');
  if(meta.previous_sha256===null){
    fs.unlinkSync(binary);
    out('ROLLBACK','REMOVED_NEW_ONLY');
  }else{
    const old=safeFile(meta.backup);
    if(hash(old.bytes)!==meta.previous_sha256)
      throw Error('BACKUP_INTEGRITY_FAILED');
    atomicReplace(binary,old.bytes,meta.previous_mode);
    out('ROLLBACK','RESTORED');
  }
}
function install(){
  const expected=verifySource();
  if(!fs.existsSync(parent)){
    safeDirectory(path.dirname(parent));
    fs.mkdirSync(parent,{mode:0o700});
  }
  safeDirectory(parent);
  const before=fs.existsSync(binary)?safeFile(binary):null;
  // Both initial installation and one-file replacement are safe: this
  // never changes the Bridge process/configuration, and rollback removes
  // an initially absent binary rather than inventing a previous version.
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akira-glass-build-'));
  fs.chmodSync(temp,0o700);
  try{
    const candidate=path.join(temp,'bridge-toast');
    compile('SWIFT_TYPECHECK',['swiftc','-typecheck',source,
      '-framework','AppKit','-framework','QuartzCore']);
    compile('SWIFT_COMPILE',['swiftc',source,'-o',candidate,
      '-framework','AppKit','-framework','QuartzCore']);
    const built=safeFile(candidate);
    const installedSha=hash(built.bytes);
    if(before && installedSha===hash(before.bytes)){
      out('INSTALL','ALREADY_CURRENT');
      return;
    }
    fs.mkdirSync(backups,{recursive:true,mode:0o700});
    safeDirectory(backups);
    const stamp=Date.now()+'-'+crypto.randomUUID().slice(0,8);
    const backupFolder=path.join(backups,stamp);
    fs.mkdirSync(backupFolder,{mode:0o700});
    const previous=before?path.join(backupFolder,'bridge-toast.previous'):null;
    if(before)fs.writeFileSync(previous,before.bytes,{flag:'wx',mode:0o600});
    const record={
      target:binary,backup:previous,
      previous_sha256:before?hash(before.bytes):null,
      previous_mode:before?before.mode:null,installed_sha256:installedSha,
      source_sha256:expected,created_at:new Date().toISOString()
    };
    let swapped=false;
    try{
      atomicReplace(binary,built.bytes,0o700);
      swapped=true;
      // A real AppKit foreground rendering smoke, without login or UI
      // mutations. Exit code alone does NOT attest visual aesthetics.
      execFileSync(binary,['--status-alert','edge'],{
        timeout:30000,maxBuffer:2000,stdio:['ignore','pipe','pipe']});
      atomicReplace(path.join(backups,'latest.json'),
        Buffer.from(JSON.stringify(record)+'\n'),0o600);
      out('INSTALL','PASS');
      out('DISPLAY_SMOKE','PROCESS_EXIT_OK_VISUAL_CHECK_OPERATOR');
      out('BACKUP_SHA256',record.previous_sha256??'NONE_FIRST_INSTALL');
      out('ROLLBACK_AVAILABLE','YES');
    }catch(error){
      if(swapped){
        const current=safeFile(binary);
        if(hash(current.bytes)!==installedSha)
          throw Error('INSTALL_FAIL_TARGET_CHANGED_MANUAL_RECOVERY_REQUIRED');
        if(before)atomicReplace(binary,before.bytes,before.mode);
        else fs.unlinkSync(binary);
      }
      diagnostics(error);
      throw Error('INSTALL_ROLLED_BACK');
    }
  }finally{
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
function main(){
  if(process.platform!=='darwin')throw Error('MACOS_ONLY');
  const mode=process.argv[2];
  if(process.argv.length!==3||!['--inspect','--install','--rollback'].includes(mode))
    throw Error('INVALID_MODE');
  if(mode==='--inspect')inspect();
  if(mode==='--install')install();
  if(mode==='--rollback')restore();
}
export {safeFile, atomicReplace, verifySource};
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(error){out('STOP',String(error?.message||'UNKNOWN').slice(0,180));process.exitCode=2;}
}
