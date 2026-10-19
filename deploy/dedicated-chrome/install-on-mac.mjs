/**
 * Operator-only, audited Mac deployment. Version-pin existing native-first bridge;
 * never modify personal Chrome, existing sessions, secrets or controller binaries.
 */
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const source=path.dirname(fileURLToPath(import.meta.url));
const expected='3c501d5f81cebdcdd9c6cf56487ba3fe837ee8e686c3ecb980dae537a530c69e';
const digest=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const out=s=>process.stdout.write('[Dedicated Chrome Auto] '+s+'\n');
function run(cmd,args){return execFileSync(cmd,args,{timeout:22000,stdio:['ignore','pipe','pipe']}).toString().trim();}
function safe(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('UNSAFE_FILE');return {bytes:fs.readFileSync(file),mode:st.mode&0o777};}
function write(file,bytes,mode){const tmp=file+'.upgrade-'+process.pid;fs.writeFileSync(tmp,bytes,{flag:'wx',mode});try{fs.renameSync(tmp,file);fs.chmodSync(file,mode);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function main(){
 if(process.platform!=='darwin')throw Error('MAC_ONLY');
 const operation=process.argv[2]||'--inspect';
 if(!['--inspect','--activate'].includes(operation))throw Error('INVALID_OPERATION');
 const host=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse');
 const bridgeFile=path.join(host,'bridge.mjs');
 const info=JSON.parse(run('docker',['inspect','cloud-sandbox-mcp']))[0];
 if(!info?.State?.Running || info.Config?.Labels?.['com.docker.compose.service']!=='mcp')throw Error('UNEXPECTED_CONTROLLER');
 const working=info.Config.Labels['com.docker.compose.project.working_dir'];
 if(!working)throw Error('COMPOSE_LOCATION_UNAVAILABLE');
 const configFile=path.join(fs.realpathSync(working),'.env');
 const bridge=safe(bridgeFile), replacement=safe(path.join(source,'bridge.mjs'));
 const config=safe(configFile);
 if(digest(bridge.bytes)!==expected && digest(bridge.bytes)!==digest(replacement.bytes))
   throw Error('UNKNOWN_BRIDGE_VERSION_NO_CHANGES');
 let entries=config.bytes.toString().split(/\r?\n/);
 const changes={
   COMPUTER_USE_BROWSER_ROUTING:'prefer_persistent',
   COMPUTER_USE_CHROME_ENDPOINT:'http://127.0.0.1:9223',
   COMPUTER_USE_DEDICATED_CHROME_AUTO_START:'true'
 };
 for(const [key,value] of Object.entries(changes)){
   const current=entries.flatMap((line,i)=>line.startsWith(key+'=')?[i]:[]);
   if(current.length>1)throw Error('DUPLICATE_CONFIG_'+key);
   if(current.length)entries[current[0]]=key+'='+value;
   else entries.push(key+'='+value);
 }
 const next=Buffer.from(entries.join('\n'));
 const agent='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
 run('/bin/launchctl',['print',agent]);
 out('KNOWN_BRIDGE_VERSION=PASS');
 out('PATCH_REQUIRED='+(digest(bridge.bytes)!==digest(replacement.bytes)));
 out('CHROME_MODE=dedicated-profile-9223');
 if(operation==='--inspect')return;
 const backup=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxBackups/dedicated-chrome-'+Date.now());
 fs.mkdirSync(backup,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(backup,'bridge.mjs'),bridge.bytes,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(backup,'bridge.env'),config.bytes,{flag:'wx',mode:0o600});
 if(digest(bridge.bytes)!==digest(replacement.bytes))write(bridgeFile,replacement.bytes,bridge.mode);
 write(configFile,next,config.mode);
 try{run('/bin/launchctl',['kickstart','-k',agent]);}
 catch{
   write(bridgeFile,bridge.bytes,bridge.mode);write(configFile,config.bytes,config.mode);
   run('/bin/launchctl',['kickstart','-k',agent]);
   throw Error('RESTART_FAILED_CONFIG_ROLLED_BACK');
 }
 out('ACTIVATED=YES');
 out('BACKUP='+backup);
 out('NEXT=Use browser_tabs(chrome). First request may start dedicated Chrome for one-time user login.');
}
try{main();}catch(e){out('STOP='+String(e.message||e).slice(0,160));process.exitCode=2;}
