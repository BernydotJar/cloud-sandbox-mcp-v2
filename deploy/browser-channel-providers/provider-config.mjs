import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
export const CHANNELS=Object.freeze({chrome:'chrome',edge:'msedge'});
export const ENVIRONMENT=Object.freeze({
  COMPUTER_USE_CHROME_ENDPOINT:'chrome',
  COMPUTER_USE_CHROME_PROTOCOL:'cdp',
  COMPUTER_USE_EDGE_ENDPOINT:'msedge',
  COMPUTER_USE_EDGE_PROTOCOL:'cdp'
});
export const ERROR_CODES=Object.freeze({
  NO_DEBUG_PORT:'REMOTE_DEBUGGING_DISABLED',
  INVALID_MARKER:'REMOTE_DEBUGGING_MARKER_INVALID'
});
export function inspectDebugMarker(bytes) {
  if(!bytes || bytes.length > 256) throw Error(ERROR_CODES.INVALID_MARKER);
  const text=Buffer.isBuffer(bytes)?bytes.toString('utf8'):String(bytes);
  const portLine=text.trim().split(/\r?\n/,1)[0];
  if(!/^\d{4,5}$/.test(portLine))throw Error(ERROR_CODES.INVALID_MARKER);
  const port=Number(portLine);
  if(port<1024||port>65535)throw Error(ERROR_CODES.INVALID_MARKER);
  return {ready:true,port};
}
export function reconcileProviderEnv(original) {
  if(typeof original!=='string')throw Error('INVALID_EXISTING_ENV');
  const eol=original.includes('\r\n')?'\r\n':'\n';
  const lines=original.split(/\r?\n/);
  for(const [name,expected] of Object.entries(ENVIRONMENT)){
    const indices=lines.flatMap((line,i)=>line.startsWith(name+'=')?[i]:[]);
    if(indices.length>1)throw Error('DUPLICATE_PROVIDER_SETTING');
    if(indices.length===1){
      const existing=lines[indices[0]].slice(name.length+1).trim();
      if(existing!=='' && existing!==expected)throw Error('PROVIDER_CONFIG_ALREADY_CUSTOMIZED');
      lines[indices[0]]=name+'='+expected;
    }else{
      // Append before the optional existing trailing newline (empty element).
      if(lines.at(-1)==='')lines.splice(lines.length-1,0,name+'='+expected);
      else lines.push(name+'='+expected);
    }
  }
  return lines.join(eol)+(lines.at(-1)===''?'':eol);
}
export function matchingTabs(connected,native) {
  const safe=value=>{
    try{
      const u=new URL(value);
      return ['http:','https:'].includes(u.protocol) && !u.username && !u.password
        ?u.origin+u.pathname:'';
    }catch{return '';}
  };
  const nativeSet=new Set(native.map(safe).filter(Boolean));
  const connectedSet=new Set(connected.map(safe).filter(Boolean));
  let matches=0;
  for(const u of connectedSet)if(nativeSet.has(u))matches++;
  return {
    connected_web_pages:connectedSet.size,
    native_web_pages:nativeSet.size,
    matched_pages:matches,
    verified:matches>=Math.min(2,nativeSet.size)&&nativeSet.size>0
  };
}
export function registeredProviders(value) {
  const providers=value?.providers||[];
  return providers.length===2 &&
    providers.some(p=>p.browser==='chrome' && p.protocol==='cdp' && p.configured) &&
    providers.some(p=>p.browser==='edge' && p.protocol==='cdp' && p.configured);
}
