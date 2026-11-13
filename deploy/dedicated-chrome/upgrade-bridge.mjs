/**
 * Source-preserving migration for the installed Mac Bridge.
 *
 * Never substitute a whole bridge.mjs from another release. Apply a small
 * checked transformation to a compatible existing bridge, preserving custom
 * routing, native fallback and audit code byte-for-byte outside the inserts.
 */
const MARKER = '// LCH_DEDICATED_CHROME_AUTOSTART_V3';
const PORT = 9223;
const ENDPOINT = 'http://127.0.0.1:' + PORT;

const helper = `
${MARKER}
async function ensureDedicatedChrome() {
  const profile = path.join(os.homedir(), '.ido-chrome-bridge', 'profile');
  const port = 9223;
  const endpoint = 'http://127.0.0.1:' + port + '/json/version';
  const owner = async () => {
    try {
      const {stdout} = await exec('/usr/sbin/lsof',
        ['-n','-P','-t','-iTCP:' + port,'-sTCP:LISTEN'],
        {timeout:3000,maxBuffer:1500});
      const pids = [...new Set(stdout.trim().split(/\\s+/).filter(x => /^\\d+$/.test(x)))].slice(0,5);
      if (pids.length !== 1) return {occupied:pids.length>0, trusted:false};
      const details = await exec('/bin/ps',
        ['-p',pids[0],'-o','command='],{timeout:3000,maxBuffer:15000});
      const command = details.stdout;
      return {occupied:true, trusted:command.includes('--remote-debugging-port=9223') &&
        command.includes('--user-data-dir=' + profile)};
    } catch { return {occupied:false,trusted:false}; }
  };
  const health = async () => {
    try {
      const response = await fetch(endpoint,{signal:AbortSignal.timeout(1800)});
      if (!response.ok) return false;
      const body = await response.json();
      return typeof body?.Browser === 'string' &&
        body.Browser.startsWith('Chrome/') &&
        typeof body.webSocketDebuggerUrl === 'string';
    } catch { return false; }
  };
  const current = await owner();
  // Fail closed if a CDP server responds but its owner cannot be proven.
  if (!current.occupied && await health()) return {ready:false,started:false};
  if (current.occupied) return {ready:current.trusted && await health(),started:false};
  const parent = path.dirname(profile);
  await fs.mkdir(parent,{recursive:true,mode:0o700});
  const parentStat = await fs.lstat(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) return {ready:false,started:false};
  await fs.chmod(parent,0o700);
  await fs.mkdir(profile,{recursive:true,mode:0o700});
  const stat = await fs.lstat(profile);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return {ready:false,started:false};
  await fs.chmod(profile,0o700);
  try {
    await exec('/usr/bin/open',['-na','Google Chrome','--args',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9223',
      '--user-data-dir=' + profile,
      '--no-first-run','--no-default-browser-check'],
      {timeout:12000,maxBuffer:3000});
  } catch { return {ready:false,started:false}; }
  for (let i=0; i<24; i++) {
    await sleep(450);
    const check = await owner();
    if (check.occupied && check.trusted && await health()) return {ready:true,started:true};
    if (check.occupied && !check.trusted) return {ready:false,started:true};
  }
  return {ready:false,started:true};
}
`.trim();

function replaceOnce(source, from, to, stage) {
  const start = source.indexOf(from);
  if (start < 0 || source.indexOf(from,start+from.length)>=0)
    throw Error('INCOMPATIBLE_BRIDGE_' + stage);
  return source.slice(0,start) + to + source.slice(start+from.length);
}

/**
 * Compatible variants can use scalar or per-browser routing. Exact structural
 * checks reject unknown route shapes. Existing v3 patch is idempotent.
 */
export function upgradeBridgeSource(source) {
  if(typeof source !== 'string' || source.length < 9000 || source.length > 125000)
    throw Error('BRIDGE_SIZE_INVALID');
  if(source.includes(MARKER)) {
    if(!source.includes('ensureDedicatedChromeHandler = ensureDedicatedChrome') ||
       !source.includes('COMPUTER_USE_DEDICATED_CHROME_AUTO_START'))
      throw Error('PARTIAL_DEDICATED_PATCH');
    return {source,applied:false,variant:source.includes("browserRouting[input.browser] === 'prefer_persistent'") ? 'per-browser' : 'scalar'};
  }
  // Previous exact installer can remain installed. Do not inject duplicates.
  if(source.includes('async function ensureDedicatedChrome()')) {
    if(!source.includes('ensureDedicatedChromeHandler = ensureDedicatedChrome') ||
       !source.includes('COMPUTER_USE_DEDICATED_CHROME_AUTO_START'))
      throw Error('UNKNOWN_EXISTING_AUTOSTART_PATCH');
    return {source,applied:false,variant:source.includes("browserRouting[input.browser] === 'prefer_persistent'") ? 'per-browser' : 'scalar'};
  }
  for(const invariant of [
    'export function createBridgeServer','export function nativeDiscoveryFallback',
    'browserProviders:', 'result=await runtime.discover(input);',
    'browserRoutingFromEnvironment', 'launchBrowserHandler = launchBrowser}) {',
    'browserAudit: event => ledger.append(event)'
  ]) if(!source.includes(invariant))throw Error('INCOMPATIBLE_BRIDGE_INVARIANT');
  const perBrowser = source.includes("browserRouting[input.browser] === 'prefer_persistent'");
  const scalar = source.includes("browserRouting === 'prefer_persistent'");
  if(perBrowser === scalar)throw Error('INCOMPATIBLE_BROWSER_ROUTING_SHAPE');
  const variant = perBrowser?'per-browser':'scalar';
  let updated=replaceOnce(source,
    'export function nativeDiscoveryFallback',
    helper+'\n\nexport function nativeDiscoveryFallback','AUTOSTART_FUNCTION');
  updated=replaceOnce(updated,
    'launchBrowserHandler = launchBrowser}) {',
    'launchBrowserHandler = launchBrowser, dedicatedChromeAutoStart = false,\n'+
    '                                   ensureDedicatedChromeHandler = ensureDedicatedChrome}) {',
    'HANDLER_SIGNATURE');
  const routeStart = perBrowser
    ?"if (browserRouting[input.browser] === 'prefer_persistent') {\n            try {\n              result=await runtime.discover(input);"
    :"if (browserRouting === 'prefer_persistent') {\n            try {\n              result=await runtime.discover(input);";
  const injected = routeStart.replace('              result=await runtime.discover(input);',
    `              if (input.browser==='chrome' && dedicatedChromeAutoStart &&
                  browserProviders.chrome?.endpoint==='${ENDPOINT}') {
                const opened=await ensureDedicatedChromeHandler();
                if (!opened.ready)throw new RuntimeFault('DEDICATED_CHROME_NOT_READY');
              }
              result=await runtime.discover(input);`);
  updated=replaceOnce(updated,routeStart,injected,'DISCOVERY_HANDLER');
  updated=replaceOnce(updated,
    'browserAudit: event => ledger.append(event)',
    "browserAudit: event => ledger.append(event),\n"+
    "    dedicatedChromeAutoStart: environment.COMPUTER_USE_DEDICATED_CHROME_AUTO_START === 'true'",
    'SERVICE_CONFIG');
  // Prevent silent native/coordinate fallback on this opt-in dedicated channel.
  // Only modify the catch adjacent to the exact persistent discovery statement.
  const discoveryLine='              result=await runtime.discover(input);';
  const pos=updated.indexOf(discoveryLine);
  if(pos<0)throw Error('DISCOVERY_NOT_FOUND');
  const after=updated.slice(pos);
  const catcher='            } catch(error) {';
  const catchPos=after.indexOf(catcher);
  if(catchPos<0 || catchPos>400)throw Error('DISCOVERY_CATCH_UNKNOWN');
  const originalCatch=after.slice(catchPos,catchPos+catcher.length);
  const addition=`
              if (input.browser==='chrome' && dedicatedChromeAutoStart &&
                  browserProviders.chrome?.endpoint==='${ENDPOINT}')
                throw new RuntimeFault('DEDICATED_CHROME_ATTACH_FAILED');`;
  updated=updated.slice(0,pos+catchPos)+originalCatch+addition+
    updated.slice(pos+catchPos+catcher.length);
  return {source:updated,applied:true,variant};
}

export function upgradeEnvSource(source,variant) {
  if(typeof source!=='string' || source.length>200000 ||
     !source.includes('COMPUTER_USE_BRIDGE_TOKEN='))
    throw Error('BRIDGE_ENV_INVALID');
  const eol=source.includes('\r\n')?'\r\n':'\n';
  const entries=source.split(/\r?\n/);
  const changes={
    COMPUTER_USE_DEDICATED_CHROME_AUTO_START:'true',
    COMPUTER_USE_CHROME_ENDPOINT:ENDPOINT,
    COMPUTER_USE_CHROME_PROTOCOL:'cdp',
    ...(variant==='per-browser' ? {COMPUTER_USE_CHROME_ROUTING:'prefer_persistent'}:
      {COMPUTER_USE_BROWSER_ROUTING:'prefer_persistent'})
  };
  for(const [key,value] of Object.entries(changes)) {
    const indices=entries.flatMap((line,i)=>line.startsWith(key+'=')?[i]:[]);
    if(indices.length>1)throw Error('DUPLICATE_ENV_KEY_'+key);
    if(indices.length)entries[indices[0]]=key+'='+value;
    else entries.push(key+'='+value);
  }
  return {source:entries.join(eol),keys:Object.keys(changes)};
}
