/**
 * Narrow, idempotent source patch for the known customized Mac Bridge.
 * Any drift around origin safety checks is an error, never blind overwrite.
 */
export const WILDCARD_PATCH_MARKER='// LCH_ORIGIN_WILDCARD_V1';

function replaceOnce(src,from,to,label){
  const at=src.indexOf(from);
  if(at<0 || src.indexOf(from,at+from.length)!==-1)
    throw Error('UNKNOWN_WILDCARD_SOURCE_'+label);
  return src.slice(0,at)+to+src.slice(at+from.length);
}
export function patchBridgeForLchWildcard(source) {
  if(source.includes(WILDCARD_PATCH_MARKER)) {
    for(const required of ['validAllowlistEntry','allowsWebOrigin',
      'lch_app_cloud_wildcard_enabled','LCH_WILDCARD']){
      if(!source.includes(required))throw Error('PARTIALLY_PATCHED_BRIDGE');
    }
    return {source,changed:false};
  }
  let result=replaceOnce(source,
    "import { RuntimeFault } from './browser-runtime/contracts.mjs';",
    "import { RuntimeFault } from './browser-runtime/contracts.mjs';\n"+
    WILDCARD_PATCH_MARKER+"\n"+
    "import {allowsWebOrigin,validAllowlistEntry,LCH_WILDCARD} from './allowed-origins.mjs';",
    'BRIDGE_IMPORT');
  result=replaceOnce(result,
    'try { return origins.has(new URL(cleaned).origin); }',
    'try { return allowsWebOrigin(cleaned,origins); }',
    'TAB_ALLOWLIST');
  result=replaceOnce(result,
    '(!dynamicTabs && !origins.has(new URL(t.expected_url).origin)))',
    '(!dynamicTabs && !allowsWebOrigin(t.expected_url,origins)))',
    'NATIVE_TARGET');
  result=replaceOnce(result,
    'if (restrictMutation && !origins.has(new URL(t.expected_url).origin)) {',
    'if (restrictMutation && !allowsWebOrigin(t.expected_url,origins)) {',
    'MUTATION_GUARD');
  result=replaceOnce(result,
    "[...allowedOrigins].some(v => !v.startsWith('https://') || new URL(v).origin !== v)",
    '[...allowedOrigins].some(v => !validAllowlistEntry(v))',
    'CONFIG_VALIDATOR');
  result=replaceOnce(result,
    "native_approval:true,allowlisted_origins:allowedOrigins.size,",
    "native_approval:true,allowlisted_origins:allowedOrigins.size,\n"+
    "          lch_app_cloud_wildcard_enabled:allowedOrigins.has(LCH_WILDCARD),",
    'STATUS');
  return {source:result,changed:true};
}
export function patchRuntimeForLchWildcard(source) {
  if(source.includes(WILDCARD_PATCH_MARKER)) {
    for(const needed of ['allowsWebOrigin','lch_app_cloud_wildcard_enabled']){
      if(!source.includes(needed))throw Error('PARTIALLY_PATCHED_RUNTIME');
    }
    return {source,changed:false};
  }
  let result=replaceOnce(source,
    "import {cdpAccessibilitySnapshot,prepareCdpSemanticAction} from './cdp-semantic.mjs';",
    "import {cdpAccessibilitySnapshot,prepareCdpSemanticAction} from './cdp-semantic.mjs';\n"+
    WILDCARD_PATCH_MARKER+"\n"+
    "import {allowsWebOrigin,LCH_WILDCARD} from '../allowed-origins.mjs';",
    'RUNTIME_IMPORT');
  result=replaceOnce(result,
    "(dynamicTabs || allowedOrigins.has(new URL(url).origin));",
    "(dynamicTabs || allowsWebOrigin(url,allowedOrigins));",
    'READ_ALLOWLIST');
  result=replaceOnce(result,
    "(!restrictMutationsToAllowlist || allowedOrigins.has(new URL(url).origin));",
    "(!restrictMutationsToAllowlist || allowsWebOrigin(url,allowedOrigins));",
    'WRITE_ALLOWLIST');
  result=replaceOnce(result,
    "mutation_policy: this.restrictMutationsToAllowlist ? 'allowlist_only' : 'session_scoped',",
    "mutation_policy: this.restrictMutationsToAllowlist ? 'allowlist_only' : 'session_scoped',\n"+
    "      lch_app_cloud_wildcard_enabled:this.allowedOrigins.has(LCH_WILDCARD),",
    'RUNTIME_STATUS');
  result=replaceOnce(result,
    '    this.sessions = sessionStore;',
    '    this.sessions = sessionStore;\n    this.allowedOrigins = allowedOrigins;',
    'RUNTIME_STORAGE');
  return {source:result,changed:true};
}
