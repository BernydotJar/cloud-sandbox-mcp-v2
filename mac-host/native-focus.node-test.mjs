import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(process.env.NATIVE_DRIVER_PATH ?? new URL('./native.jxa',import.meta.url),'utf8');
function observe({role='AXTextArea',name='Type a message',value='Draft',subrole='',unavailable=false}={}) {
 let reads=0,activations=0;
 const tab={title:()=> 'Teams',url:()=> 'https://teams.example.test/'};
 const win={tabs:()=>[tab],activeTab:()=>tab,bounds:()=>({x:10,y:20,width:800,height:600})};
 const el={role:()=>role,name:()=>name,value(){reads++;return value;},
   position:()=>[100,200],size:()=>[300,60],
   attributes:{byName:key=>({value:()=>key==='AXSubrole'?subrole:''})}};
 const proc={frontmost:()=>true,attributes:{byName:()=>({value:()=>{if(unavailable)throw Error('no AX');return el;}})}};
 const ctx={Application(n){if(n==='Microsoft Edge')return {running:()=>true,windows:()=>[win],activate(){activations++;}};if(n==='System Events')return {processes:{'Microsoft Edge':proc}};throw Error('Unexpected app');}};
 vm.runInNewContext(code,ctx);
 const result=JSON.parse(ctx.run(['focus','edge','1','1','https://teams.example.test/','Teams']));
 return {result,reads,activations};
}
test('focus observes actual text control and preserves its focus',()=>{
 const {result,activations}=observe();
 assert.equal(result.data.focused_control.role,'AXTextArea');
 assert.equal(result.data.focused_control.value,'Draft');
 assert.equal(result.data.focused_control.is_text_input,true);
 assert.equal(activations,0);
 assert.equal(result.data.window_bounds_points.x,10);
});
test('secure input never exposes its value',()=>{
 const {result,reads}=observe({name:'Password',subrole:'AXSecureTextField'});
 assert.equal(result.data.focused_control.protected,true);
 assert.equal(result.data.focused_control.value,undefined);assert.equal(reads,0);
});
test('buttons are identified without reading their value',()=>{
 const {result,reads}=observe({role:'AXButton',name:'New message'});
 assert.equal(result.data.focused_control.is_text_input,false);
 assert.equal(result.data.focused_control.name,'New message');assert.equal(reads,0);
});
test('unavailable AX stays explicit instead of fabricating control identity',()=>{
 const {result}=observe({unavailable:true});
 assert.equal(result.ok,true);assert.equal(result.data.focused_control.available,false);
});
