import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('./native.jxa',import.meta.url),'utf8');
function paste(externalChange=false) {
 let count=1,stored='original',events=[];
 const list=a=>({count:a.length,objectAtIndex:i=>a[i]});
 const board={pasteboardItems:list([{types:list(['text']),dataForType:()=> 'original'}]),
 get clearContents(){count++;stored='';return count;},get changeCount(){return count;},
 setStringForType(s){count++;stored=s;return true;},
 writeObjects(a){stored=a.items[0].data;count++;return true;}};
 const dollar=x=>x;
 dollar.NSPasteboard={generalPasteboard:board};
 dollar.NSPasteboardTypeString='text';
 dollar.NSMutableArray={alloc:{get init(){return {items:[],addObject(x){this.items.push(x);}};}}};
 dollar.NSPasteboardItem={alloc:{get init(){return {setDataForType(d){this.data=d;}};}}};
 const ctx={ObjC:{import(){}},$:dollar,delay(){},Application(){throw Error('No GUI');}};
 vm.runInNewContext(code,ctx);
 ctx.pasteNativeText('First paragraph\n\nSecond paragraph',{keystroke(k,options){
   events.push({k,using:options.using,clipboard:stored});
   if(externalChange){stored='user clipboard';count++;}
 }});
 return {events,stored};
}
test('multiline input is one Command-V with no Return keystrokes',()=>{
 const {events,stored}=paste();
 assert.deepEqual(events,[{k:'v',using:'command down',clipboard:'First paragraph\n\nSecond paragraph'}]);
 assert.equal(stored,'original');
});
test('a concurrent user clipboard change is not overwritten',()=>{
 const {stored}=paste(true);assert.equal(stored,'user clipboard');
});
