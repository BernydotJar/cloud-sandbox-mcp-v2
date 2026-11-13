/**
 * Exact-origin additive change only. Never edits other .env keys or prints
 * credentials. The active Mac Bridge uses this key for browser mutations.
 */
import {validAllowlistEntry} from './allowed-origins.mjs';
export const LINKEDIN_ORIGIN = 'https://www.linkedin.com';
export const ALLOWLIST_ENV_KEY = 'COMPUTER_USE_ALLOWED_ORIGINS';

export function addLinkedInOrigin(envSource) {
  if (typeof envSource !== 'string' || envSource.length > 2_000_000 ||
      envSource.includes('\0') || /\r(?!\n)/.test(envSource)) {
    throw Error('INVALID_ENV_SOURCE');
  }
  const newline = envSource.includes('\r\n') ? '\r\n' : '\n';
  if (envSource.includes('\r\n') && envSource.replaceAll('\r\n','').includes('\n'))
    throw Error('MIXED_ENV_NEWLINES');
  const lines = envSource.split(newline);
  const indexes = lines.flatMap((line,index)=>
    line.startsWith(ALLOWLIST_ENV_KEY+'=') ? [index] : []);
  if (indexes.length !== 1)
    throw Error(indexes.length ? 'DUPLICATE_ALLOWED_ORIGINS_KEY' : 'MISSING_ALLOWED_ORIGINS_KEY');
  const index = indexes[0];
  const original = lines[index].slice(ALLOWLIST_ENV_KEY.length+1).trim();
  if (!original || /[#\\]/.test(original))throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
  let quote = '';
  let raw = original;
  if (original.startsWith('"') || original.startsWith("'")) {
    quote = original[0];
    if (!original.endsWith(quote) || original.length < 3)
      throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
    raw = original.slice(1,-1);
    if (raw.includes(quote))throw Error('INVALID_ALLOWED_ORIGINS_FORMAT');
  }
  const origins = raw.split(',').map(s=>s.trim());
  if (!origins.length || origins.length > 50 || origins.some(v=>!v))
    throw Error('INVALID_ALLOWED_ORIGINS_LIST');
  if (new Set(origins).size !== origins.length)
    throw Error('DUPLICATE_ALLOWED_ORIGIN');
  for (const origin of origins) {
    if(!validAllowlistEntry(origin))throw Error('INVALID_ALLOWED_ORIGIN');
  }
  const alreadyPresent = origins.includes(LINKEDIN_ORIGIN);
  if (!alreadyPresent) {
    if(origins.length>=50)throw Error('ALLOWED_ORIGINS_LIMIT');
    origins.push(LINKEDIN_ORIGIN);
  }
  const replacement = ALLOWLIST_ENV_KEY+'='+quote+origins.join(',')+quote;
  lines[index] = replacement;
  const updated = alreadyPresent ? envSource : lines.join(newline);
  return {
    updated,
    changed:!alreadyPresent,
    origin:LINKEDIN_ORIGIN,
    beforeCount:origins.length-(alreadyPresent?0:1),
    afterCount:origins.length
  };
}
