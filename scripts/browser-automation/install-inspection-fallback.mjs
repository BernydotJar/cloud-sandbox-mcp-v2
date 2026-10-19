/** Mac-only guarded replacement of Browser Runtime inspect implementation. */
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const originalHash='38c059fb69cb03c85ead3501176226516014f2254e1047fc5616b6eefd4aa234';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const output=msg=>process.stdout.write('[Inspection patch] '+msg+'\n');
const checkFile=file=>{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('UNSAFE_FILE');return s;};
function run(bin,args) {return execFileSync(bin,args,{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});}
function writeAtomic(target,buf,mode) {
 const temp=target+'.inspection-'+process.pid;
 fs.writeFileSync(temp,buf,{mode,flag:'wx'});
 try{fs.renameSync(temp,target);fs.chmodSync(target,mode);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
async function main(){
 if(process.platform!=='darwin')throw Error('MAC_ONLY');
 if(!['--inspect','--install'].includes(process.argv[2]))throw Error('USE_INSPECT_OR_INSTALL');
 const current=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxComputerUse/browser-runtime/runtime.mjs');
 const candidate=path.join(dir,'runtime.mjs');
 const original=fs.readFileSync(current);
 const replacement=fs.readFileSync(candidate);
 const existing=digest(original), desired=digest(replacement);
 checkFile(current);checkFile(candidate);
 output('CURRENT_SHA256='+existing);
 output('CANDIDATE_SHA256='+desired);
 if(existing===desired){output('ALREADY_INSTALLED');return;}
 if(existing!==originalHash)throw Error('LIVE_RUNTIME_DRIFT_STOP_NO_OVERWRITE');
 const agent='gui/'+process.getuid()+'/com.lch.cloud-sandbox.computer-use';
 run('/bin/launchctl',['print',agent]);
 if(process.argv[2]==='--inspect'){output('PREFLIGHT_READY');return;}
 const backup=path.join(os.homedir(),'Library/Application Support/LCH/CloudSandboxBackups/inspect-'+Date.now());
 fs.mkdirSync(backup,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(backup,'runtime.mjs'),original,{mode:0o600,flag:'wx'});
 const mode=fs.statSync(current).mode&0o777;
 writeAtomic(current,replacement,mode);
 try{run('/bin/launchctl',['kickstart','-k',agent]);}
 catch {writeAtomic(current,original,mode);run('/bin/launchctl',['kickstart','-k',agent]);throw Error('RESTART_FAILED_ROLLED_BACK');}
 output('DEPLOYED=YES');
 output('BACKUP='+backup);
 output('VERIFY_WITH_BROWSER_INSPECT');
}
main().catch(e=>{output('STOP='+String(e.message||e).slice(0,200));process.exitCode=2;});
