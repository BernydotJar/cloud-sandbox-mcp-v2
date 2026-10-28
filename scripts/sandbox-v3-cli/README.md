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

## Retro system dashboard and public HTTPS checks (2026-10-27)

The default \`sandbox\` now displays the configured retro Cats/Jupiter
ASCII welcome followed by a compact status panel with a state-specific
face on EVERY row:

- \`😎\` healthy and independently confirmed
- \`👾\` failed, blocked, or returned an unexpected HTTP status
- \`🥸\` warning / noncritical availability issue
- \`🕵️\` not independently verifiable from this Mac

\`sandbox status\` displays the panel without the large welcome artwork.
The checks are read-only and independently report:

1. Docker Desktop daemon availability.
2. The existing \`cloud-sandbox-mcp\` container (no duplicates).
3. The existing \`cloud-sandbox-dev-main\` persistent workstation.
4. MCP controller's internal \`/healthz\`.
5. The known Cloudflare system LaunchDaemon.
6. Public HTTPS \`https://lch-app.cloud/health\` (HTTP 200 required).
7. Public HTTPS \`https://ido.lch-app.cloud/health\` (HTTP 200 required).
8. Native Mac Browser Bridge listener + authentication gate, using a
   token-free local POST (401 or 403 means the port is protected;
   it does NOT prove full authenticated browser automation).
9. The external ChatGPT Sandbox V3 connector: reported as NOT
   VERIFIED FROM MAC, never a fabricated local PASS.

The HTTPS checks run in parallel with a bounded 4.5-second request
timeout each. They require valid TLS and reject redirects and HTTP
errors as failures. They never use cookies, browser tabs or credentials
and do not change Cloudflare or Caddy routing. A running Cloudflare
process and a public HTTPS 200 are **separate checks**: neither alone
proves every configured route is healthy.

### Output options

    sandbox status           # attractive terminal status dashboard
    sandbox status --plain   # stable key=value-ish diagnostic rows
    sandbox status --json    # source-backed structured status for agents
    sandbox doctor           # verbose diagnostic + dashboard
    sandbox                  # retro welcome + actual component checks

On an interactive Mac Terminal, status faces display as colorful
emojis; a non-TTY terminal, or NO_EMOJI=1, uses ASCII status markers
like [OK], [!!], [?!], [??]. NO_COLOR disables ANSI terminal colors.
The layout is compact on narrow terminals.

A failing critical component or public endpoint returns nonzero
exit code and is marked visibly as degraded. Bridge unavailability
is advisory because the main Sandbox MCP can work without macOS
browser automation. The ChatGPT connector cannot be tested by a local
terminal process and remains an explicit external check.

Already-installed V3 users continue to use the same guarded
\`install-on-mac.mjs --upgrade\` action from this release. It validates
and installs the new \`health.mjs\` as a SHA-256-protected dependency
alongside the CLI while preserving the original V2 launcher backup
and the previous V3 executable.

## Existing installation hotfix: symlink entrypoint + retro ASCII (2026-10-27)

The initial Mac activation reported RESULT=ACTIVATED and the Terminal
resolved sandbox to ~/.local/bin/sandbox. But invoking sandbox returned
instantly with no output. We reproduced this via node <symlink> --help:
the CLI compared the unresolved symbolic-link argv path with the real
ESM module file, so main() never ran. The corrected entrypoint uses
fs.realpathSync for both paths.

The default sandbox screen is Cosmic Cats, a retro 1980s ASCII starfield
with pink/cyan color in interactive terminals. The alternate Jupiter
theme uses amber/cyan styling. Both work on narrow terminals, and use
plain ASCII with no colors when NO_COLOR is set.

If Sandbox V3 is ALREADY installed on the Mac, run the guarded UPGRADE
rather than another activation or a rollback:

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-primary-cli-20261027"
    node "$BASE/install-on-mac.mjs" --upgrade
    sandbox

The upgrader verifies the previous installed SHA-256 against the private
install record and validates the new release. It preserves the original
legacy CLI backup, makes an additional backup of the previous V3 CLI,
installs the corrected executable and ASCII artwork, and updates the
install record. It does not start Docker, restart the Browser Bridge,
change macOS permissions or modify browser sessions.

### 80s retro terminal options

    sandbox                   # Cosmic Cats intro + start V3
    sandbox art cats          # preview cats without Docker
    sandbox art jupiter       # preview Jupiter without Docker
    sandbox theme jupiter     # persist Jupiter for future startups
    sandbox theme cats        # restore the Cosmic Cats default
    sandbox jupiter           # start once using Jupiter
    sandbox --no-art          # start without graphics (automation)
    sandbox status            # read-only: Docker, controller and Cloudflare launchd

Theme preferences are privately stored in
~/.local/share/sandbox-v3/theme.json. The banner appears before
Docker checks, so a startup problem cannot silently return control
without any output. Actual Mac upgrade and visual acceptance remain
pending until the on-Mac command has been executed.

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
Docker, Caddy, Cloudflare, Chrome/Edge or the Mac AX service **during CLI installation**.

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

The `sandbox` command now also supervises the existing Cloudflare
Tunnel on THIS Mac. It checks the known system LaunchDaemon
`system/com.cloud-sandbox.cloudflared` (historical alternative:
`system/com.cloudflare.cloudflared`) for the existing
`cloud-sandbox-mac` tunnel. If the daemon is already running, it does
**nothing** to it. If it is registered but stopped, it starts that
LaunchDaemon via `launchctl kickstart` **without -k**, preserving any
running process. If the service is not loaded, it can bootstrap the
same pre-existing root-owned verified LaunchDaemon plist. No second
tunnel, route changes, DNS mutation, certificate change or new Cloudflare
credentials are created. A one-time macOS admin password may be requested
by `sudo` ONLY if a system-wide Cloudflare LaunchDaemon needs recovery.

`sandbox status` and `sandbox doctor` inspect the Cloudflare
LaunchDaemon without making changes. Output distinguishes
`CLOUDFLARE_LAUNCHD=RUNNING` from
`CLOUDFLARE_NETWORK_HEALTH=NOT_PROBED`: a running daemon is NOT
end-to-end HTTPS proof. A local healthy controller is likewise not
proof of external ChatGPT plugin reachability.

The existing Caddy, Mac Browser Bridge, AX service and Cloudflare tunnel
config remain under their own supervisors. This command does not restart
them when healthy, reconfigure the tunnel, or change the ChatGPT connector
selection. If the Cloudflare plist is missing or untrusted, it stops with
an actionable error rather than generating a new tunnel.

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
