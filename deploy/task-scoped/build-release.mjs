#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyTaskEdits} from './patch.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const commit=git('rev-parse','HEAD'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const baseline=JSON.parse(fs.readFileSync(path.join(repo,'deploy/task-scoped/baseline-hashes.json')));
const input=process.argv[2],output=process.argv[3];
if(!path.isAbsolute(input||'')||!path.isAbsolute(output||''))throw Error('USE_ABSOLUTE_BASELINE_AND_NEW_RELEASE_DIR');
const candidates={},files={};
for(const [name,before] of Object.entries(baseline)){
 const data=fs.readFileSync(path.join(input,name));
 if(sha(data)!==before)throw Error('REVIEWED_MAC_BASELINE_REQUIRED');
 const candidate=name==='autonomy-session.mjs'?fs.readFileSync(path.join(repo,'mac-host/autonomy-session.mjs'),'utf8'):applyTaskEdits(data.toString(),name);
 const check=spawnSync(process.execPath,['--check','--input-type=module'],{input:candidate,encoding:'utf8'});
 if(check.status!==0)throw Error('CANDIDATE_SYNTAX_FAILED');
 candidates[name]=candidate;files[name]={before,after:sha(candidate)};
}
fs.mkdirSync(output,{mode:0o700});
for(const [name,candidate] of Object.entries(candidates)){
 const target=path.join(output,'payload',name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,candidate,{mode:0o600,flag:'wx'});
}
for(const name of ['install-on-mac.mjs','upgrade-controller-on-mac.mjs','README.md'])
 fs.copyFileSync(path.join(repo,'deploy/task-scoped',name),path.join(output,name),fs.constants.COPYFILE_EXCL);
const portal=path.join(output,'portal');fs.mkdirSync(portal,{mode:0o700});
for(const name of ['bridge-toast.swift','bridge-toast.sha256','install-glass-on-mac.mjs','preview-on-mac.mjs','README.md'])
 fs.copyFileSync(path.join(repo,'deploy/bridge-toast',name),path.join(portal,name));
const dependencies={};
const lock=JSON.parse(fs.readFileSync(path.join(repo,'package-lock.json')));
for(const name of ['@modelcontextprotocol/sdk','express','playwright-core','zod','hono','@hono/node-server','body-parser','fast-uri','ip-address','qs'])
 dependencies[name]=lock.packages['node_modules/'+name].version;
const manifest={schema:'sandbox-v3.task-scoped.v1',source_commit:commit,files,dependencies,
 installer_sha256:sha(fs.readFileSync(path.join(output,'install-on-mac.mjs'))),
 deployment_status:'STAGED_NOT_INSTALLED',no_browser_profile_change:true};
const blob=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'manifest.json'),blob,{mode:0o600,flag:'wx'});
fs.writeFileSync(path.join(output,'manifest.sha256'),sha(blob)+'\n',{mode:0o600,flag:'wx'});
const deps=path.join(output,'controller-dependencies');fs.mkdirSync(deps,{mode:0o700});
for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(repo,name),path.join(deps,name));
fs.writeFileSync(path.join(deps,'Dockerfile'),'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev --ignore-scripts\n',{mode:0o600});
process.stdout.write(JSON.stringify({output,source_commit:commit,files:Object.keys(files),deployment:'STAGED_NOT_INSTALLED'},null,2)+'\n');
