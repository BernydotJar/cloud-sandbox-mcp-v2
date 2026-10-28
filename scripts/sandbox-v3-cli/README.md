# Sandbox V3 — canonical Mac Terminal command

**Default command:** sandbox

**Primary ChatGPT connector:** Sandbox V3
(plugin reference: dev-6adf0fa9480c819180441f38fcf6b37c).

**Legacy connector:** Cloud Sandbox MCP V2
(plugin reference: dev-6a63d6a94d9c8191a0980859460d6ee4).
Do not select by default. It failed a read-only connection check with
HTTP 403 through its old ngrok-free.dev endpoint on 2026-10-27.

## What this fixes

The historical repository root start-all.sh starts an old three-workstation
ngrok environment. It must NOT be invoked by the canonical sandbox command.
The modern backend is the existing Docker controller named
cloud-sandbox-mcp and SINGLE persistent workstation cloud-sandbox-dev-main.
Both are already registered and accessible by the Sandbox V3 ChatGPT plugin.
This feature does not create a new workstation, clone a repository or
duplicate persistent Docker data.

The old on-Mac CLI path was documented as:

    ~/.local/bin/sandbox
        -> ~/.local/share/cloud-sandbox/start-all.sh

The actual user-local CLI is not mounted inside the Linux workstation.
Consequently, this release does NOT claim it modified that Mac path.
Its guarded installer performs the migration locally on the Mac after
the operator executes the --activate action. The original command is
moved to a timestamped backup in the SAME ~/.local/bin directory, and
can be restored via --rollback. No old startup code is executed.

## One-time activation on the operator Mac

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-primary-cli-20261027"

    node "$BASE/install-on-mac.mjs" --inspect
    node "$BASE/install-on-mac.mjs" --activate
    whence -v sandbox
    sandbox status
    sandbox

The installer verifies every SHA-256 in its release before mutation,
checks the existing sandbox file type, rejects unknown binaries and
unexpected ownership, preserves the prior executable/symlink, installs
an executable Node entrypoint, and verifies that the sandbox command
resolves to the new V3 CLI. It does not touch login tokens, plugins,
Docker, Caddy, Cloudflare, Chrome/Edge or the Mac AX service.

If "whence -v sandbox" reports a shell function or alias instead of
~/.local/bin/sandbox, the shell definition may shadow the installed
binary. Inspect that definition first rather than changing arbitrary
shell startup files automatically. Also ensure ~/.local/bin is in PATH.

## Canonical command contract

    sandbox             # starts/validates existing controller + dev-main
    sandbox start       # same as no argument
    sandbox status      # read-only Docker/container and MCP health checks
    sandbox doctor      # local CLI/controller/workstation diagnostics
    sandbox --help      # usage (no Docker or Mac required)

The entrypoint starts Docker Desktop only if the engine is not running,
and starts the EXISTING named containers only if they are stopped.
Before any start it refuses to proceed unless BOTH expected containers
already exist. It checks exact identity, container state and the MCP
controller's existing /healthz endpoint without accessing secrets.
There is NO docker compose up, new container/checkout, VM, prune,
Docker data reset, ngrok execution, login prompt or browser restart.

It does not restart the existing Cloudflare Tunnel, Caddy, Bridge or
macOS AX service. If those separately managed services are down, use
their own existing verified host supervision; do not launch a second
tunnel. A local healthy controller is not proof that the ChatGPT remote
plugin is reachable: validate via Sandbox V3 workspace_list or
computer_use_status when connected.

## Rollback

To restore the old user-local command (without running it):

    node "$BASE/install-on-mac.mjs" --rollback

The installer restores the exact original executable or symbolic link.
It does not remove the V3 package, touch the working containers, or
uninstall the legacy ChatGPT plugin.

## Agent routing priority

1. Use Sandbox V3 tools: mcp__Sandbox_V3__workspace_exec,
   workspace_list, workspace_status and project-specific tools.
2. Reuse the existing cloud-sandbox-dev-main, root/Docker and shared
   persistent /workspace and /shared-auth.
3. Use older Cloud Sandbox MCP V2 only if the user explicitly requests
   a legacy-specific diagnostic or compatibility operation.
4. Do not call V2 merely because the repo still has the historical
   name cloud-sandbox-mcp-v2. That is a Git checkout path, not a
   reason to select the old ChatGPT plugin.

Changing a command on macOS does NOT edit ChatGPT's connected plugin
list or globally reorder plugins. The shared AGENTS.md guidance and
the operator's conversation preference make V3 the expected default
for agents that load that policy. The old plugin remains available as
an explicitly selected compatibility option, not an automatic fallback.
