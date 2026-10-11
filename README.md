# Cloud Sandbox MCP 0.2.0 — Workstation Mode

A private MCP server that gives ChatGPT a persistent, VM-like Linux engineering workstation inside Docker.

Each workspace has:

- root access and `apt-get`;
- Node.js 22, npm/corepack, Python 3, pip/venv, and `uv`;
- Chromium and Playwright-compatible browser runtime;
- a private nested Docker daemon with Docker Compose;
- persistent repository, home directory, caches, cloud CLI configuration, and nested Docker state;
- Git operations, tests, builds, services, databases, and local Kubernetes tooling through the terminal;
- no host Docker socket inside the workstation.

The outer MCP controller still uses the host Docker socket to create and manage workstation containers. The workstation receives a private Docker daemon, not the host socket.

## Upgrade from 0.1.x

```bash
cd ~/Downloads
unzip cloud-sandbox-mcp-v0.2.0-workstation.zip
cd cloud-sandbox-mcp-v0.2.0-workstation
cp ../cloud-sandbox-mcp-v0.1.3/.env .env
./scripts/setup.sh
./scripts/upgrade-workspaces.sh
```

The upgrade script preserves every workspace's:

- `repo/`
- `home/`
- new `docker/` data directory

It replaces only the runtime container.

## Verify the workstation

From ChatGPT, run in a workspace:

```bash
id
node --version
python3 --version
uv --version
docker version
docker compose version
apt-get update
```

Then validate nested services:

```bash
docker run -d --name smoke-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16

docker ps
```

## Persistence

For workspace `<id>`:

```text
$HOST_DATA_DIR/workspaces/<id>/repo    -> /workspace
$HOST_DATA_DIR/workspaces/<id>/home    -> /home/agent
$HOST_DATA_DIR/workspaces/<id>/docker  -> /var/lib/docker
```

Cloud credentials and CLI state survive recreation when stored under `/home/agent`, including:

```text
/home/agent/.aws
/home/agent/.azure
/home/agent/.config/gcloud
/home/agent/.kube
/home/agent/.cache
/home/agent/.local
```

## Git push

Push remains a dedicated audited MCP tool. To enable it:

```dotenv
ENABLE_GIT_PUSH=true
GITHUB_TOKEN=<short-lived-token>
```

Then recreate the MCP controller:

```bash
docker compose --env-file .env up -d --force-recreate mcp
```

Do not put the GitHub token inside a workstation. The controller injects it only into the host-side push process.

## Security boundary

Workstation mode is intentionally powerful. The container is privileged because nested Docker requires it. The security boundary is the workstation container plus its dedicated mounted directories—not command-level restrictions inside the workstation.

It does **not** mount:

- the host Docker socket;
- arbitrary host directories;
- the MCP controller's secrets;
- the macOS filesystem.

Use this mode on a dedicated Docker Desktop context or, later, move the same image to a dedicated VM for stronger isolation.

## Main tools

The existing MCP tools remain compatible. Version 0.2.0 adds `workspace_recreate_runtime`, which replaces a runtime while preserving its persistent state.

## Native macOS Computer Use (Chrome and Microsoft Edge)

Cloud Sandbox MCP V2 now includes optional first-party `computer_use_*` MCP tools. The controller communicates with a small, authenticated macOS user-session bridge in this same repository. It uses macOS Automation/Accessibility to operate the user's **already-open** browser windows, rather than starting a new browser or exposing the Chrome DevTools port to Docker.

The five tools are: `computer_use_status`, `computer_use_state`, `computer_use_focus`, `computer_use_screenshot`, and `computer_use_action`.

### Enable on the Mac running Docker Desktop

After checking out this revision of the MCP server **on the Mac host**:

```bash
node scripts/enable-computer-use.mjs
# Review COMPUTER_USE_ALLOWED_ORIGINS in .env and remove unwanted domains.
./scripts/setup.sh
```

The setup script installs a passive per-user launchd service from `mac-host/bridge.mjs` when `COMPUTER_USE_ENABLED=true`. The controller alone receives the private bridge token; workstation containers do not. The Mac and MCP service share the same `.env` from this checkout. The host component does not create a new Docker container or execute arbitrary scripts sent by an agent.

Reconnect the MCP client after deploying so it discovers the new tools. On first use, macOS may ask for Automation, Accessibility and Screen Recording permissions. Approve permissions only for the host service you trust; never bypass macOS permission or login prompts.

For an initial **read-only smoke test**: call `computer_use_status`, then `computer_use_state` with `browser=edge`, identify an allowed Microsoft 365 tab and take a screenshot. Do not assign licenses, change email accounts or DNS during the test.

**Security rules:** Only HTTPS origins in `COMPUTER_USE_ALLOWED_ORIGINS` can be targeted; query/fragment values are stripped from discovered URLs; actions are verified against the current target and always require a native local confirmation on the Mac. A `reason` parameter is not itself approval. Missing permissions, stale tabs, or unavailable host services fail closed. Do not expose the host port or raw CDP to the public internet.

### Disable

Set `COMPUTER_USE_ENABLED=false` in `.env`, recreate the controller, then unload the Mac LaunchAgent using `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.lch.cloud-sandbox.computer-use.plist`. The Linux workspace and other MCP tools remain independent.

The host UI smoke test cannot run in a Linux-only CI environment. Mac Automation permissions and tab AppleScript compatibility must be checked on the real Mac.


## Computer Use Runtime V2

This branch adds persistent, attach-only Chrome/Edge providers (CDP or native Playwright protocol), opaque tab handles, exact role/label/test-id actions, revision checks, delegated sessions, bounded replay suppression, and private structured audit receipts. Native Computer Use remains operational when the persistent provider is not configured.

See [implementation contract](docs/computer-use-v2/SPEC.md), [operator runbook](docs/computer-use-v2/OPERATIONS.md), and [readiness review](docs/computer-use-v2/READINESS.md). Isolated real-browser checks run with `npm run verify:v2` on Linux; no logged-in Mac profile is used.

A clean release is built with `node scripts/build-browser-runtime-release.mjs /new/output/directory` and verified using `node scripts/verify-browser-runtime-release.mjs /same/output/directory`. Its customized registry preserves 23 existing tools and adds 5 (28 total). Operator preflight is mandatory; the release does not automatically provision the browser extension/debugging endpoint or silently retain old controller-image dependencies.
