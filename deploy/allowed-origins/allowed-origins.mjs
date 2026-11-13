import {URL} from 'node:url';

/**
 * Exact HTTPS origins + one operator-approved, DNS-label bounded suffix rule.
 * No broad glob interpretation, prefix matching, arbitrary wildcard or ports.
 * Apex and wildcard must be separate allowlist entries.
 */
export const LINKEDIN_APEX = 'https://www.linkedin.com';
export const LINKEDIN_WILDCARD = 'https://*.linkedin.com';
export const LCH_APEX = 'https://lch-app.cloud';
export const LCH_WILDCARD = 'https://*.lch-app.cloud';
export const UIPATH_APEX = 'https://cloud.uipath.com';
export const UIPATH_WILDCARD = 'https://*.cloud.uipath.com';
export const ATLASSIAN_APEX = 'https://atlassian.net';
export const ATLASSIAN_WILDCARD = 'https://*.atlassian.net';
export const APPROVED_WILDCARDS = new Map([
  [LCH_WILDCARD,'.lch-app.cloud'],
  [LINKEDIN_WILDCARD,'.linkedin.com'],
  [UIPATH_WILDCARD,'.cloud.uipath.com'],
  [ATLASSIAN_WILDCARD,'.atlassian.net']
]);

export function validAllowlistEntry(entry) {
  if(typeof entry!=='string')return false;
  if(APPROVED_WILDCARDS.has(entry))return true;
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
  if(url.protocol!=='https:' || url.port || url.hostname.length>253)return false;
  for(const [pattern,suffix] of APPROVED_WILDCARDS){
    if(!origins.has(pattern) || !url.hostname.endsWith(suffix) ||
       url.hostname.length<=suffix.length)continue;
    const prefix=url.hostname.slice(0,-suffix.length);
    if(prefix.split('.').every(label=>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return true;
  }
  return false;
}
