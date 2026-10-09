/** Mac LaunchAgent setup. Run after enabling COMPUTER_USE_ENABLED in .env.
 * The LaunchAgent reads .env at runtime; no credentials appear in its plist.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('LaunchAgent installation must run on the Mac host.');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(os.homedir(),'Library','LaunchAgents','com.lch.cloud-sandbox.computer-use.plist');
const log = path.join(os.homedir(),'Library','Logs','cloud-sandbox-computer-use.log');
await fs.mkdir(path.dirname(file),{recursive:true});
await fs.mkdir(path.dirname(log),{recursive:true});
const escapeXml = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const v = s => '<string>' + escapeXml(s) + '</string>';
const plist = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0"><dict>',
  '<key>Label</key>',v('com.lch.cloud-sandbox.computer-use'),
  '<key>ProgramArguments</key><array>',v(process.execPath),v(path.join(root,'mac-host','bridge.mjs')),'</array>',
  '<key>WorkingDirectory</key>',v(root),
  '<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>',
  '<key>StandardOutPath</key>',v(log),
  '<key>StandardErrorPath</key>',v(log),
  '</dict></plist>'
].join('\n');
await fs.writeFile(file,plist,{mode:0o600});
await fs.chmod(file,0o600);
const uid = process.getuid();
const launch = (...args) => spawnSync('/bin/launchctl',args,{encoding:'utf8'});
launch('bootout','gui/'+uid,file);
const result = launch('bootstrap','gui/'+uid,file);
if (result.status !== 0) {
  console.error('LaunchAgent bootstrap failed; check macOS login session and service logs.');
  process.exit(1);
}
console.log('Installed Cloud Sandbox native Computer Use LaunchAgent.');
console.log('Browser UI permissions (Automation, Accessibility, Screen Recording) remain controlled by macOS.');
