import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
if (!process.argv[2]) throw Error('RELEASE_DIRECTORY_REQUIRED');
const release=path.resolve(process.argv[2]);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await fs.readFile(path.join(release,'manifest.json'));
const declared=(await fs.readFile(path.join(release,'manifest.sha256'),'utf8')).trim();
if (sha(manifestBytes)!==declared) throw Error('RELEASE_MANIFEST_HASH_MISMATCH');
const manifest=JSON.parse(manifestBytes);
if (manifest.schema!=='browser-auto-release.v1' ||
    manifest.kind!=='existing-mac-browser-hardening-29-to-29' ||
    manifest.tools_before!==29 || manifest.tools_after!==29 || manifest.code_only!==true) {
  throw Error('INVALID_29_TOOL_RELEASE_MANIFEST');
}
const assetNames=['bridge.mjs','runtime.mjs','connection-pool.mjs','browser-runtime-tools.js'];
const pinnedPrior={
  'bridge.mjs':'257985f5b38ceefd9ba9fcc66487f50f658f92208cbc20b6d22850e701ff42ab',
  'runtime.mjs':'6894a626f34c056920a54d2ff8cfebdd0287dc30109e4c4ef16851e5ba4174ff',
  'connection-pool.mjs':'164a4d0812a63a46ac8e731896a801c51fd21a179563',
  'browser-runtime-tools.js':'e1e46388c95c7d240cb9125136f43180c07f432c663bd46a1fa39d77fc6f8c4b'
};
if (manifest.base_source_commit !== '2b23a01167630245b1d2bcdcdfe3faa3d7177f06') {
  throw Error('UNRECOGNIZED_29_TOOL_BASELINE');
}
if (JSON.stringify(Object.keys(manifest.assets).sort())!==JSON.stringify(assetNames.sort())) {
  throw Error('UNEXPECTED_RELEASE_ASSETS');
}
for (const name of assetNames) {
  const info=manifest.assets[name];
  const expected=(await fs.readFile(path.join(release,name)));
  if (sha(expected)!==info.sha256 || info.allowed_previous?.length!==1 ||
    info.allowed_previous[0] !== pinnedPrior[name]) {
    throw Error('RELEASE_ASSET_HASH_MISMATCH');
  }
  const stat=await fs.lstat(path.join(release,name));
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('UNSAFE_RELEASE_ASSET');
  const syntax=spawnSync(process.execPath,['--check',path.join(release,name)],{encoding:'utf8'});
  if (syntax.status!==0) throw Error('RELEASE_SYNTAX_INVALID');
}
const probe=await fs.readFile(path.join(release,'registry-probe.mjs'));
if (sha(probe)!==manifest.probe_sha256) throw Error('RELEASE_PROBE_HASH_MISMATCH');
if (sha(await fs.readFile(path.join(release,'install-on-mac.mjs'))) !== manifest.installer_sha256)
  throw Error('RELEASE_INSTALLER_HASH_MISMATCH');
if (sha(await fs.readFile(path.join(release,'README.md'))) !== manifest.readme_sha256)
  throw Error('RELEASE_README_HASH_MISMATCH');
const adapter=await fs.readFile(path.join(release,'browser-runtime-tools.js'),'utf8');
const bridge=await fs.readFile(path.join(release,'bridge.mjs'),'utf8');
const runtime=await fs.readFile(path.join(release,'runtime.mjs'),'utf8');
if (!adapter.includes('browser_open') || !bridge.includes('COMPUTER_USE_BROWSER_ACTION_ALLOWLIST_ONLY') ||
    !runtime.includes('MUTATION_ORIGIN_DENIED')) throw Error('REQUIRED_RUNTIME_CONTROL_MISSING');
for (const file of ['install-on-mac.mjs','registry-probe.mjs']) {
  const stat=await fs.lstat(path.join(release,file));
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('UNSAFE_RELEASE_FILE');
  if (spawnSync(process.execPath,['--check',path.join(release,file)]).status!==0)
    throw Error('RELEASE_SYNTAX_INVALID');
}
const linux=spawnSync(process.execPath,[path.join(release,'install-on-mac.mjs'),'--inspect'],{encoding:'utf8'});
if (process.platform==='linux' &&
    (linux.status!==2 || !linux.stdout.includes('RUN_IN_MAC_TERMINAL'))) {
  throw Error('MAC_ONLY_INSTALLER_GUARD_FAILED');
}
const current=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if (current!==manifest.source_commit) throw Error('SOURCE_COMMIT_MISMATCH');
process.stdout.write(JSON.stringify({
  result:'PASS',mode:'SOURCE_ONLY_NO_MAC_DEPLOYMENT',
  tools_before:29,tools_after:29,
  asset_count:assetNames.length,sha256:sha(manifestBytes),
  commit:manifest.source_commit,real_mac_rollback:'NOT_EXECUTED'
})+'\n');
