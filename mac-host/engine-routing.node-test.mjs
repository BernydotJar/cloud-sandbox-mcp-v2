import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const policy=fs.readFileSync(path.join(root,'docs/computer-use-v2/ENGINE_ROUTING.md'),'utf8');
const instructions=fs.readFileSync(path.join(root,'AGENTS.md'),'utf8');
const pool=fs.readFileSync(path.join(root,'mac-host/browser-runtime/connection-pool.mjs'),'utf8');

test('the shared contract separates Playwright QA and CDP adapter failure',()=>{
  for(const item of [
    'isolated Playwright QA','Browser MCP','chromium.connectOverCDP',
    'provider=persistent','provider=native','semantic_available=false',
    'BLOCKED_SEMANTIC_BROWSER','BLOCKED_NATIVE_DESKTOP','GH04/GH05'
  ])assert(policy.includes(item),'missing routing contract item '+item);
  assert(instructions.includes('docs/computer-use-v2/ENGINE_ROUTING.md'));
  assert(pool.includes("await import('playwright-core')"));
  assert(pool.includes('chromium.connectOverCDP(endpoint'));
});
test('the agent contract requires cell persistence rather than CDP alone',()=>{
  for(const item of ['row/column','persisted value','source skill',
    'UI adapter','LAST resort','not production GO'])
    assert(policy.toLowerCase().includes(item.toLowerCase()),'missing gate '+item);
});
test('native fallback is not falsely advertised as general Mac AX',()=>{
  for(const nativeTool of [
    'mac_list_apps','mac_accessibility_tree','mac_focus_window','mac_open_app'
  ])assert(policy.includes(nativeTool));
  assert(instructions.includes('NOT general Finder/Terminal/VS Code'));
});
