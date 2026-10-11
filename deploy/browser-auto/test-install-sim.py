#!/usr/bin/env python3
"""Hermetic macOS operator simulation: no real browsers, launchd or Docker."""
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

repo=Path(__file__).resolve().parents[2]
src=repo/'deploy/browser-auto'
old=repo/'deploy/browser-auto/fixtures'
original={
    'bridge.mjs':old/'bridge.fixture',
    'runtime.mjs':old/'runtime.fixture',
    'connection-pool.mjs':old/'connection-pool.fixture',
    'browser-runtime-tools.js':old/'browser-runtime-tools.fixture'
}
changed={
    'bridge.mjs':repo/'mac-host/bridge.mjs',
    'runtime.mjs':repo/'mac-host/browser-runtime/runtime.mjs',
    'connection-pool.mjs':repo/'mac-host/browser-runtime/connection-pool.mjs',
    'browser-runtime-tools.js':repo/'dist/mcp/browser-runtime-tools.js'
}
digest=lambda b: hashlib.sha256(b).hexdigest()

with tempfile.TemporaryDirectory(prefix='auto-browser-release-test-') as td:
    t=Path(td)
    home,base,work,bin_dir,ctrl=[t/s for s in ('home','release','working','bin','controller')]
    for d in (home,base,work,bin_dir,ctrl): d.mkdir()
    host=home/'Library/Application Support/LCH/CloudSandboxComputerUse'
    host.mkdir(parents=True)
    target={
        'bridge.mjs':host/'bridge.mjs',
        'runtime.mjs':host/'browser-runtime/runtime.mjs',
        'connection-pool.mjs':host/'browser-runtime/connection-pool.mjs',
        'browser-runtime-tools.js':ctrl/'mcp/browser-runtime-tools.js'
    }
    for d in {p.parent for p in target.values()}:d.mkdir(parents=True,exist_ok=True)
    for key,original_path in original.items():shutil.copyfile(original_path,target[key])
    for key,new_path in changed.items():shutil.copyfile(new_path,base/key)
    shutil.copyfile(src/'registry-probe.mjs',base/'registry-probe.mjs')
    installer_source=(src/'install-on-mac.mjs').read_text().replace(
        "'/bin/launchctl'","'launchctl'"
    ).replace("'node:timers/promises'","'./fake-timers.mjs'")
    (base/'install-on-mac.mjs').write_text(installer_source)
    (base/'fake-timers.mjs').write_text('export const setTimeout=async()=>{};\n')
    manifest={
        'schema':'browser-auto-release.v1','source_commit':'simulation',
        'assets':{
            key:{
                'sha256':digest((base/key).read_bytes()),
                'allowed_previous':[digest(original[key].read_bytes())]
            } for key in target
        },
        'probe_sha256':digest((base/'registry-probe.mjs').read_bytes())
    }
    blob=(json.dumps(manifest)+'\n').encode()
    (base/'manifest.json').write_bytes(blob)
    (base/'manifest.sha256').write_text(digest(blob)+'\n')
    token='A'*48
    environment='COMPUTER_USE_ENABLED=true\nCOMPUTER_USE_BROWSER_V2=true\nCOMPUTER_USE_DYNAMIC_TABS=true\nCOMPUTER_USE_BRIDGE_TOKEN='+token+'\n'
    envfile=work/'.env'
    envfile.write_text(environment)
    dev_id='d'*64
    mc_id='c'*64
    dockerlog=t/'docker.log'
    docker=bin_dir/'docker'
    docker.write_text("""#!/usr/bin/env python3
import os,sys,json
from pathlib import Path
args=sys.argv[1:]
Path(os.environ['MOCK_DOCKER_LOG']).open('a').write(' '.join(args[:9])+'\\n')
key=args[0]
if key=='inspect':
    if args[1]=='cloud-sandbox-mcp':
        print(json.dumps([{
            'Id':'c'*64,
            'State':{'Running':True,'Health':{'Status':'healthy'}},
            'Config':{'Labels':{
                'com.docker.compose.service':'mcp',
                'com.docker.compose.project.working_dir':os.environ['MOCK_WORKDIR']
            }},
            'Mounts':[{'Type':'bind','Destination':'/app/dist',
              'Source':os.environ['MOCK_CTRL']}]
        }]))
    elif args[1]=='cloud-sandbox-dev-main':
        print(json.dumps([{'Id':'d'*64,'State':{'Running':True}}]))
    else:sys.exit(2)
elif key=='restart':
    if args[1]!='cloud-sandbox-mcp':sys.exit(2)
    print('cloud-sandbox-mcp')
elif key=='exec':
    if args[1]!='cloud-sandbox-mcp':sys.exit(2)
    code=args[-1]
    if 'HEALTH_OK' in code:print('HEALTH_OK')
    elif 'EXPECTED_MCP_REGISTRY_PASS' in code:
        updated='browser_open' in Path(os.environ['MOCK_CONTROLLER_TOOL']).read_text()
        requested29="Number('29')" in code
        if requested29!=updated or (requested29 and os.environ.get('MOCK_FAIL_NEW')=='1'):
            sys.exit(3)
        print('EXPECTED_MCP_REGISTRY_PASS')
    else:sys.exit(2)
else:sys.exit(3)
""")
    docker.chmod(0o755)
    launcher=bin_dir/'launchctl'
    launchlog=t/'launchctl.log'
    launcher.write_text("""#!/bin/sh
echo "$@" >> "$MOCK_LAUNCHLOG"
exit 0
""")
    launcher.chmod(0o755)
    driver=t/'driver.mjs'
    driver.write_text("""
import fs from 'node:fs';
Object.defineProperty(process,'platform',{value:'darwin'});
globalThis.fetch=async (url,options={})=>{
  const current=fs.readFileSync(process.env.MOCK_BRIDGE,'utf8');
  const enabled=current.includes('nativeDiscoveryFallback');
  const key=String(url);
  let data={};
  if(key.endsWith('/v1/status')){
    data={delegated_session:{active:process.env.MOCK_SESSION_ACTIVE==='1'}};
  }else if(key.endsWith('/v2/browser/status')){
    data={enabled:true,version:'2.0.0',providers:enabled?[
      {browser:'chrome',configured:true,protocol:'cdp'},
      {browser:'edge',configured:true,protocol:'cdp'}]:[]};
  }else if(key.endsWith('/v2/browser/tabs')){
    const {browser}=JSON.parse(options.body||'{}');
    data={browser,provider:'native',semantic_available:false,tabs:[
      {title:'Safe page',url:'https://example.com/'}
    ]};
  }
  return {ok:true,text:async()=>JSON.stringify({ok:true,data})};
};
process.argv=[process.execPath,process.env.MOCK_SCRIPT,process.env.MOCK_ACTION];
await import('file://'+process.env.MOCK_SCRIPT);
""")

    def run(mode,session=False,fail=False):
        env={
            **os.environ,
            'HOME':str(home),'PATH':str(bin_dir)+':'+os.environ.get('PATH',''),
            'MOCK_DOCKER_LOG':str(dockerlog),'MOCK_WORKDIR':str(work),
            'MOCK_CTRL':str(ctrl),'MOCK_CONTROLLER_TOOL':str(target['browser-runtime-tools.js']),
            'MOCK_LAUNCHLOG':str(launchlog),'MOCK_BRIDGE':str(target['bridge.mjs']),
            'MOCK_SCRIPT':str(base/'install-on-mac.mjs'),
            'MOCK_ACTION':mode,'MOCK_SESSION_ACTIVE':'1' if session else '0',
            'MOCK_FAIL_NEW':'1' if fail else '0'
        }
        response=subprocess.run(['node',str(driver)],env=env,text=True,capture_output=True,timeout=20)
        return response.returncode,response.stdout+response.stderr

    def old_integrity():
        assert envfile.read_text()==environment
        for key,dest in target.items():assert dest.read_bytes()==original[key].read_bytes()
    def new_integrity():
        assert envfile.read_text()==environment
        for key,dest in target.items():assert dest.read_bytes()==(base/key).read_bytes()

    code,out=run('--inspect')
    assert code==0 and 'PREFLIGHT_PASS' in out,out
    old_integrity()
    assert not dockerlog.exists() or 'restart' not in dockerlog.read_text()
    print('AUTO_SIM_READ_ONLY_PREFLIGHT_PASS')

    code,out=run('--install',session=True)
    assert code==2 and 'ACTIVE_TASK_MUST_FINISH_FIRST' in out,out
    old_integrity()
    print('AUTO_SIM_ACTIVE_SESSION_DENIED_PASS')

    code,out=run('--install')
    assert code==0 and 'AUTO_BROWSER_READY' in out,out
    new_integrity()
    assert dockerlog.read_text().count('restart cloud-sandbox-mcp')==1
    print('AUTO_SIM_ONE_COMMAND_INSTALL_AND_ALL_29_TOOLS_PASS')

    code,out=run('--install')
    assert code==0 and 'ALREADY_INSTALLED' in out,out
    new_integrity()
    assert dockerlog.read_text().count('restart cloud-sandbox-mcp')==1
    print('AUTO_SIM_IDEMPOTENT_REINSTALL_PASS')

    for key in target:shutil.copyfile(original[key],target[key])
    code,out=run('--install',fail=True)
    assert code==2 and 'ROLLBACK_VERIFIED' in out,out
    old_integrity()
    print('AUTO_SIM_INJECTED_FAILURE_ROLLBACK_TO_28_TOOLS_PASS')
    assert not any('restart cloud-sandbox-dev-main' in line for line in dockerlog.read_text().splitlines())
    assert all('kickstart -k gui/' in x or 'print gui/' in x for x in launchlog.read_text().splitlines())
    print('AUTO_SIM_NO_DEVMAIN_NO_BROWSER_PROFILE_CHANGES_PASS')
