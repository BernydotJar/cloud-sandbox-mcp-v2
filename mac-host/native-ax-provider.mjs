import crypto from 'node:crypto';
import {sameWindowBounds,SCREENSHOT_TTL_MS} from './native-targeting.mjs';

const MAX_AX_NODES=450;
const hash=/^[a-f0-9]{64}$/;
const allowedRoles=new Set(['AXButton','AXLink','AXCheckBox','AXRadioButton',
  'AXPopUpButton','AXMenuItem','AXTextField','AXTextArea','AXComboBox']);
const pointBounds=r=>r && [r.x,r.y,r.width,r.height].every(Number.isFinite) &&
  r.width>=0 && r.height>=0;
function intersects(a,b) {
  return pointBounds(a)&&pointBounds(b) &&
    a.x < b.x+b.width && b.x<a.x+a.width &&
    a.y < b.y+b.height && b.y<a.y+a.height;
}
// Explicitly bounded, nonsecret value readback for verified form fields.
// No AXValue strings, tokens, arbitrary free text, or opaque raw attributes.
export function validatedAxValueObservation(value,role) {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).some(k=>!['kind','value','has_value'].includes(k)))
    throw new Error('AX_INVALID_VALUE_OBSERVATION');
  switch(value.kind){
    case 'boolean':
      if(!['AXCheckBox','AXRadioButton'].includes(role)||
         typeof value.value!=='boolean'||value.has_value!==undefined)
        throw new Error('AX_INVALID_VALUE_OBSERVATION');
      return {kind:'boolean',value:value.value};
    case 'hours_numeric':
      if(!['AXTextField','AXTextArea','AXComboBox'].includes(role)||
         typeof value.value!=='string'||
         !/^[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(value.value)||
         Number(value.value)>168||value.has_value!==true)
        throw new Error('AX_INVALID_VALUE_OBSERVATION');
      return {kind:'hours_numeric',value:value.value,has_value:true};
    case 'empty':
      if(value.value!==undefined||value.has_value!==false)
        throw new Error('AX_INVALID_VALUE_OBSERVATION');
      return {kind:'empty',has_value:false};
    case 'redacted':
      if(value.value!==undefined||value.has_value!==true)
        throw new Error('AX_INVALID_VALUE_OBSERVATION');
      return {kind:'redacted',has_value:true};
    default:throw new Error('AX_INVALID_VALUE_OBSERVATION');
  }
}
export class AxNodeReferences {
  #refs=new Map();
  #time;
  constructor(now=()=>Date.now()){this.#time=now;}
  snapshot(raw,target,bounds) {
    if(!raw || raw.provider!=='native_ax' || !hash.test(raw.revision) ||
       !Array.isArray(raw.nodes)||raw.nodes.length>MAX_AX_NODES ||
       !sameWindowBounds(bounds,bounds))
      throw new Error('AX_INVALID_SNAPSHOT');
    this.#refs.clear(); // A new browser AX tree revision invalidates old refs.
    const now=this.#time();
    const seen=new Set(),nodes=[];
    for(const node of raw.nodes) {
      if(!node || !Array.isArray(node.path)||node.path.length>12 ||
        node.path.some(i=>!Number.isInteger(i)||i<0||i>=200) ||
        typeof node.role!=='string'||node.role.length>50 ||
        typeof node.name!=='string'||node.name.length>120 ||
        !hash.test(node.fingerprint)||typeof node.enabled!=='boolean')
        throw new Error('AX_INVALID_SNAPSHOT');
      if(node.protected===true || /secure|password|passcode|one.time|otp|security.code|credit.card|cvv/i.test(node.role+' '+node.name))
        throw new Error('AX_INVALID_SNAPSHOT');
      if(Object.hasOwn(node,'value') || Object.hasOwn(node,'AXValue') ||
         Object.hasOwn(node,'raw_value'))throw new Error('AX_INVALID_VALUE_OBSERVATION');
      const valueObservation=validatedAxValueObservation(node.value_observation,node.role);
      const key=node.path.join('.');
      if(seen.has(key))throw new Error('AX_INVALID_SNAPSHOT');
      seen.add(key);
      const frame=node.frame_points;
      if(frame!==undefined && (!pointBounds(frame) || frame.width>5000 || frame.height>4000))
        throw new Error('AX_INVALID_SNAPSHOT');
      const ref=crypto.randomBytes(32).toString('hex');
      this.#refs.set(ref,{revision:raw.revision,target:{...target},
        path:node.path,fingerprint:node.fingerprint,role:node.role,
        name:node.name,enabled:node.enabled,
        bounds:{...bounds},frame,expires:now+SCREENSHOT_TTL_MS,used:false});
      nodes.push({node_ref:ref,role:node.role,name:node.name,enabled:node.enabled,
        parent_path:node.path.length?node.path.slice(0,-1):null,
        ...(frame?{frame_points:frame}:{}),
        ...(valueObservation?{value_observation:valueObservation}:{})});
    }
    return {provider:'native_ax',ax_revision:raw.revision,
      expires_in_ms:SCREENSHOT_TTL_MS,nodes};
  }
  resolve(ref,revision,target,bounds,action) {
    if(typeof ref!=='string'||!hash.test(ref)||typeof revision!=='string'||
       !hash.test(revision))throw new Error('STALE_AX_NODE');
    const node=this.#refs.get(ref);
    if(!node||node.used||node.expires<this.#time()||node.revision!==revision)
      throw new Error('STALE_AX_NODE');
    if(['browser','expected_title','expected_url'].some(key=>node.target[key]!==target[key]))
      throw new Error('AX_TARGET_MISMATCH');
    if(!sameWindowBounds(node.bounds,bounds))throw new Error('AX_WINDOW_CHANGED');
    if(!node.enabled || !node.frame || node.frame.width<1||node.frame.height<1 ||
       !intersects(node.frame,bounds))throw new Error('AX_NODE_UNSAFE');
    if((action==='ax_press' && !['AXButton','AXLink','AXCheckBox','AXRadioButton','AXPopUpButton','AXMenuItem'].includes(node.role)) ||
       (action==='ax_set_value' && !['AXTextField','AXTextArea','AXComboBox'].includes(node.role))||
       !allowedRoles.has(node.role))throw new Error('AX_ACTION_NOT_SUPPORTED');
    return node;
  }
  consume(ref){const node=this.#refs.get(ref);if(node)node.used=true;}
  revokeAll(){this.#refs.clear();}
}
