import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('./native.jxa',import.meta.url),'utf8');
function fixture({focused=true,raises=true,menuWorks=false,duplicateMenu=false,wrongTitle=false,wrongBounds=false,browserDrift=false}={}) {
 let active=focused,raised=0,menus=0,keys=0,reads=0,activations=0,tabChanges=0;
 const title='Example',rect={x:20,y:30,width:800,height:600};
 const tab={title:()=>title,url:()=> 'https://example.test/'};
 const target={tabs:()=>[tab],activeTab:()=>tab,bounds:()=>rect,set activeTabIndex(v){tabChanges++;}};
 const other={tabs:()=>[{title:()=> 'Other',url:()=> 'https://other.test/'}],activeTab(){return this.tabs()[0];}};
 const ax={name:()=>wrongTitle?'Other - Microsoft Edge':'Example - High memory usage - 2 GB - Microsoft Edge',
 position:()=>[wrongBounds?50:20,30],size:()=>[800,600],
 actions:{byName:()=>({perform(){raised++;if(raises)active=true;}})}};
 const item={name:()=>title,actions:{byName:()=>({perform(){if(menuWorks)active=true;}})}};
 const menu={actions:{byName:()=>({perform(){menus++;}})},menus:[{menuItems:()=>duplicateMenu?[item,item]:[item],actions:{byName:()=>({perform(){}})}}]};
 const proc={exists:()=>true,frontmost:()=>true,windows:()=>[ax],menuBars:[{menuBarItems:{byName:()=>menu}}],
 attributes:{byName:k=>({value(){if(k==='AXFocusedWindow')return active?ax:{name:()=> 'Other',position:()=>[20,30],size:()=>[800,600]};reads++;throw Error('No input fixture');}})}};
 const app={running:()=>true,windows:()=>browserDrift?[other,target]:[target],activate(){activations++;}};
 const context={delay(){},Application(n){if(n==='Microsoft Edge')return app;if(n==='System Events')return {processes:{'Microsoft Edge':proc},keyCode(){keys++;}};throw Error('Unexpected app');}};
 vm.runInNewContext(code,context);
 function run(op='action'){return JSON.parse(context.run([op,'edge','1','1','https://example.test/',title,'press_key','tab']));}
 return {run,context,proc,rect,counts:()=>({raised,menus,keys,reads,activations,tabChanges})};
}
test('already verified AX window preserves control and transient UI',()=>{
 const f=fixture();assert.equal(f.run('bounds').ok,true);assert.deepEqual(f.counts(),{raised:0,menus:0,keys:0,reads:0,activations:0,tabChanges:0});
});
test('AXRaise focuses the exact window before one key event',()=>{
 const f=fixture({focused:false});assert.equal(f.run().ok,true);assert.equal(f.counts().raised,1);assert.equal(f.counts().keys,1);
});
test('matching browser order cannot authorize input into the wrong AX window',()=>{
 const f=fixture({focused:false,raises:false});assert.equal(f.run().error,'TARGET_AX_WINDOW_NOT_FOCUSED');assert.equal(f.counts().keys,0);
});
test('same geometry but different actual window title fails closed',()=>{
 const f=fixture({wrongTitle:true});assert.equal(f.run().error,'TARGET_AX_WINDOW_NOT_FOCUSED');assert.equal(f.counts().keys,0);
});
test('same title but different window geometry fails closed',()=>{
 const f=fixture({wrongBounds:true});assert.equal(f.run().error,'TARGET_AX_WINDOW_NOT_FOCUSED');assert.equal(f.counts().keys,0);
});
test('focus mismatch never reads the unrelated focused field value',()=>{
 const f=fixture({wrongTitle:true});const r=f.run('focus');assert.equal(r.data.focused,false);assert.equal(r.data.focused_control.available,false);assert.equal(f.counts().reads,0);
});
test('unique exact Window menu fallback is independently checked',()=>{
 const f=fixture({focused:false,raises:false,menuWorks:true});assert.equal(f.run().ok,true);assert.equal(f.counts().menus,1);assert.equal(f.counts().keys,1);
});
test('duplicate Window menu title is never selected',()=>{
 const f=fixture({focused:false,raises:false,menuWorks:true,duplicateMenu:true});assert.equal(f.run().error,'TARGET_AX_WINDOW_NOT_FOCUSED');assert.equal(f.counts().keys,0);
});
test('AX success does not bypass changed browser front-tab identity',()=>{
 const f=fixture({browserDrift:true});assert.equal(f.run().error,'TARGET_CHANGED');assert.equal(f.counts().keys,0);
});
test('a screenshot refuses a different OS focused window',()=>{
 const f=fixture({focused:false,raises:false});assert.equal(f.run('bounds').error,'TARGET_AX_WINDOW_NOT_FOCUSED');
});
