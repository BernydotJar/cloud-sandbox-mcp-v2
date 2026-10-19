/** One-shot macOS operator preflight, guarded patch and authenticated CDP smoke. */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.join(os.homedir(),'.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use');
const report=(key,value)=>process.stdout.write('[Browser One Shot] '+key+'='+value+'\n');
function run(cmd,args){return execFileSync(cmd,args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']});}
async function main(){
 if(process.platform!=='darwin')throw Error('MAC_ONLY');
 const location=path.join(root,'inspection-fallback/install-inspection-fallback.mjs');
 if(!fs.existsSync(location))throw Error('BRIDGE_RELEASE_MISSING');
 const mode=process.argv[2]||'--inspect';
 if(!['--inspect','--activate'].includes(mode))throw Error('INVALID_MODE');
 let output=run(process.execPath,[location,mode==='--activate'?'--install':'--inspect']);
 report('PATCH',output.includes('ALREADY_INSTALLED')?'ALREADY_INSTALLED':output.includes('DEPLOYED=YES')?'DEPLOYED':'INSPECTED');
 const playwright=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse/node_modules/playwright-core/index.mjs');
 if(!fs.existsSync(playwright))throw Error('MAC_PLAYWRIGHT_MISSING');
 const {chromium}=await import(pathToFileURL(playwright).href);
 let browser;
 try{
   browser=await chromium.connectOverCDP('chrome',{timeout:12000,noDefaults:true});
   report('CHROME_CDP','CONNECTED');
   const pages=browser.contexts().flatMap(c=>c.pages());
   const target=pages.find(p=>p.url().startsWith('https://suno.com/create'));
   if(!target){report('SUNO_SESSION','NOT_FOUND_IN_CHROME');return;}
   report('SUNO_SESSION','FOUND');
   for(const [name,method] of [
     ['TITLE',()=>target.title()],
     ['ARIA',()=>target.locator('body').ariaSnapshot({timeout:4500})],
     ['DOM_TEXT',()=>target.locator('body').innerText({timeout:4500})],
     ['CDP_DOM',async()=>{const session=await target.context().newCDPSession(target);try{return await session.send('DOM.getDocument',{depth:0});}finally{await session.detach();}}]
   ]){
     try{await method();report(name,'PASS');}catch{report(name,'UNAVAILABLE');}
   }
 }finally{await browser?.close().catch(()=>{});}
}
main().catch(e=>{report('STOP',String(e.message||e).replace(/[^\x20-\x7e]/g,'').slice(0,150));process.exitCode=2;});
