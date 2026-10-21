# Add LinkedIn to Mac Bridge allowed action origins

**Scope:** Add the single exact origin `https://www.linkedin.com` to the
existing Mac Bridge allowlist for authenticated browser mutations. The current
Bridge implementation shares `COMPUTER_USE_ALLOWED_ORIGINS` across **Chrome
and Edge**, so the action permission applies to both (while delegated
sessions remain scoped to one browser). This does **not** authorize LinkedIn
subdomains, `https://linkedin.com`, arbitrary URLs, or publication without
a user-requested task.

The update does not change browser routing, CDP endpoints, existing profiles,
automation credentials, or the 30-minute unlimited-actions trusted-session
policy.

## One-shot activation on the operator's Mac

```sh
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/allowed-origins/install-linkedin-on-mac.mjs" --activate
```

Read-only preflight: replace `--activate` with `--inspect`.

The script locates the Mac Compose `.env` from the existing running
`cloud-sandbox-mcp` container's label, validates the existing exact HTTPS
allowlist, and appends **only** the requested origin to the
`COMPUTER_USE_ALLOWED_ORIGINS` setting. It supports unquoted, single-quoted
and double-quoted values, retaining newline conventions and unrelated
configuration bytes. It does not print tokens, any unrelated origins, or
other secrets.

Activation is allowed only if:

- The controller and existing Bridge are running and authenticated.
- The Bridge reports `mutation_policy=allowlist_only`,
  `trusted_delegation_notice.enabled=true`, maximum 30 minutes and
  unlimited actions.
- The origin count in the live Bridge matches the local configuration.
- There is no active delegated Computer Use session.
- The live Compose configuration has not changed since preflight.

For a missing origin, it creates a private backup of the **original entire
`.env`** in the operator's
`~/Library/Application Support/LCH/CloudSandboxBackups/` directory,
atomically modifies the original file, and restarts **only** the existing
Mac Bridge LaunchAgent using `launchctl kickstart`. No Chrome or Edge
window is opened or restarted. The operator sees:

```text
[LinkedIn Bridge Origin] TARGET_ORIGIN=https://www.linkedin.com
[LinkedIn Bridge Origin] ORIGINS_BEFORE=6
[LinkedIn Bridge Origin] ORIGINS_AFTER=7
[LinkedIn Bridge Origin] ACTIVATED=PASS
[LinkedIn Bridge Origin] BRIDGE_HEALTH=PASS
```

The counts are illustrative: actual values are determined at runtime.

The script checks both the persisted LinkedIn value and the live Bridge
status/count after restarting. On failure, it restores the saved original
configuration and restarts the prior Bridge. If LinkedIn was already present,
it reports `PASS_ALREADY_ALLOWED` and **does not restart** anything.

The Mac operator's action is necessary because the persistent Linux
workstation does not have direct access to the Mac's private Compose
`.env` or LaunchAgent configuration. Creating this release inside Linux
alone does not update the installed Bridge.

### Regression coverage

`node --test deploy/allowed-origins/*.node-test.mjs` verifies origin
canonicalization, idempotence, quoted/CRLF configuration, preservation
of other variables, unsafe origin rejection and the installer gates.

The general Mac Bridge tests also verify that a task-scoped **Chrome**
action targeting `https://www.linkedin.com/feed/` passes an exact-origin
check while `linkedin.com`, `business.linkedin.com`, and lookalike
origins are rejected without dispatch.

Note: allowing an origin is not the same as authorizing every business
transaction. Publishing a LinkedIn post still requires the user's explicit
task authorization, an active delegated session, and independent
verification of the resulting post.
