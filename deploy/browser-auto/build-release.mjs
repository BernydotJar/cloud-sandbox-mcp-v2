import process from 'node:process';
import {Buffer} from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const destination=path.resolve(process.argv[2]||'/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-auto');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
if(git(['status','--porcelain']))throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');

const allowed={
  'bridge.mjs':['9483cb44aac32fab29a957f74101dd1e20d0309b3480e82ba8f715d44f74b8a5'],
  'runtime.mjs':['a4a548d90bec8f670887a694acff98bf4bfcfc93aad67c3afb19fd3fccf4bfac'],
  'connection-pool.mjs':[
    'd575adac318e4552199a29dad6b07b898033f22cb1a6bb85883d6b7ed86c924e',
    '164a4d0812a63a46ac8e731896a801c51d0a8f84091104b1f7d51fd21a179563'
  ],
  'browser-runtime-tools.js':['064cd9e372badd8de8b61bd5c5dace7a925a540362e3d2356b3acf8557e64b73']
};
const sources={
  'bridge.mjs':'mac-host/bridge.mjs',
  'runtime.mjs':'mac-host/browser-runtime/runtime.mjs',
  'connection-pool.mjs':'mac-host/browser-runtime/connection-pool.mjs',
  'browser-runtime-tools.js':'dist/mcp/browser-runtime-tools.js'
};
const files={};
for(const [name,relative] of Object.entries(sources)){
  const bytes=await fs.readFile(path.join(repo,relative));
  files[name]={bytes,sha256:sha(bytes),allowed_previous:allowed[name]};
}
const probe=await fs.readFile(path.join(repo,'deploy/browser-auto/registry-probe.mjs'));
const installer=await fs.readFile(path.join(repo,'deploy/browser-auto/install-on-mac.mjs'));
const notes=await fs.readFile(path.join(repo,'deploy/browser-auto/README.md'));

await fs.mkdir(destination,{recursive:false,mode:0o700});
for(const [name,record] of Object.entries(files))
  await fs.writeFile(path.join(destination,name),record.bytes,{flag:'wx',mode:0o600});
for(const [name,bytes] of Object.entries({
  'registry-probe.mjs':probe,'install-on-mac.mjs':installer,'README.md':notes
}))await fs.writeFile(path.join(destination,name),bytes,{flag:'wx',mode:0o600});

const manifest={
  schema:'browser-auto-release.v1',
  source_commit:git(['rev-parse','HEAD']),
  tools_before:28,tools_after:29,
  code_only:true,
  assets:Object.fromEntries(Object.entries(files).map(([name,entry])=>[
    name,{sha256:entry.sha256,allowed_previous:entry.allowed_previous}
  ])),
  probe_sha256:sha(probe),
  note:'Local SHA-256 integrity does not establish publisher authenticity.'
};
const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(destination,'manifest.json'),bytes,{flag:'wx',mode:0o600});
await fs.writeFile(path.join(destination,'manifest.sha256'),sha(bytes)+'\n',{flag:'wx',mode:0o600});
process.stdout.write('BROWSER_AUTO_RELEASE_READY source='+manifest.source_commit+
  ' files='+Object.keys(files).length+'\n');
