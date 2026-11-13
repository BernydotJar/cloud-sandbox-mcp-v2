import {upgradeBridgeSource} from '../dedicated-chrome/upgrade-bridge.mjs';

export const TOAST_MARKER = '// LCH_BRIDGE_READY_TOAST_V1';

function replaceOnce(source, original, replacement, field) {
  const index=source.indexOf(original);
  if(index<0 || source.indexOf(original,index+original.length)>=0)
    throw Error('TOAST_BRIDGE_MISMATCH_'+field);
  return source.slice(0,index)+replacement+source.slice(index+original.length);
}

// Existing Chrome tabs, sessions, identity and business logic remain untouched.
export function upgradeToastBridgeSource(source) {
  const base=upgradeBridgeSource(source);
  if(base.source.includes(TOAST_MARKER)) {
    if(!base.source.includes('bridgeToastEnabled') ||
      !base.source.includes('bridgeToastHandler'))
      throw Error('PARTIAL_TOAST_PATCH');
    return {source:base.source,applied:false,variant:base.variant};
  }

  let changed=base.source;
  const toastHelper=[
    TOAST_MARKER,
    'async function showDedicatedChromeToast() {',
    "  const executable=path.join(os.homedir(),",
    "    'Library/Application Support/LCH/CloudSandboxComputerUse/ux/bridge-toast');",
    '  try { await exec(executable,[],{timeout:10000,maxBuffer:512}); }',
    '  catch { /* Visual confirmation is optional; browser operation is unaffected. */ }',
    '}'
  ].join('\n');

  changed=replaceOnce(changed,'export function nativeDiscoveryFallback',
    toastHelper+'\n\nexport function nativeDiscoveryFallback','HELPER');
  changed=replaceOnce(changed,
    'ensureDedicatedChromeHandler = ensureDedicatedChrome}) {',
    'ensureDedicatedChromeHandler = ensureDedicatedChrome,\n'+
    '                                   bridgeToastEnabled = false,\n'+
    '                                   bridgeToastHandler = showDedicatedChromeToast}) {',
    'SIGNATURE');
  changed=replaceOnce(changed,
    '  let busy = false;',
    '  let busy = false;\n  let bridgeToastShown = false;',
    'STATE');
  changed=replaceOnce(changed,
    '              routingMetrics.persistent_discoveries++;',
    [
      '              routingMetrics.persistent_discoveries++;',
      '              // Quiet, click-through toast once per live Bridge connection.',
      "              if (input.browser==='chrome' && bridgeToastEnabled &&",
      '                  dedicatedChromeAutoStart &&',
      "                  browserProviders.chrome?.endpoint==='http://127.0.0.1:9223' &&",
      '                  !bridgeToastShown) {',
      '                bridgeToastShown=true;',
      '                void Promise.resolve().then(() => bridgeToastHandler()).catch(() => {});',
      '              }'
    ].join('\n'),
    'SUCCESS_TRIGGER');
  changed=replaceOnce(changed,
    "dedicatedChromeAutoStart: environment.COMPUTER_USE_DEDICATED_CHROME_AUTO_START === 'true'",
    "dedicatedChromeAutoStart: environment.COMPUTER_USE_DEDICATED_CHROME_AUTO_START === 'true',\n"+
    "    bridgeToastEnabled: environment.COMPUTER_USE_BRIDGE_TOAST === 'true'",
    'CONFIG');
  return {source:changed,applied:true,variant:base.variant};
}

export function upgradeToastEnvSource(contents) {
  if(typeof contents!=='string'||!contents.includes('COMPUTER_USE_BRIDGE_TOKEN='))
    throw Error('TOAST_ENV_INVALID');
  const eol=contents.includes('\r\n')?'\r\n':'\n';
  const lines=contents.split(/\r?\n/);
  const setting='COMPUTER_USE_BRIDGE_TOAST=true';
  const indices=lines.flatMap((line,i)=>line.startsWith('COMPUTER_USE_BRIDGE_TOAST=')?[i]:[]);
  if(indices.length>1)throw Error('DUPLICATE_TOAST_KEY');
  if(indices.length)lines[indices[0]]=setting;
  else lines.push(setting);
  return lines.join(eol);
}
