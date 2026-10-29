#!/usr/bin/env node
/* global fetch, AbortSignal */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import process from 'node:process';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
import {patchDOMBridge} from './patch-bridge.mjs';
export const BASELINE='03f3c774d1ef3eaaa22e40dae6de9bc555f1100f597ef442a5dbd6d0b5c4a72a';
const extensionId='ecamjbhjlcacmchoebdligpmhcebdgci',scope='https://teams.cloud.microsoft',hostName='com.lch.sandbox_v3_dom';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const stop=code=>{throw Error(code);};
function safe(file,privateMode=false){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(privateMode&&(s.mode&0o077)))stop('UNTRUSTED_FILE');const bytes=fs.readFileSync(file);return {bytes,hash:sha(bytes),mode:s.mode&0o777};}
function directory(dir,mode=0o700){if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode});const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid())stop('UNTRUSTED_DIRECTORY');}
function envValue(source,key,optional=false){const rows=source.split(/\r?\n/).filter(s=>s.startsWith(key+'='));if(rows.length===0&&optional)return '';if(rows.length!==1)stop('BRIDGE_SETTING_AMBIGUOUS');const v=rows[0].slice(key.length+1).trim();return /^(['"]).*\1$/.test(v)?v.slice(1,-1):v;}
function atomic(file,bytes,mode){const tmp=file+'.dom-'+process.pid;fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});fs.renameSync(tmp,file);}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function verifyRelease(root){const bytes=safe(path.join(root,'release.json')).bytes;if(sha(bytes)!==safe(path.join(root,'release.sha256')).bytes.toString().trim())stop('RELEASE_MANIFEST_CHANGED');const m=JSON.parse(bytes);if(m.schema!=='sandbox-v3.teams-dom.v1'||m.baseline_sha256!==BASELINE||m.extension_id!==extensionId)stop('RELEASE_INVALID');for(const [file,hash]of Object.entries(m.files)){if(!/^[a-zA-Z0-9_./-]+$/.test(file)||file.split('/').includes('..')||path.isAbsolute(file)||safe(path.join(root,file)).hash!==hash)stop('RELEASE_FILE_CHANGED');}for(const file of ['install-on-mac.mjs','patch-bridge.mjs','payload/browser-dom/broker.mjs','payload/browser-dom/tabs.mjs','payload/native-host.mjs','extension/manifest.json','extension/worker.js','extension/content.js','extension/editor-main.js'])if(!m.files[file])stop('RELEASE_FILE_MISSING');return m;}
async function main(){
 if(process.platform!=='darwin')stop('OPERATOR_MAC_REQUIRED');const mode=process.argv[2]||'--inspect';if(!['--inspect','--install','--rollback'].includes(mode))stop('INVALID_MODE');
 const release=path.dirname(fileURLToPath(import.meta.url));verifyRelease(release);
 const home=os.homedir(),lch=path.join(home,'Library/Application Support/LCH'),bridgeHome=path.join(lch,'CloudSandboxComputerUse'),domHome=path.join(lch,'SandboxDOM'),target=path.join(bridgeHome,'bridge.mjs'),modules=path.join(bridgeHome,'browser-dom'),nativeRoot=path.join(home,'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),nativeManifest=path.join(nativeRoot,hostName+'.json');
 const plist=path.join(home,'Library/LaunchAgents/com.lch.cloud-sandbox.computer-use.plist');
 safe(plist);const p=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',plist],{encoding:'utf8'}));
 if(p.Label!=='com.lch.cloud-sandbox.computer-use'||p.ProgramArguments?.[0]!=='/opt/homebrew/opt/node/bin/node'||p.ProgramArguments?.[1]!==target)stop('LAUNCH_AGENT_CHANGED');
 const envFile=p.EnvironmentVariables?.COMPUTER_USE_ENV_FILE;if(typeof envFile!=='string'||!path.isAbsolute(envFile))stop('ENV_PATH_UNVERIFIED');const env=safe(envFile,true),source=env.bytes.toString();
 const token=envValue(source,'COMPUTER_USE_BRIDGE_TOKEN'),port=Number(envValue(source,'COMPUTER_USE_BRIDGE_PORT',true)||9764);if(token.length<32||!Number.isInteger(port)||port<1024||port>65535)stop('BRIDGE_AUTH_INVALID');
 const post=async route=>{const r=await fetch('http://127.0.0.1:'+port+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});const j=await r.json();if(!r.ok||j?.ok!==true)stop('BRIDGE_CHECK_FAILED');return j.data;};
 const noGrant=async()=>{if((await post('/v1/session/status'))?.active!==false)stop('ACTIVE_DELEGATED_SESSION');};
 const restart=()=>execFileSync('/bin/launchctl',['kickstart','-k','gui/'+process.getuid()+'/'+p.Label],{stdio:'pipe',timeout:10000});
 const wait=async()=>{for(let n=0;n<25;n++){try{return await post('/v1/status');}catch{await delay(200);}}stop('BRIDGE_RELOAD_UNVERIFIED');};
 await noGrant();
 const current=safe(target),receiptFile=path.join(domHome,'installation.json');
 if(mode==='--rollback'){
  const receipt=JSON.parse(safe(receiptFile,true).bytes);if(current.hash!==receipt.installed_sha256||receipt.baseline_sha256!==BASELINE)stop('ROLLBACK_CODE_DRIFT');
  const original=safe(path.join(domHome,'bridge-before.mjs'),true);if(original.hash!==BASELINE)stop('ROLLBACK_BACKUP_INVALID');
  const allowedFiles=new Set([path.join(modules,'broker.mjs'),path.join(modules,'tabs.mjs'),path.join(domHome,'native-host.mjs'),path.join(domHome,'native-host'),nativeManifest,...['manifest.json','worker.js','content.js','editor-main.js'].map(f=>path.join(domHome,'extension',f))]);
  if(!receipt.owned_files||Object.keys(receipt.owned_files).length!==allowedFiles.size||sha(patchDOMBridge(original.bytes.toString()))!==receipt.installed_sha256)stop('ROLLBACK_RECEIPT_INVALID');
  for(const [file,hash]of Object.entries(receipt.owned_files))if(!allowedFiles.has(file)||safe(file).hash!==hash)stop('ROLLBACK_OWNED_FILE_CHANGED');
  await noGrant();atomic(target,original.bytes,receipt.baseline_mode);restart();await wait();
  for(const file of Object.keys(receipt.owned_files))fs.unlinkSync(file);
  for(const file of ['paired-profile.json','token','config.json','bridge-before.mjs','installation.json']){const name=path.join(domHome,file);if(fs.existsSync(name)){safe(name,true);fs.unlinkSync(name);}}
  const socket=path.join(domHome,'dom.sock');if(fs.existsSync(socket)){const st=fs.lstatSync(socket);if(!st.isSocket()||st.uid!==process.getuid())stop('ROLLBACK_SOCKET_UNTRUSTED');fs.unlinkSync(socket);}
  for(const dir of [modules,path.join(domHome,'extension'),domHome]){try{fs.rmdirSync(dir);}catch{/* Preserve unknown files, never recursive-delete. */}}
  process.stdout.write('ROLLBACK_PASS: original bridge restored; unload the extension from Toyota Edge.\n');return;
 }
 if(fs.existsSync(receiptFile)){
  const previous=JSON.parse(safe(receiptFile,true).bytes),original=safe(path.join(domHome,'bridge-before.mjs'),true);
  if(original.hash!==BASELINE||current.hash!==sha(patchDOMBridge(original.bytes.toString()))||current.hash!==previous.installed_sha256)stop('INSTALLED_BRIDGE_CODE_DRIFT');
  const expected=new Map([['payload/browser-dom/broker.mjs',path.join(modules,'broker.mjs')],['payload/browser-dom/tabs.mjs',path.join(modules,'tabs.mjs')],['payload/native-host.mjs',path.join(domHome,'native-host.mjs')],...['manifest.json','worker.js','content.js','editor-main.js'].map(f=>['extension/'+f,path.join(domHome,'extension',f)])]);
  for(const [sourceFile,targetFile]of expected)if(safe(targetFile).hash!==safe(path.join(release,sourceFile)).hash||safe(targetFile).hash!==previous.owned_files?.[targetFile])stop('INSTALLED_DOM_CODE_DRIFT');
  const native=JSON.parse(safe(nativeManifest).bytes);if(native.name!==hostName||native.type!=='stdio'||native.path!==path.join(domHome,'native-host')||JSON.stringify(native.allowed_origins)!==JSON.stringify(['chrome-extension://'+extensionId+'/']))stop('INSTALLED_NATIVE_REGISTRATION_DRIFT');
  for(const f of [nativeManifest,path.join(domHome,'native-host')])if(safe(f).hash!==previous.owned_files?.[f])stop('INSTALLED_HOST_CODE_DRIFT');
  const status=await post('/v1/status');if(status.extension_dom?.enabled!==true)stop('INSTALLED_DOM_BACKEND_UNAVAILABLE');
  process.stdout.write('ALREADY_MATCHED: installed bridge and DOM payload match this release; no files or services changed.\n');return;
 }
 if(current.hash!==BASELINE)stop('LIVE_BRIDGE_CODE_DRIFT');if(fs.existsSync(domHome)||fs.existsSync(modules)||fs.existsSync(nativeManifest))stop('DOM_INSTALLATION_ALREADY_PRESENT');
 const candidate=patchDOMBridge(current.bytes.toString());if(safe(envFile,true).hash!==env.hash)stop('BRIDGE_POLICY_CHANGED');
 const extension=JSON.parse(safe(path.join(release,'extension/manifest.json')).bytes);
 if(JSON.stringify(extension.permissions)!==JSON.stringify(['nativeMessaging','storage'])||JSON.stringify(extension.host_permissions)!==JSON.stringify([scope+'/*']))stop('EXTENSION_PERMISSION_DRIFT');
 execFileSync('/opt/homebrew/opt/node/bin/node',['--version'],{stdio:'pipe',timeout:2000});
 process.stdout.write(JSON.stringify({state:'PREFLIGHT_PASS',baseline_sha256:BASELINE,candidate_sha256:sha(candidate),scope,extension_id:extensionId,permissions:extension.permissions,profile:'Toyota Work11 only; UI loading required',controller_change:false,browser_restart:false,remote_debugging:false,bridge_reload_only:true})+'\n');
 if(mode==='--inspect')return;
 // Recheck immediately before the only service mutation.
 await noGrant();if(safe(target).hash!==BASELINE||safe(envFile,true).hash!==env.hash)stop('LIVE_CODE_OR_POLICY_CHANGED');
 directory(lch);directory(bridgeHome);directory(path.dirname(nativeRoot));directory(nativeRoot);directory(domHome);fs.chmodSync(domHome,0o700);directory(path.join(domHome,'extension'));directory(modules);
 const owned={},put=(file,bytes,mode=0o600)=>{fs.writeFileSync(file,bytes,{mode,flag:'wx'});owned[file]=sha(bytes);};
 let replaced=false;
 try{
  fs.writeFileSync(path.join(domHome,'bridge-before.mjs'),current.bytes,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(domHome,'token'),crypto.randomBytes(48).toString('hex')+'\n',{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(domHome,'config.json'),JSON.stringify({enabled:true,extension_id:extensionId,scope})+'\n',{mode:0o600,flag:'wx'});
  for(const f of ['broker.mjs','tabs.mjs'])put(path.join(modules,f),safe(path.join(release,'payload/browser-dom',f)).bytes);
  put(path.join(domHome,'native-host.mjs'),safe(path.join(release,'payload/native-host.mjs')).bytes);
  for(const f of ['manifest.json','worker.js','content.js','editor-main.js'])put(path.join(domHome,'extension',f),safe(path.join(release,'extension',f)).bytes);
  const launcher=path.join(domHome,'native-host');put(launcher,'#!/bin/sh\nexec '+quote('/opt/homebrew/opt/node/bin/node')+' '+quote(path.join(domHome,'native-host.mjs'))+' "$@"\n',0o700);
  put(nativeManifest,JSON.stringify({name:hostName,description:'Sandbox V3 paired Toyota Teams DOM transport',path:launcher,type:'stdio',allowed_origins:['chrome-extension://'+extensionId+'/']},null,2)+'\n');
  if(safe(target).hash!==BASELINE||safe(envFile,true).hash!==env.hash)stop('LIVE_CODE_OR_POLICY_CHANGED');await noGrant();
  atomic(target,candidate,current.mode);replaced=true;restart();const status=await wait();
  if(status.extension_dom?.enabled!==true||status.extension_dom?.connected!==false)stop('DOM_BROKER_POSTINSTALL_INVALID');
  if(safe(envFile,true).hash!==env.hash)stop('BRIDGE_POLICY_CHANGED');
  fs.writeFileSync(receiptFile,JSON.stringify({schema:'sandbox-v3.teams-dom.install.v1',baseline_sha256:BASELINE,baseline_mode:current.mode,installed_sha256:sha(candidate),release_sha256:sha(safe(path.join(release,'release.json')).bytes),owned_files:owned,profile_ui_loading:'PENDING',live_toyota:'UNVERIFIED',browsers_restarted:false,controller_changed:false},null,2)+'\n',{mode:0o600,flag:'wx'});
  process.stdout.write('INSTALL_BACKEND_PASS; load the reviewed extension in Toyota Work11: '+path.join(domHome,'extension')+'\n');
 }catch(error){
  if(replaced){if(safe(target).hash!==sha(candidate))stop('INSTALL_FAILED_CODE_DRIFT_MANUAL_REVIEW');atomic(target,current.bytes,current.mode);restart();await wait();}
  for(const [file,hash]of Object.entries(owned))if(fs.existsSync(file)&&safe(file).hash===hash)fs.unlinkSync(file);
  for(const file of ['token','config.json','bridge-before.mjs']){const f=path.join(domHome,file);if(fs.existsSync(f)){safe(f,true);fs.unlinkSync(f);}}
  const socket=path.join(domHome,'dom.sock');if(fs.existsSync(socket)){const st=fs.lstatSync(socket);if(!st.isSocket()||st.uid!==process.getuid())stop('ROLLBACK_SOCKET_UNTRUSTED');fs.unlinkSync(socket);}
  for(const dir of [modules,path.join(domHome,'extension'),domHome]){try{fs.rmdirSync(dir);}catch{/* Preserve unknown files. */}}
  throw error;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write('STOP: '+String(e.message).slice(0,100)+'\n');process.exitCode=1;});
