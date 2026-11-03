# Mac Toshiba SSD: Docker direct-bind CREATE parity rehearsal

Status: PREPARED, NOT RUN ON MAC (2026-11-03)

## Grounded audit (actual user's Mac)

Previous user commands and direct audit returned:
  CONTROLLER_EXEC=PASS
  WORKSTATION_EXEC=PASS
  SSD_DIRECT_BIND=PASS
  RECUPERACION_OPERATIVA=PASS
  DIRECT_BIND_CONFIGURATION_AUDITED_NOT_CUTOVER

The original controller container is:
  cloud-sandbox-mcp
  image: cloud-sandbox-mcp-v020-workstation-mcp:mac-fixed
  normal project network: cloud-sandbox-mcp-v020-workstation_default
  port: 3000/tcp -> host port 3000
  restart: unless-stopped
  /data -> Mac source (to move to SSD)
  /app/dist -> Mac .../infra-v1/controller (KEEP read-only)
  /var/run/docker.sock -> /var/run/docker.sock (KEEP)

The worker:
  cloud-sandbox-dev-main
  image: cloud-sandbox-workstation:latest
  privileged: true; restart: no
  primary network: bridge
  secondary network: cloud-sandbox-edge
  /workspace, /home/agent, /shared-auth, /var/lib/docker -> Mac source
     (move these four to Toshiba physical SSD paths)
  /shared/development -> ~/Development (KEEP)
  /shared/github-repos-local -> ~/Github-Repos-local (KEEP)

Original 31 controller and 15 worker environment variables are
preserved IN MEMORY, not printed or written as an env-file.

## Phase 2a: signed, no-change inspect of candidate specs

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-direct-bind-rehearsal-20261103"
    node "$BASE/direct-bind-rehearsal-on-mac.mjs" --inspect

It requires the same external Toshiba APFS UUID and successful
staging receipt; validates original container names, pinned
image IDs and exact source bind paths. Does not change Docker.

## Phase 2b: temporary CREATE parity rehearsal (NO START)

    node "$BASE/direct-bind-rehearsal-on-mac.mjs" --rehearse

This operation DOES create exactly two temporary STOPPED candidates
under unique ssd-rehearsal-... names, then removes them even on
failure. It NEVER stops, renames, starts, removes or replaces the
original running cloud-sandbox-mcp/cloud-sandbox-dev-main.

The Mac script uses the exact active local Docker Engine Unix socket,
checks it has the same Engine ID as Docker CLI, and supplies
original non-secret and secret container config directly in memory
over that local socket. Full original Config/HostConfig (including
environment values, entrypoint, command, labels, resource limits,
ports, isolation) is deep-cloned, but image ID is pinned and the
five allowlisted host bind sources are changed to Toshiba paths.
Temporary candidate restart policies are set to no.

The candidate Docker Engine objects are INSPECTED immediately:
- exact external physical SSD data bind sources, source types,
  and all additional original bind source paths;
- image ID, privileges, user, workdir, secrets Env exact parity
  (without printing values), CMD, entrypoint and labels;
- resource security options, network mode and primary network,
  published port configuration.

Important: Docker Engine versions differ in ability to add a
secondary network to a stopped container. A live nested-Docker
adversarial check returned "operation not supported" for a secondary
network connect while stopped, and 400 for simultaneous endpoints
at create. Thus the read-only preparation only confirms the first
network. The actual cutover must connect cloud-sandbox-edge after
starting the new worker, and validate the second network before
declaring success or restoring client traffic. A successful
preparation is not proof of application startup, secondary network
connectivity, actual data consistency, xattr or ACL parity.

The rehearsal explicitly checks that original container IDs,
running state and bind mounts remain unchanged at the end.
Docker's original secrets never leave the local Engine/CLI memory
boundary; no secrets or full configs are written to disk or chat.
Cleanup failure is a STOP, never a false PASS. Only the temporary
candidates are deleted, not originals.

Expected final marker:
  RESULT=DIRECT_SSD_CREATE_PARITY_PASS_NO_CUTOVER

## What is still not permitted

Do not run OLD symlink-based cold-cutover-on-mac.mjs --activate.
Do not run another 95-minute full rsync before examining incremental
source changes from the already-successful prior cold sync.
Do not move Docker.raw manually or automatically from this script.
Do not delete the originals on the Mac. Do not forget to preserve
the secondary cloud-sandbox-edge network and both worker extra binds.
The real swap must include guarded rollback of original containers,
startup fail-closed SSD UUID check even when Mac source root is a
physical directory, a brief cold delta sync, and a full validation
of live container read/write plus nested Docker and Bridge.

Docker Desktop image location migration remains a separate step
through Docker Desktop GUI after successful data-bind cutover.
