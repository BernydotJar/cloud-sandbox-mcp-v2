import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(process.env.NATIVE_DRIVER_PATH??new URL('./native.jxa',import.meta.url),'utf8');
function invoke({allowed=true,x=300,y=120,operation='action'}={}) {
 const posted=[],created=[];
 const tab={title:()=> 'Teams',url:()=> 'https://teams.example.test/'};
 const win={tabs:()=>[tab],activeTab:()=>tab,bounds:()=>({x:100,y:80,width:800,height:600})};
 const proc={exists:()=>true,frontmost:()=>true,click(){throw Error('AX click must never be the mouse backend');},
   attributes:{byName:key=>({value:()=>{if(key==='AXFocusedWindow')return {name:()=> 'Teams - Microsoft Edge',position:()=>[100,80],size:()=>[800,600]};throw Error('No focused element fixture');}})}};
 const dollar={CGPreflightPostEventAccess:()=>allowed,kCGEventLeftMouseDown:1,kCGEventLeftMouseUp:2,kCGMouseButtonLeft:0,kCGHIDEventTap:0,
 CGEventCreateMouseEvent(source,type,point,button){const e={type,x:point.x,y:point.y,button};created.push(e);return e;},
 CGEventPost(tap,e){posted.push({...e,tap});}};
 const context={ObjC:{import(){}},$:dollar,delay(){},
 Application(n){if(n==='Microsoft Edge')return {running:()=>true,windows:()=>[win],activate(){}};if(n==='System Events')return {processes:{'Microsoft Edge':proc}};throw Error('Unexpected app');}};
 vm.runInNewContext(code,context);
 const args=[operation,'edge','1','1','https://teams.example.test/','Teams', 'click',String(x),String(y)];
 return {result:JSON.parse(context.run(args)),posted,created};
}
test('mouse click dispatches one Quartz down/up pair at global points',()=>{
 const {result,posted}=invoke();
 assert.equal(result.ok,true);assert.equal(result.data.input_backend,'quartz_mouse_event');
 assert.deepEqual(posted,[{type:1,x:300,y:120,button:0,tap:0},{type:2,x:300,y:120,button:0,tap:0}]);
});
test('missing post-event permission fails closed without AX fallback',()=>{
 const {result,posted}=invoke({allowed:false});
 assert.equal(result.error,'MAC_POST_EVENT_PERMISSION_REQUIRED');assert.equal(posted.length,0);
});
test('out-of-window click is refused before creating events',()=>{
 for(const [x,y] of [[99,120],[900,120],[300,79],[300,680]]) {
 const {result,created}=invoke({x,y});
 assert.equal(result.error,'CLICK_OUTSIDE_TARGET_WINDOW');assert.equal(created.length,0);
 }
});
test('focus reports existing event permission without dispatching events',()=>{
 const {result,posted}=invoke({operation:'focus'});
 assert.equal(result.data.mouse_event_access,true);assert.equal(posted.length,0);
});
