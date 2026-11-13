import {URL} from 'node:url';
import {allowsWebOrigin,validAllowlistEntry} from './allowed-origins.mjs';

export const ALLOWLIST_KEY='COMPUTER_USE_ALLOWED_ORIGINS';
export const MAX_ORIGINS=50;
export const SHORTCUT_VERSION='v1';
export const SHORTCUT_SCRIPT=[
  '#!/bin/sh',
  'exec node "$HOME/.local/share/sandbox-v3-origins/v1/manage-on-mac.mjs" "$@"',
  ''
].join('\n');

/**
 * Convert a user-supplied page URL into one precise HTTPS origin.
 * Do not log the original URL: query strings may contain credentials.
 * No wildcard, port, IP literal, scheme downgrade or lookalike host.
 */
export function exactHttpsOrigin(value) {
  if(typeof value!=='string' || value.length<9 || value.length>4096 ||
     [...value].some(c=>c.charCodeAt(0)<=32 || c.charCodeAt(0)===127) || !value.startsWith('https://'))
    throw Error('INVALID_HTTPS_URL');
  const authority=value.slice('https://'.length).split(/[/?#]/,1)[0];
  if(!/^[A-Za-z0-9.-]+$/.test(authority) ||
     authority.length>253 || authority.endsWith('.') ||
     authority.includes('..') || authority.split('.').length<2)
    throw Error('UNSAFE_ORIGIN_AUTHORITY');
  const parts=authority.toLowerCase().split('.');
  if(parts.some(label=>!(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) ||
     !/^[a-z]{2,63}$/.test(parts.at(-1)) ||
     ['local','localhost','internal','test','invalid','example','onion'].includes(parts.at(-1)) ||
     parts.some(label=>label.startsWith('xn--')))
    throw Error('UNSAFE_ORIGIN_HOSTNAME');
  const u=new URL(value);
  if(u.protocol!=='https:' || u.port || u.username || u.password ||
     u.hostname!==authority.toLowerCase() ||
     u.hostname==='localhost' ||
     !validAllowlistEntry(u.origin))
    throw Error('UNSAFE_ORIGIN_URL');
  return u.origin;
}

export function parseOriginSettings(source) {
  if(typeof source!=='string' || source.length>2_000_000 ||
     source.includes('\0') || /\r(?!\n)/.test(source))
    throw Error('INVALID_CONTROLLER_ENV');
  const eol=source.includes('\r\n')?'\r\n':'\n';
  if(eol==='\r\n' && source.replaceAll('\r\n','').includes('\n'))
    throw Error('MIXED_ENV_NEWLINES');
  const lines=source.split(eol);
  const indices=lines.flatMap((line,index)=>line.startsWith(ALLOWLIST_KEY+'=')?[index]:[]);
  if(indices.length!==1)throw Error(indices.length?
    'DUPLICATE_ALLOWED_ORIGINS_KEY':'MISSING_ALLOWED_ORIGINS_KEY');
  const index=indices[0];
  const raw=lines[index].slice(ALLOWLIST_KEY.length+1).trim();
  if(!raw || /[#\\]/.test(raw))throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
  const quote=['"',"'"].includes(raw[0])?raw[0]:'';
  if(quote && (!raw.endsWith(quote) || raw.length<3))
    throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
  const list=(quote?raw.slice(1,-1):raw).split(',').map(v=>v.trim());
  if(list.some(v=>!validAllowlistEntry(v)) ||
    new Set(list).size!==list.length ||
    list.length>MAX_ORIGINS)
    throw Error('INVALID_OR_DUPLICATE_ALLOWED_ORIGIN');
  return {source,lines,index,eol,quote,origins:list};
}

export function changeExactOrigin(source,action,url) {
  if(!['add','remove','check'].includes(action))
    throw Error('UNSUPPORTED_ORIGIN_OPERATION');
  const entry=exactHttpsOrigin(url);
  const settings=parseOriginSettings(source);
  const origins=[...settings.origins];
  const beforeCount=origins.length;
  const present=origins.includes(entry);
  const allowedBefore=allowsWebOrigin(entry,new Set(origins));
  let changed=false;
  if(action==='add' && !allowedBefore){
    if(origins.length>=MAX_ORIGINS)throw Error('ORIGIN_ALLOWLIST_CAPACITY_REACHED');
    origins.push(entry);
    changed=true;
  }
  if(action==='remove'){
    if(present){
      const reduced=origins.filter(v=>v!==entry);
      if(reduced.length===0)throw Error('EMPTY_ORIGIN_ALLOWLIST_DENIED');
      if(allowsWebOrigin(entry,new Set(reduced)))
        throw Error('ORIGIN_STILL_ALLOWED_BY_WILDCARD');
      origins.splice(origins.indexOf(entry),1);
      changed=true;
    }else if(allowedBefore){
      throw Error('ORIGIN_STILL_ALLOWED_BY_WILDCARD');
    }
  }
  const allowedAfter=allowsWebOrigin(entry,new Set(origins));
  if(changed)settings.lines[settings.index]=ALLOWLIST_KEY+'='+settings.quote+
    origins.join(',')+settings.quote;
  const updated=changed?settings.lines.join(settings.eol):source;
  return {updated,entry,action,changed,alreadyAllowed:allowedBefore,
    allowedAfter,beforeCount,afterCount:origins.length,origins};
}
