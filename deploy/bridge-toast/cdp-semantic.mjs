/* global process */
/**
 * CDP-native accessibility backed action driver, used only if an attached
 * Playwright locator cannot execute. Uses semantic AX nodes and DOM.focus +
 * keyboard events, NEVER screen coordinates, Runtime.evaluate or raw JS.
 * No cookies, tokens, external endpoints or hidden browser profiles accessed.
 */
import {RuntimeFault} from './contracts.mjs';

const fault=code=>{throw new RuntimeFault(code);};
const roles=new Set(['button','link','textbox','combobox','checkbox','radio','tab','menuitem','switch']);
const fillRoles=new Set(['textbox','combobox','searchbox']);
const numericCode={Enter:13,Tab:9,Escape:27,Space:32,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39};
const codes={Enter:'Enter',Tab:'Tab',Escape:'Escape',Space:'Space',ArrowUp:'ArrowUp',
  ArrowDown:'ArrowDown',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight'};
function asAttrs(entries=[]){
  const attrs={};
  for(let i=0;i+1<entries.length;i+=2)attrs[entries[i].toLowerCase()]=entries[i+1];
  return attrs;
}
function axName(node){return String(node?.name?.value||'');}
function axRole(node){return String(node?.role?.value||'').toLowerCase();}
function isIgnored(node){return node.ignored===true || !node.backendDOMNodeId;}
function disabled(node,attrs){
  if('disabled' in attrs || attrs['aria-disabled']==='true' ||
     attrs.hidden!==undefined || attrs['aria-hidden']==='true') return true;
  return (node?.properties||[]).some(p=>p.name==='disabled' && p.value?.value===true);
}

export async function cdpAccessibilitySnapshot(page) {
  const session=await page.context().newCDPSession(page);
  try{
    const {nodes}=await session.send('Accessibility.getFullAXTree');
    if(!Array.isArray(nodes)||nodes.length===0)fault('CDP_AX_UNAVAILABLE');
    const lines=[];
    const allowed=new Set(['button','link','textbox','combobox','checkbox','radio','tab',
      'menuitem','switch','heading','searchbox','listbox','option','statictext']);
    for(const node of nodes) {
      const role=axRole(node);
      if(isIgnored(node)||!allowed.has(role))continue;
      const name=axName(node).replace(/[\r\n]/g,' ').slice(0,180);
      if(!name) continue;
      const quoted=name.replaceAll('"',"'");
      // A field's accessible NAME is an identity/label, not its current value.
      // Keep it before the colon so scrubContent can mask any value without
      // erasing the verified semantic locator.
      if (['textbox','searchbox','spinbutton'].includes(role))
        lines.push('- '+role+' "'+quoted+'": [REDACTED_FIELD_VALUE]');
      else lines.push('- '+role+': "'+quoted+'"');
      if(lines.length>=320)break;
    }
    if(!lines.length)fault('CDP_AX_EMPTY');
    return lines.join('\n');
  }finally{await session.detach().catch(()=>{});}
}

function lookupAX(nodes,spec,action){
  const requested=spec.by==='role'?spec.role.toLowerCase():undefined;
  if(requested && !roles.has(requested))fault('CDP_UNSUPPORTED_ROLE');
  const candidates=nodes.filter(node=>{
    if(isIgnored(node) || axName(node)!==spec.name)return false;
    const role=axRole(node);
    return spec.by==='role'?role===requested:
      // A label locator refers to the labeled control, not to the LabelText node.
      (action==='fill'?fillRoles.has(role):
        ['textbox','combobox','checkbox','radio','switch','button'].includes(role));
  });
  if(candidates.length!==1)fault(candidates.length?'CDP_AX_AMBIGUOUS':'CDP_AX_NOT_FOUND');
  return candidates[0];
}
async function lookupTestId(session,id){
  if(typeof id!=='string' || id.length>200 || [...id].some(c=>c.charCodeAt(0)<32))fault('CDP_INVALID_TEST_ID');
  const {root}=await session.send('DOM.getDocument',{depth:0,pierce:false});
  // CSS identifier escaping is unnecessary for a quoted attribute value.
  const selector='[data-testid="'+id.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"]';
  const {nodeIds}=await session.send('DOM.querySelectorAll',{nodeId:root.nodeId,selector});
  if(nodeIds.length!==1)fault(nodeIds.length?'CDP_TEST_ID_AMBIGUOUS':'CDP_TEST_ID_NOT_FOUND');
  const {node}=await session.send('DOM.describeNode',{nodeId:nodeIds[0]});
  return {backendDOMNodeId:node.backendNodeId,role:{value:'generic'},name:{value:id},
    description:node};
}
async function key(session,keyboard,{selectAll=false}={}){
  if(selectAll){
    const modifiers=process.platform==='darwin'?4:2; // Meta on macOS, Ctrl on Linux.
    const base={key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65,
      modifiers,location:0};
    await session.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...base});
    await session.send('Input.dispatchKeyEvent',{type:'keyUp',...base});
    return;
  }
  const keyName=keyboard==='Space'?' ':keyboard;
  const payload={key:keyName,code:codes[keyboard],
    windowsVirtualKeyCode:numericCode[keyboard],nativeVirtualKeyCode:numericCode[keyboard]};
  await session.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...payload});
  if(keyboard==='Enter'||keyboard==='Space'){
    const ch=keyboard==='Enter'?'\r':' ';
    await session.send('Input.dispatchKeyEvent',{type:'char',...payload,text:ch,unmodifiedText:ch});
  }
  await session.send('Input.dispatchKeyEvent',{type:'keyUp',...payload});
}

export async function prepareCdpSemanticAction(page,spec,action){
  if(!['role','label','test_id'].includes(spec.by) ||
     !['click','fill','press'].includes(action))fault('CDP_UNSUPPORTED_ACTION');
  const session=await page.context().newCDPSession(page);
  try{
    let target;
    if(spec.by==='test_id')target=await lookupTestId(session,spec.name);
    else{
      const {nodes}=await session.send('Accessibility.getFullAXTree');
      if(!Array.isArray(nodes))fault('CDP_AX_UNAVAILABLE');
      target=lookupAX(nodes,spec,action);
    }
    const id=target.backendDOMNodeId;
    if(!Number.isInteger(id) || id<1)fault('CDP_INVALID_TARGET');
    const {node}=target.description?{node:target.description}:
      await session.send('DOM.describeNode',{backendNodeId:id});
    const attrs=asAttrs(node.attributes);
    const tag=node.nodeName.toLowerCase();
    if(disabled(target,attrs))fault('CDP_TARGET_UNAVAILABLE');
    if(attrs.type==='password'||attrs.type==='file'||
      /^(?:cc-|one-time-code)/i.test(attrs.autocomplete||''))fault('PROTECTED_INPUT');
    if(action==='fill' && !(tag==='input'||tag==='textarea'||
      attrs.contenteditable==='true'||attrs.role==='textbox'))
      fault('CDP_TARGET_NOT_EDITABLE');
    if(action==='click' && !(spec.by==='role'||attrs.role||['button','a','input'].includes(tag)))
      fault('CDP_TARGET_NOT_INTERACTIVE');
    return {
      mode:'cdp_ax',
      async dispatch({value,key:inputKey}){
        await session.send('DOM.focus',{backendNodeId:id});
        if(action==='fill'){
          if(typeof value!=='string')fault('CDP_INVALID_VALUE');
          await key(session,null,{selectAll:true});
          await session.send('Input.insertText',{text:value});
        }else if(action==='click'){
          // Keyboard activation of semantic controls, not coordinate events.
          await key(session,['checkbox','radio','switch'].includes(axRole(target))?'Space':'Enter');
        }else{
          if(!numericCode[inputKey])fault('CDP_UNSUPPORTED_KEY');
          await key(session,inputKey);
        }
      },
      async close(){await session.detach().catch(()=>{});}
    };
  }catch(e){await session.detach().catch(()=>{});throw e;}
}
