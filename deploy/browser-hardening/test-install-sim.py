#!/usr/bin/env python3
"""Hermetic 29->29 Mac operator release simulation. NEVER invokes real launchd/Docker."""
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
installer = repo / 'deploy/browser-auto/install-on-mac.mjs'
probe = repo / 'deploy/browser-auto/registry-probe.mjs'
sha = lambda value: hashlib.sha256(value).hexdigest()
names = ('bridge.mjs','runtime.mjs','connection-pool.mjs','browser-runtime-tools.js')

with tempfile.TemporaryDirectory(prefix='browser-hardening-29to29-') as folder:
    root=Path(folder)
    home=root/'home'
    release=root/'release'
    work=root/'work'
    binaries=root/'bin'
    ctrl=root/'controller'
    for d in (home,release,work,binaries,ctrl): d.mkdir(parents=True)
    host=home/'Library/Application Support/LCH/CloudSandboxComputerUse'
    host.mkdir(parents=True)
    destinations={
        'bridge.mjs':host/'bridge.mjs',
        'runtime.mjs':host/'browser-runtime/runtime.mjs',
        'connection-pool.mjs':host/'browser-runtime/connection-pool.mjs',
        'browser-runtime-tools.js':ctrl/'mcp/browser-runtime-tools.js'
    }
    originals={}
    updates={}
    for i,name in enumerate(names):
        dest=destinations[name]
        dest.parent.mkdir(parents=True, exist_ok=True)
        # The old controller has 29 tools too. Values are synthetic test fixtures.
        originals[name]=('existing-29-tool-browser-runtime-'+name+'\n').encode()
        updates[name]=('upgraded-29-tool-browser-runtime-'+name+'\n').encode()
        dest.write_bytes(originals[name])
        (release/name).write_bytes(updates[name])

    # Use the actual production operator logic, with a safe mocked launchctl and no wait.
    installer_src=installer.read_text().replace(
        "'/bin/launchctl'","'launchctl'"
    ).replace("'node:timers/promises'","'./mock-timers.mjs'")
    (release/'install-on-mac.mjs').write_text(installer_src)
    (release/'mock-timers.mjs').write_text('export const setTimeout=async()=>{};\n')
    (release/'registry-probe.mjs').write_bytes(probe.read_bytes())
    manifest={
        'schema':'browser-auto-release.v1',
        'source_commit':'fake-local-29-to-29-source',
        'tools_before':29,'tools_after':29,
        'code_only':True,
        'assets':{
            name:{
                'sha256':sha(updates[name]),
                'allowed_previous':[sha(originals[name])]
            } for name in names
        },
        'probe_sha256':sha(probe.read_bytes())
    }
    blob=(json.dumps(manifest)+'\n').encode()
    (release/'manifest.json').write_bytes(blob)
    (release/'manifest.sha256').write_text(sha(blob)+'\n')

    token='Z'*48
    original_env='COMPUTER_USE_ENABLED=true\nCOMPUTER_USE_BROWSER_V2=true\nCOMPUTER_USE_DYNAMIC_TABS=true\nCOMPUTER_USE_BRIDGE_TOKEN='+token+'\n'
    (work/'.env').write_text(original_env)
    docker_log=root/'docker.log'
    launch_log=root/'launch.log'
    docker=binaries/'docker'
    docker.write_text("""#!/usr/bin/env python3
import os,sys,json,hashlib
from pathlib import Path
args=sys.argv[1:]
with Path(os.environ['MOCK_DOCKER_LOG']).open('a') as f: f.write(' '.join(args[:9])+'\\n')
if args[0]=='inspect':
    if args[1]=='cloud-sandbox-mcp':
        print(json.dumps([{
            'Id':'c'*64,'State':{'Running':True,'Health':{'Status':'healthy'}},
            'Config':{'Labels':{
                'com.docker.compose.service':'mcp',
                'com.docker.compose.project.working_dir':os.environ['MOCK_WORKDIR']
            }},
            'Mounts':[{'Type':'bind','Destination':'/app/dist',
             'Source':os.environ['MOCK_CONTROLLER']}
            ]
        }]))
    elif args[1]=='cloud-sandbox-dev-main':
        print(json.dumps([{'Id':'d'*64,'State':{'Running':True}}]))
    else:sys.exit(3)
elif args[0]=='restart':
    if args[1]!='cloud-sandbox-mcp': sys.exit(3)
    print('cloud-sandbox-mcp')
elif args[0]=='exec':
    if args[1]!='cloud-sandbox-mcp': sys.exit(3)
    js=args[-1]
    if 'HEALTH_OK' in js: print('HEALTH_OK')
    elif 'EXPECTED_MCP_REGISTRY_PASS' in js:
        if "Number('29')" not in js: sys.exit(4)
        if os.getenv('MOCK_FAIL_CANDIDATE')=='1':
            content=Path(os.environ['MOCK_CONTROLLER_TOOL']).read_bytes()
            if hashlib.sha256(content).hexdigest()==os.environ['MOCK_CANDIDATE_SHA']:
                sys.exit(5)
        print('EXPECTED_MCP_REGISTRY_PASS')
    else:sys.exit(6)
else:sys.exit(7)
""")
    docker.chmod(0o755)
    launch=binaries/'launchctl'
    launch.write_text("""#!/bin/sh
echo "$@" >> "$MOCK_LAUNCH_LOG"
exit 0
""")
    launch.chmod(0o755)

    driver=root/'driver.mjs'
    driver.write_text("""
import fs from 'node:fs';
Object.defineProperty(process,'platform',{value:'darwin'});
globalThis.fetch=async (url,opts={})=>{
  const endpoint=String(url);
  let data={};
  if(endpoint.endsWith('/v1/status'))
    data={delegated_session:{active:process.env.MOCK_SESSION_ACTIVE==='1'}};
  else if(endpoint.endsWith('/v2/browser/status'))
    data={enabled:true,version:'2.0.0',providers:[
      {browser:'chrome',configured:true},{browser:'edge',configured:true}
    ]};
  else if(endpoint.endsWith('/v2/browser/tabs'))
    data={provider:'native',semantic_available:false,tabs:[]};
  return {ok:true,text:async()=>JSON.stringify({ok:true,data})};
};
process.argv=[process.execPath,process.env.MOCK_INSTALLER,process.env.MOCK_MODE];
await import('file://'+process.env.MOCK_INSTALLER);
""")

    def invoke(mode,session=False,fail_candidate=False):
        env={**os.environ,
          'PATH':str(binaries)+':'+os.environ.get('PATH',''),
          'HOME':str(home),
          'MOCK_DOCKER_LOG':str(docker_log),
          'MOCK_LAUNCH_LOG':str(launch_log),
          'MOCK_WORKDIR':str(work),
          'MOCK_CONTROLLER':str(ctrl),
          'MOCK_CONTROLLER_TOOL':str(destinations['browser-runtime-tools.js']),
          'MOCK_CANDIDATE_SHA':sha(updates['browser-runtime-tools.js']),
          'MOCK_FAIL_CANDIDATE':'1' if fail_candidate else '0',
          'MOCK_SESSION_ACTIVE':'1' if session else '0',
          'MOCK_INSTALLER':str(release/'install-on-mac.mjs'),
          'MOCK_MODE':mode
        }
        p=subprocess.run(['node',str(driver)],env=env,text=True,
                         capture_output=True,timeout=20)
        return p.returncode,p.stdout+p.stderr

    def unchanged():
        assert (work/'.env').read_text()==original_env
        for name in names: assert destinations[name].read_bytes()==originals[name]
    def updated():
        assert (work/'.env').read_text()==original_env
        for name in names: assert destinations[name].read_bytes()==updates[name]
    def restore():
        for name in names: destinations[name].write_bytes(originals[name])

    code,out=invoke('--inspect')
    assert code==0 and 'PREFLIGHT_PASS' in out,out
    unchanged()
    assert not docker_log.exists() or 'restart' not in docker_log.read_text()
    print('HARDENING_29_TO_29_READ_ONLY_INSPECT_PASS')

    code,out=invoke('--install',session=True)
    assert code==2 and 'ACTIVE_TASK_MUST_FINISH_FIRST' in out,out
    unchanged()
    print('HARDENING_29_TO_29_ACTIVE_DELEGATION_DENIED_PASS')

    code,out=invoke('--install')
    assert code==0 and 'AUTO_BROWSER_READY' in out,out
    updated()
    assert docker_log.read_text().count('restart cloud-sandbox-mcp')==1
    print('HARDENING_29_TO_29_UPGRADE_ALL_29_TOOLS_PASS')

    code,out=invoke('--install')
    assert code==0 and 'ALREADY_INSTALLED' in out,out
    updated()
    assert docker_log.read_text().count('restart cloud-sandbox-mcp')==1
    print('HARDENING_29_TO_29_IDEMPOTENT_PASS')

    restore()
    destinations['bridge.mjs'].write_text('operator_changed_unexpected_code\n')
    code,out=invoke('--install')
    assert code==2 and 'CUSTOM_CODE_DRIFT_BRIDGE_MJS' in out,out
    assert destinations['bridge.mjs'].read_bytes()==b'operator_changed_unexpected_code\n'
    print('HARDENING_29_TO_29_CUSTOMIZED_MAC_DRIFT_BLOCKED_PASS')

    restore()
    code,out=invoke('--install',fail_candidate=True)
    assert code==2 and 'ROLLBACK_VERIFIED' in out,out
    unchanged()
    assert docker_log.read_text().count('restart cloud-sandbox-mcp')==3
    print('HARDENING_29_TO_29_INJECTED_FAILURE_ROLLBACK_TO_29_PASS')

    assert all('cloud-sandbox-dev-main' not in line or
      line.startswith('inspect cloud-sandbox-dev-main')
      for line in docker_log.read_text().splitlines())
    assert all('kickstart -k gui/' in l or 'print gui/' in l
      for l in launch_log.read_text().splitlines())
    print('HARDENING_29_TO_29_NO_BROWSER_AND_NO_DEVMAIN_MUTATION_PASS')
