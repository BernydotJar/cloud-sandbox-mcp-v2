import fs from 'node:fs';
import process from 'node:process';
// launchd must not retain a versioned Homebrew Cellar path that cleanup deletes.
// This selects an existing symlink to the SAME executable; it never grants TCC,
// upgrades Node, or accepts a caller-supplied executable path.
export function launchAgentNodePath({execPath=process.execPath,platform=process.platform,
  realpath=fs.realpathSync}={}) {
 const resolved=realpath(execPath);
 if(platform!=='darwin')return execPath;
 const match=resolved.match(/^(\/opt\/homebrew|\/usr\/local)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/);
 if(!match)return execPath;
 for(const candidate of [match[1]+'/opt/'+match[2]+'/bin/node',match[1]+'/bin/node']) {
  try{if(realpath(candidate)===resolved)return candidate;}catch{/* Never invent a runtime. */}
 }
 return execPath;
}
