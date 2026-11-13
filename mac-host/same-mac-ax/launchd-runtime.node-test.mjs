import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchAgentNodePath} from './launchd-runtime.mjs';
const old='/opt/homebrew/Cellar/node/26.5.0/bin/node',current='/opt/homebrew/Cellar/node/26.13.0/bin/node',stable='/opt/homebrew/opt/node/bin/node';
test('launchd records a stable Homebrew link rather than a removable Cellar version',()=>{
 const files=new Map([[current,current],[stable,current]]);
 const realpath=p=>{if(!files.has(p))throw Error('ENOENT');return files.get(p);};
 assert.equal(launchAgentNodePath({execPath:current,platform:'darwin',realpath}),stable);
 // An upgrade replaces the symlink target; the recorded launchd path still resolves.
 files.delete(current);files.set(stable,old);
 assert.equal(realpath(stable),old);
});
test('missing or mismatching links never select another runtime silently',()=>{
 const realpath=p=>{if(p===current)return current;if(p===stable)return old;throw Error('ENOENT');};
 assert.equal(launchAgentNodePath({execPath:current,platform:'darwin',realpath}),current);
 assert.throws(()=>launchAgentNodePath({execPath:old,platform:'darwin',realpath}),/ENOENT/);
});
test('non-Homebrew and Linux installations retain their exact runtime',()=>{
 for(const [execPath,platform] of [['/usr/bin/node','linux'],['/Applications/Node/bin/node','darwin']])
  assert.equal(launchAgentNodePath({execPath,platform,realpath:p=>p}),execPath);
});
