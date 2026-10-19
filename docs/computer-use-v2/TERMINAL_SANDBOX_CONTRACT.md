# Terminal `sandbox` interoperability: Mac Bridge and agent policy

Status as of 2026-10-19: the Mac-hosted Cloud Sandbox Computer Use Bridge
is installed with `COMPUTER_USE_TRUSTED_SESSION_NOTICE=true`. A live
`computer_use_status` response in ChatGPT verified these settings:
`enabled=true`, `connected=true`, `trusted_delegation_notice.enabled=true`,
`max_minutes=30`, `unlimited_actions=true`, `max_actions=null`,
`seconds=20`, `closable=true`, `mutation_policy=allowlist_only`.
A real one-minute delegated Edge grant returned `approval_mode=configured_trust`
and `remaining_actions=null`; the grant was revoked at the end.

**What persists:** these settings are in the Mac Bridge service and are used
by *any client calling that very same Bridge through Cloud Sandbox MCP V2*.
They do not require retraining the model, repeating setup, or beginning a
new grant for read-only status queries. The dedicated Chrome login profile
is separate and optional. Browser-Driven QA remains Playwright headless
in the Linux workstation.

**What is not established:** neither the repository nor the Linux workstation
contains an installed shell command named `sandbox`. Prior notes mention
`sandbox -c` but **do not define its implementation or flags**. No one
should claim the Mac Terminal wrapper automatically connects to this MCP,
starts a browser, loads Linux `AGENTS.md`, or transfers authentication until
its actual Mac definition is inspected. The separate unofficial
`chatgpt-terminal-poc/gptchat.mjs` is NOT this `sandbox` command.

## Session bootstrap: agent contract

1. Read `/workspace/AGENTS.md` and the project instructions, and use
   Graph Harness Browser-Driven QA for project E2E. Claude CLI may read
   `CLAUDE.md`, Gemini CLI may read `GEMINI.md`; external Mac agents need
   an explicit link/instruction to this shared contract.
2. Call Cloud Sandbox MCP V2 `computer_use_status`, which is non-mutating.
   Before claiming the new UX, require `host.trusted_delegation_notice.enabled
   === true`, `max_minutes === 30`, `unlimited_actions === true`,
   `seconds === 20`, `host.mutation_policy === 'allowlist_only'`.
3. For ordinary local app E2E, use existing Playwright suites or an isolated
   headless Chromium. Do not touch Mac browser sessions.
4. Only for a user-authorized authenticated browser task use the relevant
   `browser_tabs` / `browser_inspect` tools. When a delegated grant is
   necessary, request `computer_use_session_begin` with one browser
   (`scope=chrome` or `scope=edge`), a task-specific purpose and a
   duration at most 30 minutes.
5. **Tool metadata compatibility:** currently published tool schemas may
   still require `max_actions` in the interval 1..200, and some tool descriptions
   may still claim one approval. Pass an in-schema value such as `120`
   for compatibility. The *live trusted Mac Bridge* ignores the action budget
   and returns `unlimited_actions=true` and `remaining_actions=null`.
   Do not confuse old tool text with the effective host policy. Keep
   the controller's registered metadata synchronized on a verified release,
   but do not restart a controller or Mac Bridge during someone else's session.
6. Use the returned session ID only for this task and browser; audit every
   permitted interaction, check domain allowlists, respect protected inputs,
   and verify post-action state. Do not bypass macOS permission prompts.
   Closing the 20-second 'Edu!' splash does NOT revoke a grant.
   Explicitly end *your* grant with `computer_use_session_end` at task completion.
   Never seize, revoke, or reuse another agent's active session.
7. Avoid pretending 'session connected' means UI tests passed. Browser
   identity, authorization, semantic interaction, evidence and business-level
   outcomes remain separate acceptance gates.

## Verify the Mac terminal command without modifying it

In an existing interactive macOS zsh terminal, run only:

```zsh
whence -v sandbox
```

This identifies whether `sandbox` is a shell alias, function or executable.
Review and redact credentials before sharing a command/alias body. If it is
a wrapper, inspect its source **read-only** to confirm which MCP endpoint it
uses, its `-c` behavior and whether it loads shared agent instructions.
Do **not** replace an unknown user-installed `sandbox` binary with a new
wrapper or change its shell startup automatically.

If `sandbox` uses a different MCP controller, a local-only code runner, a
separate browser or older settings, none of the Mac Bridge guarantees should
be assumed for that CLI. Porting requires explicit wiring and a live
`computer_use_status` handshake in that client.

## Persistence versus reinforcement

This is *configuration and software policy reuse*, not machine-learning
reinforcement. Updating `AGENTS.md` is a shared instruction for agents that
**actually load that file**; it does not rewrite other providers' prompts.
A local Git commit records changes but does not publish a new MCP controller
image or push GitHub by itself. Runtime health checks determine what is
**installed**, not what was merely edited in a repository.


## Read-only one-shot Mac CLI diagnostic

The shell command has now been identified by the operator as:
`/Users/eduardosacahui/.local/bin/sandbox`. It is **not mounted** inside
`cloud-sandbox-dev-main`; the Mac Bridge's read-only `computer_use_status`
does not expose arbitrary host files.

A shareable, no-deployment inspector is provided at
`scripts/terminal-sandbox/doctor.mjs`. It reads the Mac CLI file,
examines only structural references (MCP, Cloud Sandbox, bridge, `-c`,
shared agent instructions) and reads the *existing* Mac Bridge's
authenticated `/v1/status` without printing secrets. It **never invokes
`sandbox`**, does not launch a browser or change any file. Binary or
unrecognizable CLI wrappers are reported as inconclusive rather than
assuming integration. It cannot establish real terminal routing solely
from string matching.

On Mac:

```sh
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/terminal-sandbox-doctor.mjs"
```

Share that diagnostic's output (no credentials are printed). If it shows
MCP and Bridge integration references, we can verify the actual terminal
handshake next; if not, we can locate the CLI's underlying entrypoint
without touching the user's existing shell configuration.
