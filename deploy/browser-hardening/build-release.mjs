import process from 'node:process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Source-only, code-only, 29->29 promotion candidate.
 * Explicit NEW directory required. Never replace the browser-auto first-install bundle.
 */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', repo, ...args], {encoding:'utf8'}).trim();
if (git(['status','--porcelain'])) throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
if (!process.argv[2]) throw Error('EXPLICIT_NEW_DESTINATION_REQUIRED');
const destination = path.resolve(process.argv[2]);
const existingRelease = '/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-auto';
if (destination === existingRelease || destination.startsWith(existingRelease + path.sep) ||
    destination === repo || destination.startsWith(repo + path.sep)) {
  throw Error('RELEASE_DESTINATION_DENIED');
}
const allowedPrevious = Object.freeze({
  'bridge.mjs':'257985f5b38ceefd9ba9fcc66487f50f658f92208cbc20b6d22850e701ff42ab',
  'runtime.mjs':'6894a626f34c056920a54d2ff8cfebdd0287dc30109e4c4ef16851e5ba4174ff',
  'connection-pool.mjs':'164a4d0812a63a46ac8e731896a801c51fd21a179563',
  'browser-runtime-tools.js':'e1e46388c95c7d240cb9125136f43180c07f432c663bd46a1fa39d77fc6f8c4b'
});
const inputs = Object.freeze({
  'bridge.mjs':'mac-host/bridge.mjs',
  'runtime.mjs':'mac-host/browser-runtime/runtime.mjs',
  'connection-pool.mjs':'mac-host/browser-runtime/connection-pool.mjs',
  'browser-runtime-tools.js':'dist/mcp/browser-runtime-tools.js'
});
const data = {};
for (const [name,relative] of Object.entries(inputs)) {
  const bytes=await fs.readFile(path.join(repo,relative));
  data[name]={bytes,sha256:sha(bytes),allowed_previous:[allowedPrevious[name]]};
  if (sha(bytes) === allowedPrevious[name]) throw Error('UNCHANGED_SOURCE_NO_HARDENING');
}
const probe=await fs.readFile(path.join(repo,'deploy/browser-auto/registry-probe.mjs'));
const installer=await fs.readFile(path.join(repo,'deploy/browser-auto/install-on-mac.mjs'));
const readme=await fs.readFile(path.join(repo,'deploy/browser-hardening/README.md'));
const sourceCommit=git(['rev-parse','HEAD']);
await fs.mkdir(destination,{recursive:false,mode:0o700});
const add=async(name,bytes)=>fs.writeFile(path.join(destination,name),bytes,{flag:'wx',mode:0o600});
for (const [name,record] of Object.entries(data)) await add(name,record.bytes);
await add('registry-probe.mjs',probe);
await add('install-on-mac.mjs',installer);
await add('README.md',readme);
const manifest={
  schema:'browser-auto-release.v1',
  kind:'existing-mac-browser-hardening-29-to-29',
  source_commit:sourceCommit,
  base_source_commit:'2b23a01167630245b1d2bcdcdfe3faa3d7177f06',
  tools_before:29, tools_after:29, code_only:true,
  assets:Object.fromEntries(Object.entries(data).map(([name,r])=>[
    name,{sha256:r.sha256,allowed_previous:r.allowed_previous}
  ])),
  probe_sha256:sha(probe),
  installer_sha256:sha(installer),
  readme_sha256:sha(readme),
  note:'Host Mac upgrade requires separately authorized maintenance and hash-verified live baseline. SHA-256 is not a publisher signature.'
};
const m=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await add('manifest.json',m);
await add('manifest.sha256',Buffer.from(sha(m)+'\n'));
process.stdout.write(JSON.stringify({
  status:'SOURCE_ONLY_29_TO_29_RELEASE_BUILT',
  path:destination, source_commit:sourceCommit,
  files:Object.keys(data).length,
  expected_tools:29, manifest_sha256:sha(m),
  mac_host_changed:false
})+'\n');
