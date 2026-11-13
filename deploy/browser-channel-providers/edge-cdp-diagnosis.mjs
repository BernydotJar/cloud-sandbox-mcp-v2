/**
 * Status-only CDP triage, no changes to the user's browser or controller.
 * Never expose browser/page URLs, local debugger ports, credentials or errors.
 */
export function edgeCdpVerdict({
  edgeRunning,
  marker,
  packageReady,
  attached,
  identityVerified,
  bridgeConfigured,
  browserRouting
} = {}) {
  if(edgeRunning === false)return 'EDGE_NOT_RUNNING';
  if(marker === 'missing')return 'ENABLE_EDGE_REMOTE_DEBUGGING';
  if(marker === 'invalid')return 'EDGE_DEBUG_MARKER_INVALID';
  if(marker !== 'valid')return 'EDGE_DEBUG_MARKER_UNKNOWN';
  if(!packageReady)return 'MAC_PLAYWRIGHT_RUNTIME_UNAVAILABLE';
  if(attached === false)return 'EDGE_CHANNEL_ATTACH_FAILED';
  if(attached !== true)return 'EDGE_CHANNEL_NOT_TESTED';
  if(identityVerified !== true)return 'EDGE_PROFILE_IDENTITY_UNVERIFIED';
  if(!bridgeConfigured || browserRouting !== 'prefer_persistent')
    return 'BRIDGE_EDGE_PROVIDER_NOT_READY';
  return 'CDP_IDENTITY_PASS_RETRY_BROWSER_TABS';
}
