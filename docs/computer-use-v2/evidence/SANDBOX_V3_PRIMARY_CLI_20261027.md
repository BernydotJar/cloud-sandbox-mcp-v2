# Sandbox V3 primary CLI & connector — rollout evidence

Date: 2026-10-27

## Operator intent

The Mac shell command must be sandbox, with no version suffix.
It must target the currently deployed Sandbox V3 connector/runtime.
Sandbox V3 ChatGPT plugin must be preferred over legacy Cloud
Sandbox MCP V2. Preserve single workstation, root, Docker,
shared storage, Browser Bridge and user sessions.

## Live connector evidence

- Sandbox V3 workspace_list: PASS. Reported existing running
  cloud-sandbox-dev-main runtime, shared runtime workspace ID
  6544ba3e-e124-4ca5-adc7-62c6dd47ba86 and current projects.
- Legacy Cloud Sandbox MCP V2 computer_use_status: HTTP 403,
  transport probe failed from its ngrok-free.dev endpoint.
  This does not establish the legacy endpoint is permanently
  unavailable; it is not the default connector.
- Historical root start-all.sh: old ngrok URL and three
  UUID-named workstation containers. It is preserved, but
  deliberately not called from the new launcher.
- The actual macOS ~/.local/bin/sandbox file is NOT mounted in Linux.
  Its runtime replacement cannot be claimed until the Mac-side
  release installer executes.

## Implemented

- scripts/sandbox-v3-cli/cli.mjs:
  sandbox defaults to start, status and doctor are read-only.
  Starts only existing cloud-sandbox-mcp and cloud-sandbox-dev-main;
  requires both to exist, checks container identity, health and
  existing MCP /healthz. May open installed Docker Desktop if stopped.
  Does not run ngrok, compose up, create or prune anything, restart
  browsers or redefine the Cloudflare tunnel.
- scripts/sandbox-v3-cli/install-on-mac.mjs:
  SHA-verified release, guarded single-path migration, keeps exact
  original shell script or symlink as timestamped backup in its
  original ~/.local/bin directory, idempotency and rollback.
- scripts/sandbox-v3-cli/README.md:
  activation, status, verification and rollback.
- Repo AGENTS.md and shared /workspace/AGENTS.md:
  prefer tools.mcp__Sandbox_V3__* over legacy V2 by default.
  The repo name cloud-sandbox-mcp-v2 remains historical.
- README and Terminal Sandbox contract updated with current policy.

## Validated in Linux runtime

- npm run verify: PASS
- Vitest: 8/8 suites
- Mac/Bridge: 236 pass, 1 skipped Mac-only
- Browser policy: 49 pass
- Isolated worker historical tests: 19 pass
- Same-Mac AX tests: 22 pass
- New V3 CLI: 10 pass
- TypeScript, ESLint and build: PASS
- git diff --check: PASS

## Pending macOS acceptance

1. Run the Mac release --inspect to identify existing CLI type
   without invoking its old script.
2. Run --activate once. Verify the exact link and retained backup.
3. Run whence -v sandbox; confirm it is the new file, not a
   shell alias/function.
4. Run sandbox status, then sandbox; confirm controller,
   dev-main and /healthz are green without any new workspace.
5. Independently confirm Sandbox V3 ChatGPT tool connection.
6. Optional rollback is --rollback; legacy ChatGPT plugin remains
   installed unless the operator explicitly chooses removal.

The CLI only manages the existing local Docker controller/workstation.
It does not change ChatGPT's plugin preference settings and does not
guarantee the external V3 endpoint if the pre-existing tunnel is down.
No Mac CLI modification has been performed by this Linux-only session.
