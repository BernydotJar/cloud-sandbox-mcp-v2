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
test('native checks exact tab title where multiple tabs share a URL',()=>{
  const browser={running:()=>true,windows:()=>[{activeTabIndex:()=>1,tabs:()=>[
    {title:()=> 'Licencias',url:()=> 'https://admin.cloud.microsoft/'},
    {title:()=> 'Dominios',url:()=> 'https://admin.cloud.microsoft/'}
  ]}]};
  const match=invoke(browser,['inspect','edge','1','1','https://admin.cloud.microsoft/','Licencias']);
  assert.equal(match.ok,true);
  const moved=invoke(browser,['inspect','edge','1','2','https://admin.cloud.microsoft/','Licencias']);
  assert.equal(moved.ok,true);
  assert.equal(moved.data.recovered_stale_index,true);
  assert.equal(moved.data.tab_index,1);
});


test('Edge recovers a unique exact tab after macOS window-order drift',()=>{
  const edge={running:()=>true,windows:()=>[
    {tabs:()=>[{url:()=> 'https://example.test/other',title:()=> 'Other'}]},
    {tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home?token=private',title:()=> 'iTime'}]}
  ]};
  const result=invoke(edge,['inspect','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime']);
  assert.equal(result.ok,true);
  assert.equal(result.data.window_index,2);
  assert.equal(result.data.tab_index,1);
  assert.equal(result.data.recovered_stale_index,true);
});

test('Edge can recover a unique tab moved within the SAME window',()=>{
  const edge={running:()=>true,windows:()=>[
    {tabs:()=>[
      {url:()=> 'https://other.test/',title:()=> 'Other'},
      {url:()=> 'https://staging.uipath.com/app?query=hidden',title:()=> 'FinancialForce Timecards'}
    ]}
  ]};
  const result=invoke(edge,['inspect','edge','1','1','https://staging.uipath.com/app','FinancialForce Timecards']);
  assert.equal(result.ok,true);
  assert.equal(result.data.window_index,1);
  assert.equal(result.data.tab_index,2);
});

test('duplicate exact title+URL after stale index fails closed, never guesses',()=>{
  const edge={running:()=>true,windows:()=>[
    {tabs:()=>[{url:()=> 'https://other.test/',title:()=> 'Other'}]},
    {tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}]},
    {tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}]}
  ]};
  const result=invoke(edge,['inspect','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime']);
  assert.equal(result.error,'AMBIGUOUS_NATIVE_TARGET');
});

test('stale legacy request without title never silently rebinds',()=>{
  const edge={running:()=>true,windows:()=>[
    {tabs:()=>[{url:()=> 'https://other.test/',title:()=> 'Other'}]},
    {tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}]}
  ]};
  const result=invoke(edge,['inspect','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','']);
  assert.equal(result.error,'STALE_URL');
});

test('no exact title+URL match never rebinds to same origin',()=>{
  const edge={running:()=>true,windows:()=>[
    {tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'Login expired'}]},
    {tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/settings',title:()=> 'iTime'}]}
  ]};
  const result=invoke(edge,['inspect','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime']);
  assert.equal(result.error,'STALE_TITLE');
});

test('same native engine safely resolves shifted tabs in Chrome and Edge',()=>{
 for(const name of ['Google Chrome','Microsoft Edge']){
   const urls=['https://other.test/','https://staging.uipath.com/uipathcoeattend/apps_/default/run/production/abc'];
   const browser={running:()=>true,windows:()=>[
     {tabs:()=>[{url:()=>urls[0],title:()=> 'Other'}]},
     {tabs:()=>[{url:()=>urls[1]+'?private=value',title:()=> 'FinancialForce Timecards'}]}
   ]};
   const context={Application(browserName){
     if(browserName===name)return browser;
     throw Error('Unexpected app '+browserName);
   }};
   vm.runInNewContext(code,context);
   const inputName=name==='Google Chrome'?'chrome':'edge';
   const result=JSON.parse(context.run(['inspect',inputName,'1','1',urls[1],'FinancialForce Timecards']));
   assert.equal(result.ok,true,name);
   assert.equal(result.data.recovered_stale_index,true,name);
   assert.equal(result.data.window_index,2,name);
 }
});

test('101-tab Edge window rebinds target after tab reorder without leaking URL query',()=>{
 const many=Array.from({length:100},(_,i)=>({
   url:()=> 'https://example.test/page/'+i+'?private=hidden',
   title:()=> 'Other '+i
 }));
 many.push({url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home?secret=abc',title:()=> 'iTime'});
 const edge={running:()=>true,windows:()=>[{tabs:()=>many}]};
 const result=invoke(edge,['inspect','edge','1','80','https://wf24.myhcl.com/iTime/ngiTime/home','iTime']);
 assert.equal(result.ok,true);
 assert.equal(result.data.tab_index,101);
 assert.equal(result.data.recovered_stale_index,true);
 assert.equal(JSON.stringify(result).includes('secret'),false);
});

test('action with duplicate exact browser tabs refuses event even when the hint matches',()=>{
 let pressed=0;
 const win={tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}],
   activeTabIndex:1,activeTab(){return this.tabs()[0];},
   set index(v){}};
 const context={Application(name){
   if(name==='Microsoft Edge')return {running:()=>true,windows:()=>[win,win],activate(){}};
   if(name==='System Events')return {processes:{'Microsoft Edge':{exists:()=>true}},
     keyCode(){pressed++;}};
   throw Error('Unexpected app');
 }};
 vm.runInNewContext(code,context);
 const result=JSON.parse(context.run([
   'action','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime',
   'press_key','tab'
 ]));
 assert.equal(result.error,'AMBIGUOUS_NATIVE_TARGET');
 assert.equal(pressed,0);
});

test('focus without AX never claims verified OS focus',()=>{
 const target={tabs:()=>[{url:()=> 'https://example.test/',title:()=> 'Example'}],bounds:()=>({x:0,y:0,width:800,height:600})};
 const result=invoke({running:()=>true,windows:()=>[target]},['focus','edge','1','1','https://example.test/','Example']);
 assert.equal(result.ok,true);assert.equal(result.data.focused,false);assert.equal(result.data.window_focus_verified,false);
 assert.equal(result.data.focused_control.available,false);
});
