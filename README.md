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
