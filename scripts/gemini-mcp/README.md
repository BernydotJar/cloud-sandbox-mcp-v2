# Gemini CLI as an independent MCP client of Sandbox V3

This is **Option B**, not Gemini running inside the dev-main workstation.
Gemini CLI runs on the **operator Mac** and talks to the existing
`cloud-sandbox-mcp` Docker controller over local Streamable HTTP. The
`bridge.mjs` process only adapts Gemini's stdio MCP transport to the
existing authenticated MCP endpoint; it does **not** start a second controller,
workstation, Cloudflare tunnel, or clone of any project.

```text
Gemini CLI (Mac)
    -> stdio MCP bridge (Mac; allowlisted tools)
    -> http://127.0.0.1:<PORT>/mcp/<MCP_PATH_SECRET> (private Mac loopback)
    -> existing cloud-sandbox-mcp controller
    -> existing cloud-sandbox-dev-main persistent workstation
    -> /workspace/projects/...
```

The bridge reads `PORT` and `MCP_PATH_SECRET` from the **existing**
controller `.env` on every launch. Gemini settings store **only the path**
to that file and the bridge script, not the secret or full authenticated URL.
There is no new public endpoint, proxy route, OAuth client or credential.

## Mac installation (operator action; no install from Linux)

From the Mac checkout of `cloud-sandbox-mcp-v2` that holds the
**current controller** `.env`:

```bash
cd /path/to/cloud-sandbox-mcp-v2
node --version                           # Node 22+ recommended
npm ci --ignore-scripts                  # bridge SDK dependency
npm install -g @google/gemini-cli        # official Gemini CLI
sandbox status                           # existing service, never legacy start-all.sh
chmod 600 .env                           # owner-only existing controller file
node scripts/gemini-mcp/configure.mjs --check --profile developer
node scripts/gemini-mcp/configure.mjs --apply --profile developer
gemini mcp list
```

The script refuses to modify Gemini settings unless explicitly run with
`--apply`. It verifies the controller's **local** `/healthz`, checks that
the service identity is `cloud-sandbox-mcp`, preserves unrelated settings,
makes an owner-only backup when changing an existing config, and keeps
`~/.gemini/settings.json` owner-only. It will refuse to overwrite a different
`sandbox-v3` entry unless `--replace` is explicitly supplied.

The example above uses `developer` because the goal is to let Gemini
execute commands and modify code. For a safer initial read-only profile:

```bash
node scripts/gemini-mcp/configure.mjs --apply --profile read
```

To explicitly switch an existing `sandbox-v3` entry to developer:

```bash
node scripts/gemini-mcp/configure.mjs --apply --profile developer --replace
```

To remove the integration without touching other Gemini plugins:

```bash
node scripts/gemini-mcp/configure.mjs --remove
```

`--env-file /absolute/path/to/.env` may be supplied if the controller's
existing Mac `.env` is not in the same checkout as the setup script.

## Verify in Gemini CLI

```bash
gemini mcp list
gemini
```

Inside Gemini CLI run `/mcp`; the `sandbox-v3` server should be connected.
Ask Gemini to call `workspace_list`, then `workspace_status` on the
**existing** project ID. Only after both succeed, ask it to inspect the
appropriate repo via `file_read`. With the developer profile, test
`workspace_exec` using a non-mutating command like `pwd` before code changes.

If the CLI reports disconnected:

1. Check `sandbox status` and the existing controller `/healthz`.
2. Confirm Mac Node 22+ and repo `node_modules/@modelcontextprotocol/sdk`.
3. Confirm the Mac checkout's `.env` is a regular file owned by the Mac
   user with permissions `0600`.
4. Run the setup `--check` again. It will not print the secret.
5. For stdio MCP servers, Gemini CLI requires the calling directory to be
   trusted. Trust only the intended project directory.

## Security and concurrency

The `read` profile exposes `workspace_list`, `workspace_status`,
`file_read`, `git_diff` and `workspace_history`. The `developer`
profile additionally exposes `workspace_exec`, `file_write`,
`file_apply_patch`, `project_verify` and `git_commit`.

The bridge enforces this allowlist **server-side within its own process**
and also advertises it to Gemini's `includeTools`. It does not offer
`git_push`, `workspace_destroy`, `workspace_recreate_runtime` or Mac
Computer Use. Gemini is configured with `trust:false`, so do not turn on
unconditional tool-call approval.

**Critical trust caveat:** `workspace_exec` is a root shell inside the
shared workstation. Blocking the dedicated Git push/destroy tools does
not make the developer profile read-only, and this workstation is **not**
a strong multi-tenant boundary. Only run developer access with a trusted
Gemini session, review high-impact commands, and avoid editing the same
Git worktree concurrently from Gemini, ChatGPT, and Claude Code. Assign
separate worktrees/branches where concurrent agents need to develop.

Do not place the MCP secret or full authenticated path in prompts, logs,
Git, shell history or the Gemini settings file. Do not reconfigure
Cloudflare/Caddy or expose the Mac browser bridge ports for this setup.

## Verification of adapter source

From the existing Linux dev-main checkout (uses an in-process simulated
MCP controller; never reads the host secret or deploys anything):

```bash
node --test scripts/gemini-mcp/*.node-test.mjs
```

This proves the protocol adapter and allowlist against a mock endpoint.
A **live Mac-to-controller connection** must still be completed with
`gemini mcp list` and a read-only `workspace_list` invocation on the
operator Mac.
