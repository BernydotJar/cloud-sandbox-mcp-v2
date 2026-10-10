import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('./native.jxa',import.meta.url),'utf8');
function invoke(behavior,args=['state','edge']) {
  const context={Application(name){
    if(name==='Microsoft Edge') return behavior;
    throw Error('Unexpected automation target');
  }};
  vm.runInNewContext(code,context);
  return JSON.parse(context.run(args));
}
test('native Edge discovery tolerates one stale tab without losing the window',()=>{
  const result=invoke({
    running:()=>true,
    windows:()=>[{activeTabIndex:()=>1,tabs:()=>[
      {title:()=> 'Admin', url:()=> 'https://admin.microsoft.com/users?secret=omitted'},
      {title:()=> 'Loading',url:()=> {throw Error('Stale tab reference');}}
    ]}]
  });
  assert.equal(result.ok,true);
  assert.equal(result.data.windows.length,1);
  assert.deepEqual(result.data.windows[0].tabs.map(t=>t.tab_index),[1,2]);
  assert.equal(result.data.windows[0].tabs[0].url,'https://admin.microsoft.com/users');
  assert.equal(result.data.windows[0].tabs[1].url,'');
});
test('native Edge discovery produces a distinct macOS Automation permission denial',()=>{
  const result=invoke({running:()=>true,windows:()=>{
    const e=Error('Authorization denied');e.number=-1743;throw e;
  }});
  assert.equal(result.ok,false);
  assert.equal(result.error,'MAC_AUTOMATION_PERMISSION_DENIED');
});
