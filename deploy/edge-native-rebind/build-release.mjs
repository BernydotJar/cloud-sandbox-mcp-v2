#!/usr/bin/env node
// Produces an immutable source-commit-verified handoff, never deploys to Mac.
import fs from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dest=path.resolve(process.argv[2]||'/shared-auth/deployment/handoff/cloud-sandbox-computer-use/edge-native-target-rebind-20261023');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const current=await fs.readFile(path.join(root,'mac-host/native.jxa'));
const committed=execFileSync('git',['-C',root,'show','HEAD:mac-host/native.jxa']);
if(sha(committed)!==sha(current))throw Error('NATIVE_DRIVER_NOT_COMMITTED');
const installer=await fs.readFile(path.join(root,'deploy/edge-native-rebind/install-on-mac.mjs'));
await fs.mkdir(dest,{recursive:false,mode:0o700});
await fs.writeFile(path.join(dest,'native.jxa'),current,{mode:0o600,flag:'wx'});
await fs.writeFile(path.join(dest,'install-on-mac.mjs'),installer,{mode:0o600,flag:'wx'});
const manifest={
 schema:'cloud-sandbox.native-edge-rebind.v1',
 source_commit:git(['rev-parse','HEAD']),
 native_baseline_sha256:'147330664005f6bf5479a9134390b68b1d4fb726aa8fb3d48d791182ae4fa38e',
 native_sha256:sha(current),
 installer_sha256:sha(installer),
 intervention:'native-driver-only',
 browsers_restarted:false,
 controller_restarted:false,
 host_bridge_restarted:false,
 purpose:'Safe title+sanitized URL tab rebind when browser window/tab indices shift; no CDP or profile changes'
};
const content=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(dest,'manifest.json'),content,{mode:0o600,flag:'wx'});
await fs.writeFile(path.join(dest,'manifest.sha256'),sha(content)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({ready:true,output:dest,source_commit:manifest.source_commit,sha256:manifest.native_sha256,files:4},null,2));
