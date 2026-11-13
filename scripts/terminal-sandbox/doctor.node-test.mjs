import {test} from 'node:test';
import process from 'node:process';
/* global URL */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const doctor=fileURLToPath(new URL('./doctor.mjs',import.meta.url));
const scenario=(body,{symlink=false}={})=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lch-terminal-doctor-'));
  const target=path.join(dir,'sandbox-real');
  const stub=path.join(dir,'sandbox');
  fs.writeFileSync(target,body,{mode:0o700});
  if(symlink)fs.symlinkSync(target,stub);
  else fs.copyFileSync(target,stub);
  try{
    return execFileSync(process.execPath,[doctor],{
      encoding:'utf8',
      env:{...process.env,SANDBOX_CLI_PATH:stub},
      timeout:10000
    });
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
};
test('terminal doctor detects a sandbox wrapper without executing it or leaking embedded credentials',()=>{
  const output=scenario([
    '#!/bin/zsh',
    'export OPENAI_API_KEY="sk-secret-do-not-share"',
    'export COMPUTER_USE_BRIDGE_TOKEN="very-secret-value"',
    'exec node /app/mcp-client.mjs -c',
    '# cloud-sandbox-mcp COMPUTER_USE_BROWSER_V2 AGENTS.md'
  ].join('\n'));
  assert.match(output,/SANDBOX_CLI=FOUND/);
  assert.match(output,/ENTRY_TYPE=SCRIPT_WITH_SHEBANG/);
  assert.match(output,/INTERPRETER=zsh/);
  assert.match(output,/CLOUD_SANDBOX_REFERENCE=YES/);
  assert.match(output,/AGENT_INSTRUCTIONS_REFERENCE=YES/);
  assert.match(output,/MCP_REFERENCE=YES/);
  assert.match(output,/FLAG_C_REFERENCE=YES/);
  assert.doesNotMatch(output,/sk-secret|very-secret-value/);
  assert.match(output,/VERDICT=.*integration unverified/);
});
test('terminal doctor resolves symlink without following a startup command',()=>{
  const output=scenario('#!/bin/bash\nexec echo not-executed\n',{symlink:true});
  assert.match(output,/SYMLINK=YES/);
  assert.match(output,/CLOUD_SANDBOX_REFERENCE=NO/);
  assert.doesNotMatch(output,/^not-executed$/m);
});
test('terminal doctor never treats unrelated script as proven Bridge integration',()=>{
  const output=scenario('#!/bin/bash\necho running some other app\n');
  assert.match(output,/MCP_REFERENCE=NO/);
  assert.match(output,/MAC_BRIDGE_REFERENCE=NO/);
  assert.match(output,/FOUND_CLI_REFERENCE_TO_BRIDGE=NO/);
});
