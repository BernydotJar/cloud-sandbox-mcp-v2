#!/usr/bin/env node
// Build a hash-pinned review handoff only. This script cannot modify Mac.
import fs from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]||
  '/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-native-targeting-parity-20261023');
if(output.startsWith(root+path.sep))throw Error('RELEASE_MUST_BE_OUTSIDE_SOURCE');
const command=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourcePaths=[
  'mac-host/bridge.mjs','mac-host/native.jxa','mac-host/native-targeting.mjs',
  'mac-host/native-ax-provider.mjs','mac-host/native-ax/AXBrowserHelper.swift',
  'src/services/computer-use-service.ts','src/mcp/server.ts',
  'dist/services/computer-use-service.js','dist/mcp/server.js',
  'deploy/browser-native-targeting-parity/compile-ax-on-mac.mjs',
  'deploy/browser-native-targeting-parity/README.md'
];
const tracked=sourcePaths.filter(x=>!x.startsWith('dist/'));
const changed=command(['diff','--name-only','HEAD','--',...tracked]);
if(changed)throw Error('OWNED_SOURCE_UNCOMMITTED');
const head=command(['rev-parse','HEAD']);
if(!/^[a-f0-9]{40}$/.test(head))throw Error('INVALID_SOURCE_SHA');
await fs.mkdir(output,{mode:0o700,recursive:false});
const files=[];
for(const file of sourcePaths){
  const bytes=await fs.readFile(path.join(root,file));
  if(!file.startsWith('dist/')){
    const committed=execFileSync('git',['-C',root,'show','HEAD:'+file]);
    if(!committed.equals(bytes))throw Error('SOURCE_COMMIT_MISMATCH');
  }
  const dest=path.join(output,file);
  await fs.mkdir(path.dirname(dest),{mode:0o700,recursive:true});
  await fs.writeFile(dest,bytes,{mode:0o600,flag:'wx'});
  files.push({path:file,bytes:bytes.length,sha256:sha(bytes)});
}
const rootCommit='2b10f9e';
const patches=[
  ['host-bridge.patch',['mac-host/bridge.mjs','mac-host/native.jxa']],
  ['controller-mcp.patch',['src/services/computer-use-service.ts','src/mcp/server.ts']]
];
for(const [name,paths] of patches){
  const bytes=execFileSync('git',['-C',root,'diff','--binary',rootCommit,head,'--',...paths]);
  const rel='patches/'+name;
  await fs.mkdir(path.join(output,'patches'),{mode:0o700,recursive:true});
  await fs.writeFile(path.join(output,rel),bytes,{mode:0o600,flag:'wx'});
  files.push({path:rel,bytes:bytes.length,sha256:sha(bytes)});
}
const manifest={
  schema:'cloud-sandbox.browser-native-targeting-parity.review-bundle.v1',
  source_commit:head,baseline_commit:rootCommit,
  host_installed_baseline_sha256:{
    'bridge.mjs':'14011d40f743a2fe7b42b956fdcdce1d739e46175de5b8702dd0cbf316e0cd25',
    'native.jxa':'142b92cfad781e15de862bcdf56f630f821ac67ce9d10adbfd78106617849ea8'
  },
  controller_installed_baseline_sha256:{
    'services/computer-use-service.js':'28d1fc65ef47443dd2be8603c736a45d387a170543dcde9a41862a92499f7bf4',
    'mcp/server.js':'18e882d8a6c8520ec5f2bedb8a0108d1180e89991569ca7f240eac0602dafed1'
  },
  mac_install_status:'NOT_INSTALLED',controller_install_status:'NOT_INSTALLED',
  swift_mac_compile_status:'NOT_TESTED_ON_MAC',
  raw_source_is_customization_reference_only:true,
  overwrite_customized_controller:false,requires_operator_source_rebase:true,
  files
};
const body=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(output,'manifest.json'),body,{mode:0o600,flag:'wx'});
await fs.writeFile(path.join(output,'manifest.sha256'),sha(body)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({stage:'VERIFIED_REVIEW_BUNDLE',source_commit:head,
  output,manifest_sha256:sha(body),files:files.length,mac_deployed:false},null,2));
