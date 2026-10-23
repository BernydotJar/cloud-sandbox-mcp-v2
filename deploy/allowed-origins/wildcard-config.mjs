import {LINKEDIN_APEX,LINKEDIN_WILDCARD,LCH_APEX,LCH_WILDCARD,UIPATH_APEX,UIPATH_WILDCARD,
  ATLASSIAN_APEX,ATLASSIAN_WILDCARD,validAllowlistEntry}
  from './allowed-origins.mjs';
import {ALLOWLIST_ENV_KEY} from './linkedin-config.mjs';
export const HCL_ITIME_ORIGIN='https://wf24.myhcl.com';
export {LINKEDIN_APEX,LINKEDIN_WILDCARD,LCH_APEX,LCH_WILDCARD,UIPATH_APEX,UIPATH_WILDCARD,ATLASSIAN_APEX,ATLASSIAN_WILDCARD};

/**
 * Preserve all unrelated environment bytes and preexisting origins.
 * Recognize only the one approved wildcard, never arbitrary star patterns.
 */
export function addLchOrigins(envSource) {
  if(typeof envSource!=='string' || envSource.length>2_000_000 ||
     envSource.includes('\0') || /\r(?!\n)/.test(envSource))
    throw Error('INVALID_ENV_SOURCE');
  const eol=envSource.includes('\r\n')?'\r\n':'\n';
  if(eol==='\r\n' && envSource.replaceAll('\r\n','').includes('\n'))
    throw Error('MIXED_ENV_NEWLINES');
  const lines=envSource.split(eol);
  const positions=lines.flatMap((line,i)=>line.startsWith(ALLOWLIST_ENV_KEY+'=')?[i]:[]);
  if(positions.length!==1)throw Error(positions.length?
    'DUPLICATE_ALLOWED_ORIGINS_KEY':'MISSING_ALLOWED_ORIGINS_KEY');
  const index=positions[0];
  const original=lines[index].slice(ALLOWLIST_ENV_KEY.length+1).trim();
  if(!original || /[#\\]/.test(original))throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
  const quote=['"',"'"].includes(original[0])?original[0]:'';
  if(quote && (!original.endsWith(quote) || original.length<3))
    throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
  const raw=quote?original.slice(1,-1):original;
  if(quote && raw.includes(quote))throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
  const origins=raw.split(',').map(x=>x.trim());
  if(!origins.length || origins.some(x=>!validAllowlistEntry(x)) ||
     new Set(origins).size!==origins.length)
    throw Error('INVALID_OR_DUPLICATE_ALLOWED_ORIGIN');
  const beforeCount=origins.length;
  const alreadyApex=origins.includes(LCH_APEX);
  const alreadyWildcard=origins.includes(LCH_WILDCARD);
  if(!alreadyApex)origins.push(LCH_APEX);
  if(!alreadyWildcard)origins.push(LCH_WILDCARD);
  for(const candidate of [HCL_ITIME_ORIGIN,LINKEDIN_APEX,LINKEDIN_WILDCARD,UIPATH_APEX,UIPATH_WILDCARD,ATLASSIAN_APEX,ATLASSIAN_WILDCARD])
    if(!origins.includes(candidate))origins.push(candidate);
  if(origins.length>50)throw Error('ALLOWED_ORIGINS_LIMIT');
  const changed=beforeCount!==origins.length;
  if(changed)lines[index]=ALLOWLIST_ENV_KEY+'='+quote+origins.join(',')+quote;
  return {
    updated:changed?lines.join(eol):envSource,
    beforeCount,afterCount:origins.length,
    changed,alreadyApex,alreadyWildcard
  };
}
