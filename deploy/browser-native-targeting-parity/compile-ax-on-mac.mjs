#!/usr/bin/env node
// Mac-only compiler staging with verified release SHA. Does not modify the
// installed Mac bridge or controller and NEVER restarts browsers/services.
import os from 'node:os';
import console from 'node:console';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const bundle=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw Error(code);}
async function main(){
  if(process.platform!=='darwin')fail('MACOS_ONLY');
  const mode=process.argv[2]||'--inspect';
  if(!['--inspect','--compile'].includes(mode))fail('INVALID_MODE');
  const bytes=await fs.readFile(path.join(bundle,'manifest.json'));
  const expected=(await fs.readFile(path.join(bundle,'manifest.sha256'),'utf8')).trim();
  if(sha(bytes)!==expected)fail('MANIFEST_HASH_MISMATCH');
  const m=JSON.parse(bytes.toString('utf8'));
  if(m.schema!=='cloud-sandbox.browser-native-targeting-parity.review-bundle.v1')
    fail('UNEXPECTED_MANIFEST');
  for(const file of m.files){
    const b=await fs.readFile(path.join(bundle,file.path));
    if(sha(b)!==file.sha256)fail('FILE_HASH_MISMATCH');
  }
  const swift=path.join(bundle,'mac-host/native-ax/AXBrowserHelper.swift');
  execFileSync('/usr/bin/xcrun',['swiftc','-parse',swift],{stdio:'pipe',timeout:30000});
  if(mode==='--inspect'){
    console.log('AX_SOURCE_SYNTAX_PASS; no host files modified or sessions opened.');
    return;
  }
  const stage=path.join(os.homedir(),'Library','Application Support','LCH',
    'CloudSandboxBackups','native-ax-stage-'+Date.now()+'-'+process.pid);
  await fs.mkdir(stage,{mode:0o700,recursive:false});
  const binary=path.join(stage,'ax-browser-helper');
  // Intentionally compile into a private NON-LIVE path. The local reviewer
  // must verify AX consent and the exact installed custom Bridge separately.
  execFileSync('/usr/bin/xcrun',['swiftc','-O',swift,'-o',binary],
    {stdio:'pipe',timeout:180000});
  await fs.chmod(binary,0o700);
  console.log(JSON.stringify({stage:'MAC_AX_BINARY_COMPILED_ONLY',
    binary,sha256:sha(await fs.readFile(binary)),live_bridge_changed:false},null,2));
}
main().catch(e=>{console.error(String(e?.message||'MAC_BUILD_FAILED').slice(0,180));process.exitCode=1;});
