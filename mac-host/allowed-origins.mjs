import {URL} from 'node:url';

/**
 * Exact HTTPS origins + one operator-approved, DNS-label bounded suffix rule.
 * No broad glob interpretation, prefix matching, arbitrary wildcard or ports.
 * Apex and wildcard must be separate allowlist entries.
 */
export const LCH_APEX = 'https://lch-app.cloud';
export const LCH_WILDCARD = 'https://*.lch-app.cloud';

export function validAllowlistEntry(entry) {
  if(typeof entry!=='string')return false;
  if(entry===LCH_WILDCARD)return true;
  if(entry.includes('*') || entry.length>2048)return false;
  try {
    const url=new URL(entry);
    return url.protocol==='https:' && url.origin===entry &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function allowsWebOrigin(urlValue, origins) {
  if(!(origins instanceof Set) || typeof urlValue!=='string')return false;
  let url;
  try{url=new URL(urlValue);}catch{return false;}
  if(url.username || url.password)return false;
  // Keep preexisting *exact* origin semantics (including localhost test rigs).
  // The wildcard itself is only HTTPS, and Mac Bridge config accepts HTTPS.
  if(origins.has(url.origin))return true;
  if(url.protocol!=='https:' || !origins.has(LCH_WILDCARD))return false;
  // Dot-bounded DNS suffix: foo.lch-app.cloud valid; evillch-app.cloud not.
  // An arbitrary port changes authority and is not covered by wildcard grant.
  const suffix='.lch-app.cloud';
  if(!url.hostname.endsWith(suffix) || url.port ||
     url.hostname.length<=suffix.length || url.hostname.length>253)return false;
  const prefix=url.hostname.slice(0,-suffix.length);
  // Reject empty/invalid labels, not merely an arbitrary textual suffix.
  return prefix.split('.').every(label=>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
