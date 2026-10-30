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

## LCH root + every HTTPS subdomain (Chrome and Edge)

The separately packaged LCH update adds two allowlist entries:

- Root: **https://lch-app.cloud**
- Dot-bounded subdomains: **https://*.lch-app.cloud**

It covers **luma.lch-app.cloud**, **meridian.lch-app.cloud**, any nested
subdomains and future HTTPS hosts under this domain. The wildcard never
matches **evillch-app.cloud**, **evil-lch-app.cloud**,
**lch-app.cloud.evil.example**, HTTP origins, userinfo-bearing URLs, or
arbitrary nondefault ports. It does not grant access to external LinkedIn
subdomains. Existing exact-origin entries, including
**https://www.linkedin.com** when configured, are preserved.

Unlike an exact-origin change, a wildcard requires a guarded source update
because both the native Mac driver and the persistent Playwright/CDP driver
used exact string membership. The release installs an auditable origin-policy
helper module, modifies only known matching sites in the Bridge and Browser
Runtime source, and adds a safe wildcard-enabled flag to both status APIs.
The Mac version/shape guards reject unfamiliar modifications rather than
overwriting another agent's changes.

### Operator one-shot installation

Run on your **Mac Terminal**:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/allowed-origins/install-lch-wildcard-on-mac.mjs" --activate

Use **--inspect** instead for a no-change preflight. The installer works
whether or not LinkedIn was already added. It explicitly keeps the current
Chrome/Edge authentication and the existing 30-minute, unlimited-action,
20-second Edu notice policy.

**Required gates:** authenticated running Bridge, matching count of current
exact origins, correct trusted allowlist policy, Mac-owned safe configuration,
known Bridge and runtime source patterns, parseable JavaScript release and
**no active delegated session**. Only the Bridge LaunchAgent is restarted,
not Chrome/Edge or the controller container.

The installer saves private copies of the previous Compose .env, Bridge,
Browser Runtime and any existing origin helper under
the private ~/Library/Application Support/LCH/CloudSandboxBackups/ directory.
On failure it restores files and tries to restart the previous Bridge.
No credentials are logged. On success, it verifies:

    ACTIVATED=PASS
    BRIDGE_HEALTH=PASS
    APEX_ALLOWED=YES
    SUBDOMAIN_PATTERN_ACTIVE=YES
    ORIGINS_ACTIVE=<live count>

The actual status flags are independently checked on both native
/v1/status and Browser Runtime /v2/browser/status:
lch_app_cloud_wildcard_enabled=true. A successful local Git commit is
not proof of Mac activation. If the operator already installed both code
and settings, re-running is idempotent and does not restart the Bridge.

**Security scope:** This intentionally authorizes *all* valid HTTPS
subdomains under lch-app.cloud, including future ones. Limit creation of
subdomains and regularly audit dangling CNAME/DNS host configurations:
a subdomain takeover would inherit the broad action authority. Delegated
sessions still require a user-authorized task and remain scoped to one
browser. A screenshot/click passing does not prove the business outcome,
and this rule does not authorize unsolicited posting, billing or deployment.

## UiPath and Atlassian wildcard authorization

The same one-shot wildcard release also adds these four HTTPS entries:
- https://cloud.uipath.com
- https://*.cloud.uipath.com
- https://atlassian.net
- https://*.atlassian.net

The apex and subdomains are separate entries. They authorize exact HTTPS
hostnames and arbitrarily deep, valid DNS subdomains only, without permitting
similar suffixes or arbitrary ports. The existing LCH, LinkedIn and other
origins stay unchanged. Both Edge and Chrome use the same allowlist and
continue to require an authorized browser-scoped delegated session.

Use the same Mac operator command:
    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/allowed-origins/install-lch-wildcard-on-mac.mjs" --activate

The installer accepts the previously released, verified LCH helper by
SHA-256 and upgrades it in place. It also supports the case in which the
earlier LCH wildcard upgrade has not yet been installed. It validates
and backs up the existing configuration before changing anything, checks
that no delegation is active, restarts only the Mac Bridge service,
and rolls back on failure.

## LinkedIn wildcard

Authorize https://www.linkedin.com plus https://*.linkedin.com for both Chrome and Edge. DNS-label boundary checks reject lookalikes, HTTP and nondefault ports. Apply with install-lch-wildcard-on-mac.mjs --activate.

## HCL iTime exact origin

The operator-requested HCL iTime URL is under the exact origin
https://wf24.myhcl.com. The existing installer now adds only that
HTTPS origin for Chrome and Edge. The path /iTime/ngiTime/home is
covered by origin matching; no unrelated myhcl.com subdomains are allowed.

## UiPath staging

Allow the exact origin https://staging.uipath.com in Chrome and Edge. This does not grant arbitrary uipath.com subdomains. The same guarded installer activates the addition without dropping earlier permissions.

## Microsoft Outlook and Copilot exact origins

The installer adds https://outlook.cloud.microsoft and https://copilot.cloud.microsoft as exact HTTPS origins for Chrome and Edge. URL paths/query strings are not copied into the allowlist. Existing origins are preserved; other cloud.microsoft subdomains are not included.

## Sandbox V3: self-service exact HTTPS origins (no per-domain release)

For **Power Platform Admin Center**, authorize the exact origin:

    https://admin.powerplatform.microsoft.com

This origin is also included in the legacy base installer, but the preferred
operator path is the **general-purpose Mac origin manager**. It accepts any
reasonable public HTTPS URL, extracts the exact origin (discarding paths,
queries and fragments without logging them), and adds it without modifying
source code or releasing a new Bridge version. It preserves previously
approved origins and the existing four reviewed wildcard rules.

Once, optionally register a short Terminal command from the trusted shared
handoff (does NOT modify the existing sandbox V3 CLI). This action copies
a reviewed version into a **Mac-private pinned directory** under
~/.local/share/sandbox-v3-origins/v1 (mode 0700) and installs only a new
~/.local/bin/sandbox-origins shortcut. Subsequent operations use the private
snapshot, **not** a mutable shared script. Existing shortcuts or installed
code with unknown changes are never overwritten. A later manager upgrade
requires a separately reviewed new version:

    node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/allowed-origins/manage-on-mac.mjs" install-cli

Then operate from macOS Terminal:

    sandbox-origins add https://admin.powerplatform.microsoft.com
    sandbox-origins check https://admin.powerplatform.microsoft.com
    sandbox-origins list
    sandbox-origins remove https://admin.powerplatform.microsoft.com

Without the shortcut, run the identical manager using its full node path
and add, check, list, or remove arguments.

**Important gates that remain:** only an explicit user/operator invocation
can mutate the Mac configuration. The manager rejects non-HTTPS, wildcard
grants, credentials, ports, malformed DNS hostnames, reserved local/TLD
destinations, duplicate or conflicting settings and more than 50 origins.
Adding an origin already covered by an approved wildcard is idempotent.
Removing an exact rule while an existing wildcard still authorizes the
target is refused rather than reporting a false revocation.

**No disruption policy:** requires the known running controller and Bridge,
reads both native and browser-runtime policies and their origin counts,
refuses changes while a delegated browser session is active, guards
concurrent writes, makes a private backup, updates only the controller's
COMPUTER_USE_ALLOWED_ORIGINS value, and restarts **only the Mac Bridge
LaunchAgent**. Chrome, Edge, browser profiles, Docker controller, dev-main
and Cloudflare Tunnel are never restarted. After restart, verifies both
Bridge endpoints, counts, origin read-back and security policy. Failure
triggers a rollback from the private backup. A receipt is saved on Mac
without credentials or private URL query parameters.

This is an **operator authorization workflow**, not a blanket auto-approval
for arbitrary agents or a substitute for per-task browser delegation.
It does not bypass Graph Harness GH04/GH05, identity/access checks, or
business-level acceptance of web actions. An installed tool is not a
verified live allowance until the Mac command reports ACTIVATED=PASS
and BRIDGE_HEALTH=PASS, or PASS_ALREADY_ALLOWED for an already active
origin. If an agent's session is active, finish it before retrying.

Mac Bridge configuration and private backups remain on the operator's Mac.
Sandbox V3 and V2 may share the same Mac Bridge, but a connected Linux
workstation cannot by itself claim host-side activation.
