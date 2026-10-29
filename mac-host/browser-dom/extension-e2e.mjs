/** Owned isolated Linux Chromium only. Never attach to a Mac or user profile. */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {DOMBroker} from './broker.mjs';
import {DOMBrowserTabs} from './tabs.mjs';
import {patchDOMBridge} from '../../deploy/browser-dom/patch-bridge.mjs';
import {createMcpServer} from '../../dist/mcp/server.js';
import {ComputerUseService} from '../../dist/services/computer-use-service.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createSessionStore} from '../autonomy-session.mjs';
import {evaluateAgentPlan} from '../../scripts/browser-automation/agent-preflight.mjs';
const preflight=evaluateAgentPlan({task:{kind:'web',intent:'qa',context:'isolated',browser:'chromium'},capabilities:{isolated_playwright:true},plan:{engine:'playwright_isolated',operation:'run_qa'}});
if(process.platform!=='linux'||process.env.CUA_DOM_E2E!=='1'||preflight.state!=='PLAN_VALIDATED')throw Error('EXPLICIT_ISOLATED_LINUX_DOM_QA_REQUIRED');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'sandbox-dom-e2e-'));
fs.chmodSync(temp,0o700);const extension=path.join(temp,'extension'),home=path.join(temp,'host'),profile=path.join(temp,'profile');fs.mkdirSync(home,{mode:0o700});fs.cpSync(path.join(root,'deploy/browser-dom/extension'),extension,{recursive:true});
const meta=JSON.parse(fs.readFileSync(path.join(root,'deploy/browser-dom/extension-id.json'))),hostName='com.lch.sandbox_dom_test_'+process.pid;
const worker=path.join(extension,'worker.js');fs.writeFileSync(worker,fs.readFileSync(worker,'utf8').replaceAll('com.lch.sandbox_v3_dom',hostName));
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({enabled:true,extension_id:meta.extension_id,scope:'https://teams.cloud.microsoft'}),{mode:0o600});fs.writeFileSync(path.join(home,'token'),crypto.randomBytes(48).toString('hex'),{mode:0o600});
fs.copyFileSync(path.join(root,'mac-host/browser-dom/native-host.mjs'),path.join(home,'native-host.mjs'));fs.chmodSync(path.join(home,'native-host.mjs'),0o600);
const launcher=path.join(home,'launch');fs.writeFileSync(launcher,'#!/bin/sh\nexec '+"'"+process.execPath.replaceAll("'","'\\''")+"' '"+path.join(home,'native-host.mjs').replaceAll("'","'\\''")+"' \"$@\"\n",{mode:0o700});
const manifest={name:hostName,description:'Isolated Sandbox DOM test',path:launcher,type:'stdio',allowed_origins:[meta.origin]};
const nativeDirs=[path.join(os.homedir(),'.config/chromium/NativeMessagingHosts'),path.join(profile,'NativeMessagingHosts')];const created=[];
for(const dir of nativeDirs){fs.mkdirSync(dir,{recursive:true});const p=path.join(dir,hostName+'.json');fs.writeFileSync(p,JSON.stringify(manifest),{flag:'wx',mode:0o600});created.push(p);}
const broker=new DOMBroker({home});let browser,hostBridge,mcp,client;
const bridgeFile=path.join(root,'mac-host/.dom-e2e-'+process.pid+'.mjs');
const evidence={environment:'isolated Linux Chromium extension + real Native Messaging + private Unix broker; no Mac/user profiles',checks:[],sent:0};
try{
 await broker.start();browser=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-extensions-except='+extension,'--load-extension='+extension]});
 await browser.route('https://teams.cloud.microsoft/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Own chat fixture</title><main><h1>Own chat fixture</h1><div role="textbox" aria-label="Type a message" contenteditable="true"></div><input type="password" aria-label="Password" value="private-fixture"><button aria-label="Send">Send</button><button aria-label="Duplicate">A</button><button aria-label="Duplicate">B</button></main><script>const e=document.querySelector('[contenteditable]');e.textContent=localStorage.getItem('draft')||'';window.sent=0;window.inputEvents=[];e.addEventListener('input',event=>{localStorage.setItem('draft',e.innerText);inputEvents.push({trusted:event.isTrusted,type:event.inputType});});document.querySelector('[aria-label=Send]').onclick=()=>globalThis.sent++;</script>`}));
 const page=await browser.newPage();await page.goto('https://teams.cloud.microsoft/fixture');
 const sw=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');assert.equal(new URL(sw.url()).hostname,meta.extension_id);
 for(let n=0;n<60&&!broker.ready;n++)await sleep(100);
 if(!broker.ready){console.log(JSON.stringify({broker:broker.status(),worker:await sw.evaluate(()=>({id:globalThis.chrome.runtime.id,last:globalThis.chrome.runtime.lastError?.message}))}));throw Error('DOM_EXTENSION_NATIVE_CONNECTION_FAILED');}
 evidence.checks.push('actual_extension_id','native_messaging_origin_auth','profile_pin','private_unix_connection');
 const source=fs.readFileSync(path.join(root,'mac-host/bridge.mjs'),'utf8');fs.writeFileSync(bridgeFile,patchDOMBridge(source),{flag:'wx',mode:0o600});
 const {createBridgeServer}=await import(bridgeFile);const wireToken=crypto.randomBytes(24).toString('hex');
 const wireSessions=createSessionStore();const wireGrant=wireSessions.begin({scope:'edge',duration_minutes:5,max_actions:40,purpose:'Isolated MCP DOM fixture acceptance'});
 let nativeCalls=0;
 hostBridge=createBridgeServer({token:wireToken,allowedOrigins:new Set(['https://teams.cloud.microsoft']),dynamicTabs:true,restrictBrowserWrites:true,platform:'darwin',enableBrowserRuntime:true,sessionStore:wireSessions,extensionDOMBroker:broker,nativeHandler:async()=>{nativeCalls++;throw Error('Native transport must not run');}});
 await new Promise(resolve=>hostBridge.listen(0,'127.0.0.1',resolve));const bridgeURL='http://127.0.0.1:'+hostBridge.address().port;
 const proxy=new ComputerUseService({COMPUTER_USE_ENABLED:true,COMPUTER_USE_BRIDGE_TOKEN:wireToken,COMPUTER_USE_BRIDGE_URL:bridgeURL});
 mcp=createMcpServer({},proxy);client=new Client({name:'isolated-dom-mcp',version:'1'},{capabilities:{}});const [a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(b);await client.connect(a);
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
 const wire=await call('browser_tabs',{browser:'edge',title:'Own chat fixture'});assert.equal(wire.provider,'extension_dom');const ref=wire.tabs[0].tab_ref;
 let obs=await call('browser_inspect',{browser:'edge',tab_ref:ref});assert.equal(obs.inspection_mode,'dom');
 const marker='MCP DOM persisted marker';const req={browser:'edge',tab_ref:ref,session_id:wireGrant.session_id,expected_revision:obs.revision,request_id:'wire-dom-marker-0001',action:'fill',locator:{by:'role',role:'textbox',name:'Type a message'},value:marker};
 const receipt=await call('browser_action',req);assert.deepEqual(await call('browser_action',req),receipt);obs=await call('browser_inspect',{browser:'edge',tab_ref:ref});assert.equal(obs.controls.find(n=>n.name==='Type a message').value_observation.sha256,crypto.createHash('sha256').update(marker).digest('hex'));
 const reload=await fetch(bridgeURL+'/v2/browser/reload',{method:'POST',headers:{authorization:'Bearer '+wireToken,'content-type':'application/json'},body:JSON.stringify({browser:'edge',tab_ref:ref,session_id:wireGrant.session_id,request_id:'wire-dom-reload-0001'})});assert.equal(reload.status,200);await page.waitForLoadState('domcontentloaded');await sleep(100);
 obs=await call('browser_inspect',{browser:'edge',tab_ref:ref});assert.equal(obs.controls.find(n=>n.name==='Type a message').value_observation.sha256,crypto.createHash('sha256').update(marker).digest('hex'));
 await call('browser_action',{...req,expected_revision:obs.revision,request_id:'wire-dom-clear-0001',value:''});obs=await call('browser_inspect',{browser:'edge',tab_ref:ref});assert.equal(obs.controls.find(n=>n.name==='Type a message').value_observation.kind,'empty');assert.equal(nativeCalls,0);
 evidence.checks.push('real_existing_MCP_tools_to_DOM','HTTP_bridge_grant_and_origin_path','MCP_fill_reload_readback_clear','zero_native_transport_calls');

 const operator=await browser.newPage();await operator.goto('data:text/html,<title>Operator fixture</title><input id="operator" value="unchanged">');await operator.bringToFront();
 const activeBefore=await sw.evaluate(async()=> (await globalThis.chrome.tabs.query({active:true})).map(t=>t.id));
 const sessions=createSessionStore();const grant=sessions.begin({scope:'edge',duration_minutes:5,max_actions:30,purpose:'Isolated extension backend verification; no user account'});
 const audit=[];const tabs=new DOMBrowserTabs({broker,sessionStore:sessions,allowedOrigins:new Set(['https://teams.cloud.microsoft']),dynamicTabs:true,audit:async e=>audit.push(e)});
 const discovery=await tabs.discover({browser:'edge',title:'Own chat fixture'});assert.equal(discovery.provider,'extension_dom');assert.equal(discovery.tabs.length,1);const tab_ref=discovery.tabs[0].tab_ref;
 let snapshot=await tabs.inspect({browser:'edge',tab_ref});assert(!JSON.stringify(snapshot).includes('private-fixture'));assert(!snapshot.controls.some(n=>n.name==='Password'));
 evidence.checks.push('actual_content_script_dom','protected_field_redaction');
 const body='Sandbox DOM background marker';const action={browser:'edge',tab_ref,session_id:grant.session_id,expected_revision:snapshot.revision,request_id:'dom-fixture-fill-0001',action:'fill',locator:{by:'role',role:'textbox',name:'Type a message'},value:body};
 const firstReceipt=await tabs.perform(action);assert.deepEqual(await tabs.perform(action),firstReceipt);
 snapshot=await tabs.inspect({browser:'edge',tab_ref});const field=snapshot.controls.find(n=>n.name==='Type a message');assert.equal(field.value_observation.sha256,crypto.createHash('sha256').update(body).digest('hex'));
 const activeAfter=await sw.evaluate(async()=> (await globalThis.chrome.tabs.query({active:true})).map(t=>t.id));assert.deepEqual(activeAfter,activeBefore);assert.equal(await operator.locator('#operator').inputValue(),'unchanged');
 assert((await page.evaluate(()=>globalThis.inputEvents)).every(e=>e.trusted));evidence.checks.push('background_rich_text_fill','trusted_browser_input_event','active_tab_unchanged','operator_input_unchanged','fingerprint_readback');
 await tabs.reload({browser:'edge',tab_ref,session_id:grant.session_id,request_id:'dom-fixture-reload-0001'});await page.waitForLoadState('domcontentloaded');await sleep(100);
 snapshot=await tabs.inspect({browser:'edge',tab_ref});assert.equal(snapshot.controls.find(n=>n.name==='Type a message').value_observation.sha256,crypto.createHash('sha256').update(body).digest('hex'));evidence.checks.push('persisted_after_real_reload');
 await tabs.perform({...action,expected_revision:snapshot.revision,request_id:'dom-fixture-clear-0001',value:''});snapshot=await tabs.inspect({browser:'edge',tab_ref});assert.equal(snapshot.controls.find(n=>n.name==='Type a message').value_observation.kind,'empty');
 assert.equal(await page.evaluate(()=>globalThis.sent),0);assert(!JSON.stringify(audit).includes(body));evidence.checks.push('verified_cleanup','no_send','audit_omits_body');
 await assert.rejects(tabs.perform({...action,expected_revision:snapshot.revision,request_id:'dom-fixture-duplicate-0001',action:'click',locator:{by:'role',role:'button',name:'Duplicate'}}),/UNCERTAIN/);evidence.checks.push('duplicate_control_rejected');
 // Fresh-control and full-URL (including hash) checks run inside the actual content script.
 snapshot=await tabs.inspect({browser:'edge',tab_ref});
 await page.locator('[contenteditable]').evaluate(el=>{const replacement=el.cloneNode(true);el.replaceWith(replacement);});
 await assert.rejects(tabs.perform({...action,expected_revision:snapshot.revision,request_id:'dom-fixture-control-change-0001'}),/UNCERTAIN/);
 assert.equal((await page.locator('[contenteditable]').innerText()).trim(),'');
 snapshot=await tabs.inspect({browser:'edge',tab_ref});
 await page.evaluate(()=>{globalThis.location.hash='changed-after-inspect';});
 await assert.rejects(tabs.perform({...action,expected_revision:snapshot.revision,request_id:'dom-fixture-url-change-0001'}),/NAVIGATION_CHANGED/);
 assert.equal((await page.locator('[contenteditable]').innerText()).trim(),'');
 evidence.checks.push('replaced_dom_node_rejected','changed_full_url_rejected');
 // Restart only the backend socket; the same live extension/native host reconnects.
 await broker.close();await broker.start();
 for(let n=0;n<70&&!broker.ready;n++)await sleep(100);
 assert.equal(broker.ready,true);await assert.rejects(tabs.inspect({browser:'edge',tab_ref}),/TAB_STALE/);
 const reconnected=await call('browser_tabs',{browser:'edge',title:'Own chat fixture'});
 const fresh=await call('browser_inspect',{browser:'edge',tab_ref:reconnected.tabs[0].tab_ref});
 assert.equal(fresh.controls.find(n=>n.name==='Type a message').value_observation.kind,'empty');
 assert.deepEqual(await sw.evaluate(async()=> (await globalThis.chrome.tabs.query({active:true})).map(t=>t.id)),activeBefore);
 assert.equal(await page.evaluate(()=>globalThis.sent),0);assert.equal(nativeCalls,0);
 evidence.checks.push('native_host_reconnect_after_broker_restart','old_refs_invalidated_on_reconnect','no_mutation_replay_on_reconnect');
 if(process.env.CUA_CKEDITOR_E2E==='1'){
  const asset=path.join(os.tmpdir(),'sandbox-ckeditor5-npm-49.0.1.umd.js'),assetHash='d00faf38df0532180459affb6a4b150e822a96294806456357e1d344b787fa87';
  if(!fs.existsSync(asset)){execFileSync('npm',['pack','ckeditor5@49.0.1','--pack-destination',temp,'--silent'],{cwd:temp,stdio:'pipe',timeout:30000});const bytes=execFileSync('tar',['-xOzf',path.join(temp,'ckeditor5-49.0.1.tgz'),'package/dist/browser/ckeditor5.umd.js'],{maxBuffer:3000000,timeout:5000});fs.writeFileSync(asset,bytes,{flag:'wx',mode:0o600});}
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex'),assetHash);
  await browser.route('https://teams.cloud.microsoft/vendor/ckeditor.js',route=>route.fulfill({contentType:'text/javascript; charset=utf-8',path:asset}));
  await browser.route('https://teams.cloud.microsoft/ckeditor-fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><title>Real CKEditor self fixture</title><main><h1>Real CKEditor self fixture</h1><div id="editor"></div><button id="send" aria-label="Send">Send</button></main><script src="/vendor/ckeditor.js"></script><script>globalThis.sent=0;document.getElementById('send').onclick=()=>globalThis.sent++;const {ClassicEditor,Essentials,Paragraph}=CKEDITOR;ClassicEditor.create(document.getElementById('editor'),{licenseKey:'GPL',plugins:[Essentials,Paragraph],toolbar:[],initialData:localStorage.getItem('ck-draft')||''}).then(editor=>{editor.editing.view.change(w=>w.setAttribute('aria-label','Type a message',editor.editing.view.document.getRoot()));editor.model.document.on('change:data',()=>localStorage.setItem('ck-draft',editor.getData()));globalThis.ckReady=true;}).catch(e=>{globalThis.ckError=String(e);});</script>`}));
  const ck=await browser.newPage();ck.on('pageerror',error=>console.log('CK_FIXTURE_PAGE_ERROR '+error.message));await ck.goto('https://teams.cloud.microsoft/ckeditor-fixture');await ck.waitForFunction(()=>globalThis.ckReady===true||globalThis.ckError,undefined,{timeout:5000});assert.equal(await ck.evaluate(()=>globalThis.ckError),undefined);
  await operator.bringToFront();const ckActiveBefore=await sw.evaluate(async()=> (await globalThis.chrome.tabs.query({active:true})).map(t=>t.id));
  const ckTabs=await call('browser_tabs',{browser:'edge',title:'Real CKEditor self fixture'}),ckRef=ckTabs.tabs[0].tab_ref;let ckObs=await call('browser_inspect',{browser:'edge',tab_ref:ckRef});assert.equal(ckObs.controls.find(n=>n.name==='Type a message').fill_backend,'ckeditor5_model');
  const ckText='Sandbox <&> CKEditor model test',ckHash=crypto.createHash('sha256').update(ckText).digest('hex');
  const ckRequest={browser:'edge',tab_ref:ckRef,session_id:wireGrant.session_id,expected_revision:ckObs.revision,request_id:'genuine-ckeditor-fill-0001',action:'fill',locator:{by:'role',role:'textbox',name:'Type a message'},value:ckText};await call('browser_action',ckRequest);
  ckObs=await call('browser_inspect',{browser:'edge',tab_ref:ckRef});assert.equal(ckObs.controls.find(n=>n.name==='Type a message').value_observation.sha256,ckHash);assert.equal(await ck.locator('.ck-editor__editable').evaluate(el=>el.querySelector('script')),null);
  const reloadCK=async request_id=>{const r=await fetch(bridgeURL+'/v2/browser/reload',{method:'POST',headers:{authorization:'Bearer '+wireToken,'content-type':'application/json'},body:JSON.stringify({browser:'edge',tab_ref:ckRef,session_id:wireGrant.session_id,request_id})});assert.equal(r.status,200);await ck.waitForLoadState('domcontentloaded');await ck.waitForFunction(()=>globalThis.ckReady===true||globalThis.ckError,undefined,{timeout:5000});assert.equal(await ck.evaluate(()=>globalThis.ckError),undefined);};
  await reloadCK('genuine-ckeditor-reload-0001');ckObs=await call('browser_inspect',{browser:'edge',tab_ref:ckRef});assert.equal(ckObs.controls.find(n=>n.name==='Type a message').value_observation.sha256,ckHash);
  await call('browser_action',{...ckRequest,expected_revision:ckObs.revision,request_id:'genuine-ckeditor-clear-0001',value:''});await reloadCK('genuine-ckeditor-cleanup-reload');ckObs=await call('browser_inspect',{browser:'edge',tab_ref:ckRef});assert.equal(ckObs.controls.find(n=>n.name==='Type a message').value_observation.kind,'empty');
  assert.deepEqual(await sw.evaluate(async()=> (await globalThis.chrome.tabs.query({active:true})).map(t=>t.id)),ckActiveBefore);assert.equal(await ck.evaluate(()=>globalThis.sent),0);assert.equal(nativeCalls,0);
  evidence.checks.push('genuine_vendor_CKEditor_49_0_1','ckeditor_model_fill_escaped_text','ckeditor_reload_persistence','ckeditor_clear_reload_empty','ckeditor_inactive_tab_and_no_send');
 }
 console.log(JSON.stringify({...evidence,result:'PASS'},null,2));
}finally{
 if(client)await client.close();if(mcp)await mcp.close();if(hostBridge)await new Promise(resolve=>hostBridge.close(resolve));
 if(browser)await browser.close();await broker.close();if(fs.existsSync(bridgeFile))fs.unlinkSync(bridgeFile);
 for(const p of created){const value=JSON.parse(fs.readFileSync(p,'utf8'));if(value.name===hostName&&value.path===launcher)fs.unlinkSync(p);}
 fs.rmSync(temp,{recursive:true,force:true});
}
