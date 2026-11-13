#!/usr/bin/env python3
"""Read-only Mac bootstrap simulation. No real browser, daemon or Mac access."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
source = repo / "deploy/browser-channel-providers"
baseline = repo / "deploy/browser-channel-providers/baseline-connection-pool.fixture"

with tempfile.TemporaryDirectory(prefix="browser-channels-sim-") as td:
    base = Path(td)
    home, release, working, bin_dir = (base / x for x in ("home", "release", "working", "bin"))
    for d in (home, release, working, bin_dir):
        d.mkdir(parents=True)
    conn = home / "Library/Application Support/LCH/CloudSandboxComputerUse/browser-runtime/connection-pool.mjs"
    conn.parent.mkdir(parents=True)
    shutil.copyfile(baseline, conn)
    for name in ("provider-config.mjs", "install-on-mac.mjs"):
        shutil.copyfile(source / name, release / name)
    shutil.copyfile(repo / "mac-host/browser-runtime/connection-pool.mjs", release / "connection-pool.mjs")
    test_install = release / "install-on-mac.mjs"
    test_install.write_text(test_install.read_text().replace(
        "'/bin/launchctl'", "process.env.MOCK_LAUNCHCTL"
    ))
    launchctl = bin_dir / "launchctl"
    launchctl.write_text("#!/bin/sh\necho \"$@\" >> \"$MOCK_LAUNCHCTL_LOG\"\n")
    launchctl.chmod(0o755)
    env_file = working / ".env"
    initial = "COMPUTER_USE_ENABLED=true\nCOMPUTER_USE_BROWSER_V2=true\nCOMPUTER_USE_BRIDGE_TOKEN=" + "a" * 48 + "\n"
    env_file.write_text(initial)
    env_file.chmod(0o600)
    def reset():
        env_file.write_text(initial)
        env_file.chmod(0o600)
        shutil.copyfile(baseline, conn)
    docker = bin_dir / "docker"
    docker.write_text(
        "#!/bin/sh\n"
        "[ \"$1\" = inspect ] || exit 2\n"
        "printf '[{\"State\":{\"Running\":true},\"Config\":{\"Labels\":{\"com.docker.compose.service\":\"mcp\",\"com.docker.compose.project.working_dir\":\"%s\"}}}]' \"$MOCK_WORKING\"\n"
    )
    docker.chmod(0o755)
    driver = base / "driver.mjs"
    driver.write_text("""
import fs from 'node:fs';
Object.defineProperty(process,'platform',{value:'darwin'});
globalThis.fetch=async (url,options={})=>{
  const str=String(url);
  const input=JSON.parse(options.body||'{}');
  const isStatus=str.endsWith('/v1/status');
  const configured=fs.readFileSync(process.env.MOCK_ENV,'utf8').includes('COMPUTER_USE_EDGE_ENDPOINT=msedge');
  let data={};
  if(isStatus)data={delegated_session:{active:process.env.MOCK_ACTIVE==='1'}};
  else if(str.endsWith('/v2/browser/status')){
    data={enabled:true,version:'2.0.0',providers:configured?[
       {browser:'chrome',protocol:'cdp',configured:true},
       {browser:'edge',protocol:'cdp',configured:true}]:[]};
  }else if(str.endsWith('/v1/state')){
    const urls=input.browser==='chrome'?
       ['https://luma.lch-app.cloud/learn','https://github.com/BernydotJar/LUMA']:
       ['https://admin.cloud.microsoft/','https://outlook.cloud.microsoft/mail/'];
    data={browsers:[{browser:input.browser,running:true,
       windows:[{tabs:urls.map(url=>({url}))}]}]};
  }else if(str.endsWith('/v2/browser/tabs')){
    if(process.env.MOCK_FAIL_EDGE==='1' && input.browser==='edge')
      return {ok:false,text:async()=>JSON.stringify({ok:false,error:'ATTACH_FAILED'})};
    data={browser:input.browser,tabs:[{tab_ref:'tab_'+('a'.repeat(32))}]};
  }
  return {ok:true,text:async()=>JSON.stringify({ok:true,data})};
};
process.argv=[process.execPath,process.env.MOCK_INSTALL,process.env.MOCK_MODE];
await import('file://'+process.env.MOCK_INSTALL);
""")
    markers = [
        home / "Library/Application Support/Google/Chrome/DevToolsActivePort",
        home / "Library/Application Support/Microsoft Edge/DevToolsActivePort"
    ]

    def invoke(active=False, mode="--inspect", fail_edge=False):
        environment = dict(os.environ)
        environment.update(
            HOME=str(home), PATH=str(bin_dir) + ":" + environment.get("PATH", ""),
            MOCK_WORKING=str(working), MOCK_INSTALL=str(release / "install-on-mac.mjs"),
            MOCK_MODE=mode, MOCK_ACTIVE="1" if active else "0",
            MOCK_LAUNCHCTL=str(launchctl), MOCK_ENV=str(env_file),
            MOCK_LAUNCHCTL_LOG=str(base / "launchctl.log"),
            MOCK_FAIL_EDGE="1" if fail_edge else "0"
        )
        p = subprocess.run(["node", str(driver)], env=environment,
                           capture_output=True, text=True, timeout=12)
        return p.returncode, p.stdout + p.stderr

    def unchanged():
        assert env_file.read_text() == initial
        assert conn.read_bytes() == baseline.read_bytes()

    code, out = invoke()
    assert code == 0, out
    assert "PREFLIGHT_HOLD" in out, out
    unchanged()
    print("CHANNEL_MAC_SIM_MISSING_DEBUGGING_NO_MUTATION_PASS")

    for marker in markers:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("42333\n/devtools/browser/test\n")
        marker.chmod(0o600)
    code, out = invoke()
    assert code == 0, out
    assert "PREFLIGHT_READY_TO_ATTACH" in out, out
    assert "CHROME_CHANNEL=READY" in out
    assert "EDGE_CHANNEL=READY" in out
    unchanged()
    print("CHANNEL_MAC_SIM_BOTH_READY_READ_ONLY_PASS")

    code, out = invoke(active=True)
    assert code == 2, out
    assert "ACTIVE_COMPUTER_USE_SESSION_STOP_FIRST" in out, out
    unchanged()
    print("CHANNEL_MAC_SIM_ACTIVE_TASK_PRESERVED_PASS")

    marker = markers[0]
    marker.write_text("broken\n")
    code, out = invoke()
    assert code == 0 and "PREFLIGHT_HOLD" in out, out
    assert "INVALID_OR_STALE_CHANNEL_MARKER" in out
    unchanged()
    print("CHANNEL_MAC_SIM_INVALID_MARKER_FAIL_CLOSED_PASS")

    marker.write_text("42333\n/devtools/browser/test\n")
    env_file.write_text(initial + "COMPUTER_USE_EDGE_ENDPOINT=http://127.0.0.1:9223\n")
    code, out = invoke()
    assert code == 2 and "PROVIDER_CONFIG_ALREADY_CUSTOMIZED" in out, out
    assert conn.read_bytes() == baseline.read_bytes()
    print("CHANNEL_MAC_SIM_UNKNOWN_CUSTOM_PROVIDER_REFUSED_PASS")

    # Complete fake macOS activation without touching any real browser/daemon.
    reset()
    fake_pkg = home / "Library/Application Support/LCH/CloudSandboxComputerUse/node_modules/playwright-core"
    fake_pkg.mkdir(parents=True, exist_ok=True)
    (fake_pkg / "package.json").write_text(json.dumps({"name": "playwright-core", "version": "1.64.0"}))
    (fake_pkg / "index.mjs").write_text("""
export const chromium={
 connectOverCDP:async channel=>({
   contexts:()=>[{pages:()=>[
      {url:()=>channel==='chrome'?'https://luma.lch-app.cloud/learn':'https://admin.cloud.microsoft/'},
      {url:()=>channel==='chrome'?'https://github.com/BernydotJar/LUMA':'https://outlook.cloud.microsoft/mail/'}
   ]}],
   close:async()=>{}
 })
};
""")
    code, out = invoke(mode="--activate")
    assert code == 0, out
    assert "BROWSER_CHANNEL_PROVIDERS_ACTIVE" in out, out
    assert "CHROME_EXISTING_PROFILE_VERIFIED" in out
    assert "EDGE_EXISTING_PROFILE_VERIFIED" in out
    assert "COMPUTER_USE_CHROME_ENDPOINT=chrome" in env_file.read_text()
    assert "COMPUTER_USE_EDGE_ENDPOINT=msedge" in env_file.read_text()
    assert conn.read_bytes() == (release / "connection-pool.mjs").read_bytes()
    assert "OTHER_SECRET=not_for_logs" not in out
    print("CHANNEL_MAC_SIM_ACTIVATION_AND_BOTH_TAB_PROVIDER_GATES_PASS")

    code, out = invoke(mode="--activate")
    assert code == 0 and "CHANNELS_ALREADY_CONFIGURED" in out, out
    print("CHANNEL_MAC_SIM_IDEMPOTENT_ACTIVATION_PASS")

    reset()
    code, out = invoke(mode="--activate", fail_edge=True)
    assert code == 2, out
    assert "VALIDATION_FAILED" in out, out
    assert "ROLLBACK_COMPLETE" in out, out
    unchanged()
    print("CHANNEL_MAC_SIM_FAILED_PROVIDER_POSTCHECK_ROLLBACK_PASS")

    history = (base / "launchctl.log").read_text()
    assert all("kickstart -k" in line or "print gui/" in line for line in history.splitlines())
    print("CHANNEL_MAC_SIM_NO_BROWSER_LAUNCH_AND_NO_DOCKER_MUTATION_PASS")
