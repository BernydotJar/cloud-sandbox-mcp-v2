#!/usr/bin/env node
/**
 * Source-pinned, no-change release packager. Source must be committed.
 * This command never changes the installed Mac Bridge or browsers.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import {Buffer} from 'node:buffer';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sourceCommit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const baselineCommit='8789952dd2e559c6df3465573407bab7ecfa1f30';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const components={};
for(const [kind,filename] of [['bridge','mac-host/bridge.mjs'],
  ['store','mac-host/autonomy-session.mjs']]){
 const current=await fs.readFile(path.join(root,filename));
 const committed=execFileSync('git',['-C',root,'show','HEAD:'+filename]);
 if(sha(current)!==sha(committed))throw Error('UNCOMMITTED_MAC_SOURCE');
 const previous=execFileSync('git',['-C',root,'show',baselineCommit+':'+filename]);
 components[kind]={baseline_sha256:sha(previous),target_sha256:sha(current)};
}
const buildFile=path.join(root,'deploy/session-budget');
const files=['install-on-mac.mjs','patch.mjs'];
for(const filename of files){
 const current=await fs.readFile(path.join(buildFile,filename));
 const committed=execFileSync('git',['-C',root,'show','HEAD:deploy/session-budget/'+filename]);
 if(sha(current)!==sha(committed))throw Error('UNCOMMITTED_RELEASE_INSTALLER');
}
const dest=path.resolve(process.argv[2]||
  '/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-bounded-sessions-20261026-'+sourceCommit.slice(0,7));
await fs.mkdir(dest,{recursive:false,mode:0o700});
for(const filename of files)
 await fs.writeFile(path.join(dest,filename),await fs.readFile(path.join(buildFile,filename)),
   {flag:'wx',mode:0o600});
const manifest={schema:'cloud-sandbox.mac-session-budget.v1',
  source_commit:sourceCommit,baseline_commit:baselineCommit,
  components,installer_sha256:sha(await fs.readFile(path.join(dest,'install-on-mac.mjs'))),
  patch_sha256:sha(await fs.readFile(path.join(dest,'patch.mjs'))),
  source_verification_only:true,mac_rollout_requires_operator_invocation:true,
  changes:['bridge.mjs','autonomy-session.mjs'],max_minutes:30,max_actions:200,
  no_browser_profile_change:true};
const blob=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(dest,'manifest.json'),blob,{flag:'wx',mode:0o600});
await fs.writeFile(path.join(dest,'manifest.sha256'),sha(blob)+'\n',{flag:'wx',mode:0o600});
const cmd='node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/'+
  path.basename(dest)+'/install-on-mac.mjs"';
const readme=[
  '# Bounded Sessions Mac Bridge Handoff',
  '',
  'Verified source commit: '+sourceCommit,
  '',
  'Run on the operator Mac Terminal (not in Linux):',
  '',
  cmd+' --inspect',
  '',
  'If preflight returns SAFE_PREFLIGHT=PASS, activate once:',
  '',
  cmd+' --install',
  '',
  'Only the Mac Bridge LaunchAgent is restarted. Chrome, Edge and Docker remain unchanged.',
  'Installer backs up originals, verifies code hashes and no active session,',
  'and rolls back on failed restart or policy mismatch.',
  'If a baseline does not match, stop; do not force overwrite.'
].join('\n')+'\n';
await fs.writeFile(path.join(dest,'README.md'),readme,{flag:'wx',mode:0o600});
console.log(JSON.stringify({ready:true,source_commit:sourceCommit,output:dest,
  target_files:manifest.changes,operator_execution_required:true},null,2));
