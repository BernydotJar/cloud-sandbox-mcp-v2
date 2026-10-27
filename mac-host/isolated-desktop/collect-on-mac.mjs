#!/usr/bin/env node
/**
 * Operator invoked, Mac-only, no-mutation readiness report.
 * Checks release hashes, compiles Swift using the native macOS toolchain,
 * discovers VM capacity, and writes one redacted local result to handoff.
 * No VM installation, browser debugger, permissions change or GUI input.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const bundle=path.dirname(here);
const ax=path.join(bundle,'ax-readback-20261026');
const isolated=path.join(bundle,'isolated-mac-cua-20261026');
const resultDir=path.join(bundle,'mac-host-evidence');
const print=(key,value)=>console.log('[Sandbox Native Gate] '+key+'='+String(value));
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

function verifyBundle(folder){
  const manifestPath=path.join(folder,'manifest.json');
  const stat=fs.lstatSync(manifestPath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>30000)
    throw Error('UNTRUSTED_RELEASE_MANIFEST');
  const buffer=fs.readFileSync(manifestPath);
  const meta=JSON.parse(buffer.toString('utf8'));
  if(!meta||typeof meta.files_sha256!=='object'||Array.isArray(meta.files_sha256))
    throw Error('INVALID_RELEASE_MANIFEST');
  const digestPath=path.join(folder,'manifest.sha256');
  if(fs.existsSync(digestPath)&&
     hash(buffer)!==fs.readFileSync(digestPath,'utf8').trim())
    throw Error('MANIFEST_DIGEST_MISMATCH');
  for(const [name,digest] of Object.entries(meta.files_sha256)){
    if(!/^[a-zA-Z0-9._-]{3,90}$/.test(name)||
       typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))
      throw Error('INVALID_RELEASE_FILE_RECORD');
    const file=path.join(folder,name),info=fs.lstatSync(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size>350000||
       hash(fs.readFileSync(file))!==digest)
      throw Error('RELEASE_FILE_SHA256_MISMATCH:'+name);
  }
  return {gitSha:meta.source_git_sha,fileCount:Object.keys(meta.files_sha256).length};
}
function redact(message){
  return String(message).replaceAll(os.homedir(),'~')
    .split(/\r?\n/).map(line=>Array.from(line).filter(c=>{
      const n=c.charCodeAt(0);
      return n>=32&&n!==127;
    }).join('').slice(0,600)).filter(Boolean).slice(0,105).join('\n').slice(0,23000);
}
function execute(name,script){
  const started=Date.now();
  const run=spawnSync(process.execPath,[script,'--inspect'],{
    encoding:'utf8',timeout:165000,maxBuffer:128000,
    stdio:['ignore','pipe','pipe']
  });
  const output=redact((run.stdout||'')+(run.stderr||''));
  const success=run.status===0&&!run.error;
  print(name+'_RESULT',success?'PASS':'FAIL');
  print(name+'_EXIT',run.status??String(run.error?.code||'UNKNOWN'));
  // Diagnostics are intentionally forwarded so failures can be fixed
  // without repeated toolchain probes.
  for(const line of output.split('\n')){
    if(line.includes('SWIFT_DIAGNOSTIC=')||
       line.includes('TYPECHECK=')||line.includes('TYPECHECK_')||
       line.includes('SWIFT_TYPECHECK=')||
       line.includes('EXTERNAL_VM_STORAGE_CANDIDATE=')||
       line.includes('LOCAL_MAC_VM=')||
       line.includes('HOME_DISK_FREE_GIB=')||
       line.includes('EXTERNAL_VM_VOLUME=')||
       line.includes('EXTERNAL_VM_VOLUME_FREE_GIB='))
      console.log(line);
  }
  return {name,pass:success,exitCode:run.status??null,
    elapsedMs:Date.now()-started,output};
}
function saveEvidence(report){
  if(!fs.existsSync(resultDir))fs.mkdirSync(resultDir,{recursive:true,mode:0o700});
  const info=fs.lstatSync(resultDir);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid())
    throw Error('EVIDENCE_DIRECTORY_UNSAFE');
  const dest=path.join(resultDir,'last-host-native-gate.json');
  if(fs.existsSync(dest)){
    const previous=fs.lstatSync(dest);
    if(!previous.isFile()||previous.isSymbolicLink()||
       previous.uid!==process.getuid())
      throw Error('EVIDENCE_FILE_UNTRUSTED');
  }
  const temporary=path.join(resultDir,'.native-gate-'+crypto.randomUUID());
  try{
    fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n',
      {flag:'wx',mode:0o600});
    fs.renameSync(temporary,dest);
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  print('EVIDENCE_FILE',dest.replaceAll(os.homedir(),'~'));
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--collect')
    throw Error('EXPLICIT_COLLECT_MODE_REQUIRED');
  if(process.platform!=='darwin')
    throw Error('MAC_HOST_REQUIRED');
  const axRelease=verifyBundle(ax);
  const guestRelease=verifyBundle(isolated);
  // The two independently verified release bundles may legitimately
  // originate from different commits; reject content drift, not chronology.
  print('HANDOFF_SHA256','PASS');
  print('AX_SOURCE_COMMIT',axRelease.gitSha);
  print('GUEST_SOURCE_COMMIT',guestRelease.gitSha);
  const results=[
    execute('AX_READBACK',path.join(ax,'inspect-on-mac.mjs')),
    execute('GUEST_SWIFT',path.join(isolated,'swift-preflight.mjs')),
    execute('MAC_CAPACITY',path.join(isolated,'preflight.mjs'))
  ];
  const capacity=results[2].output;
  const mode=capacity.includes('EXTERNAL_VM_STORAGE_CANDIDATE=FOUND_NOT_PROVISIONED')?
    'EXTERNAL_APFS_CANDIDATE_AVAILABLE':
    capacity.includes('LOCAL_MAC_VM=ELIGIBLE_PREFLIGHT')?
      'INTERNAL_CAPACITY_ELIGIBLE':'STORAGE_NOT_READY';
  const report={
    generatedUTC:new Date().toISOString(),
    sourceCommits:{ax:axRelease.gitSha,guest:guestRelease.gitSha},
    os:'macOS',
    scope:'native_mac_read_only_compiler_and_storage_checks',
    noRemoteDebugging:true,noDesktopMutation:true,noVmCreation:true,
    vmCapacityDecision:mode,
    realGuestProvisioned:false,
    realNoninterferenceTestPassed:false,
    checks:results
  };
  saveEvidence(report);
  print('VM_CAPACITY_DECISION',mode);
  print('COMPILER_GATE',results[0].pass&&results[1].pass?'PASS':'FAIL');
  print('P0_STATUS','OPEN_UNTIL_GUEST_GUI_E2E');
  if(results.some(x=>!x.pass))process.exitCode=2;
}
try{main();}
catch(error){
  print('STOP',String(error?.message||'UNKNOWN').slice(0,220));
  process.exitCode=2;
}
