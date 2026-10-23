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

test('a unique moved tab is focused and key-event is sent only after frontmost validation',()=>{
  const windows=[];
  let pressCount=0;
  const other={tabs:()=>[{url:()=> 'https://unrelated.test/',title:()=> 'Other'}]};
  const target={
    activeTabIndex:1,
    tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}],
    activeTab(){return this.tabs()[this.activeTabIndex-1];},
    set index(value) {
      if (value===1) {
        const pos=windows.indexOf(this);
        if(pos!==-1){windows.splice(pos,1);windows.unshift(this);}
      }
    }
  };
  windows.push(other,target);
  const context={Application(name){
    if(name==='Microsoft Edge')return {running:()=>true,windows:()=>windows,activate(){}};
    if(name==='System Events')return {
      processes:{'Microsoft Edge':{exists:()=>true}},
      keyCode(){pressCount++;}
    };
    throw Error('Unexpected app '+name);
  }};
  vm.runInNewContext(code,context);
  const result=JSON.parse(context.run([
    'action','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime',
    'press_key','tab'
  ]));
  assert.equal(result.ok,true);
  assert.equal(result.data.performed,true);
  assert.equal(pressCount,1);
  assert.equal(windows[0],target);
});

test('native action aborts if focus moves to another browser window before key dispatch',()=>{
  const current={tabs:()=>[{url:()=> 'https://unrelated.test/',title:()=> 'Other'}],
    activeTab(){return this.tabs()[0];}};
  const target={tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}],
    activeTab(){return this.tabs()[0];},
    set activeTabIndex(x){},
    set index(x){ /* Simulates OS refusing to foreground the requested window. */ }
  };
  let pressCount=0;
  const context={Application(name){
    if(name==='Microsoft Edge')return {
      running:()=>true,windows:()=>[current,target],activate(){}
    };
    if(name==='System Events')return {processes:{'Microsoft Edge':{exists:()=>true}},
      keyCode(){pressCount++;}};
    throw Error('Unexpected app '+name);
  }};
  vm.runInNewContext(code,context);
  const result=JSON.parse(context.run([
    'action','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime',
    'press_key','tab'
  ]));
  assert.equal(result.error,'TARGET_CHANGED');
  assert.equal(pressCount,0);
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

test('screenshot bounds fail closed if a different window is frontmost after focus',()=>{
 let screenshots=0;
 const front={tabs:()=>[{url:()=> 'https://private.test/',title:()=> 'Private'}],
   activeTab(){return this.tabs()[0];}};
 const target={tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}],
   activeTabIndex:1,activeTab(){return this.tabs()[0];},
   set index(v){}};
 const context={Application(name){
   if(name==='Microsoft Edge')return {running:()=>true,windows:()=>[front,target],activate(){}};
   if(name==='System Events')return {processes:{'Microsoft Edge':{
      exists:()=>true,windows:[{position(){screenshots++;return [0,0]},size(){return [800,600]}}]
   }}};
   throw Error('Unexpected app');
 }};
 vm.runInNewContext(code,context);
 const result=JSON.parse(context.run([
   'bounds','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime'
 ]));
 assert.equal(result.error,'TARGET_CHANGED');
 assert.equal(screenshots,0);
});


test('screenshot of already-focused Edge does not reactivate window or close a transient dropdown',()=>{
 let activated=0,raised=0,changedTab=0;
 const tab={url:()=> 'https://staging.uipath.com/apps/time',title:()=> 'FinancialForce Timecards'};
 const window={
   tabs:()=>[tab],activeTab(){return tab;},
   set activeTabIndex(value){changedTab++;},
   set index(value){raised++;}
 };
 const context={Application(name){
   if(name==='Microsoft Edge')return {
     running:()=>true,windows:()=>[window],activate(){activated++;}
   };
   if(name==='System Events')return {processes:{'Microsoft Edge':{
      exists:()=>true,frontmost:()=>true,
      windows:[{position:()=>[25,35],size:()=>[1250,900]}]
   }}};
   throw Error('Unexpected app '+name);
 }};
 vm.runInNewContext(code,context);
 const result=JSON.parse(context.run([
   'bounds','edge','1','1','https://staging.uipath.com/apps/time','FinancialForce Timecards'
 ]));
 assert.equal(result.ok,true);
 assert.equal(result.data.x,25);
 assert.equal(result.data.y,35);
 assert.equal(activated,0);
 assert.equal(raised,0);
 assert.equal(changedTab,0);
});

test('screenshot of inactive browser foregrounds only the exact selected window',()=>{
 let activated=0,raised=0;
 const tab={url:()=> 'https://staging.uipath.com/apps/time',title:()=> 'FinancialForce Timecards'};
 const window={
   tabs:()=>[tab],activeTab(){return tab;},
   set activeTabIndex(value){},
   set index(value){raised++;}
 };
 const context={Application(name){
   if(name==='Microsoft Edge')return {
     running:()=>true,windows:()=>[window],activate(){activated++;}
   };
   if(name==='System Events')return {processes:{'Microsoft Edge':{
      exists:()=>true,frontmost:()=>false,
      windows:[{position:()=>[0,0],size:()=>[1250,900]}]
   }}};
   throw Error('Unexpected app '+name);
 }};
 vm.runInNewContext(code,context);
 const result=JSON.parse(context.run([
   'bounds','edge','1','1','https://staging.uipath.com/apps/time','FinancialForce Timecards'
 ]));
 assert.equal(result.ok,true);
 assert.equal(activated,1);
 assert.equal(raised,1);
});


test('focus operation keeps browser-only macOS Automation behavior without Accessibility',()=>{
 let activated=0;
 const target={
   tabs:()=>[{url:()=> 'https://wf24.myhcl.com/iTime/ngiTime/home',title:()=> 'iTime'}],
   set activeTabIndex(x){}, set index(x){}
 };
 const context={Application(name){
   if(name==='Microsoft Edge')return {running:()=>true,windows:()=>[target],activate(){activated++;}};
   throw Error('System Events must not be required for plain browser focus');
 }};
 vm.runInNewContext(code,context);
 const result=JSON.parse(context.run([
   'focus','edge','1','1','https://wf24.myhcl.com/iTime/ngiTime/home','iTime'
 ]));
 assert.equal(result.ok,true);
 assert.equal(result.data.focused,true);
 assert.equal(activated,1);
});
