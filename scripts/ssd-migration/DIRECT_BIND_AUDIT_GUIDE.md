# Toshiba SSD — direct Docker bind mount transition, read-only audit

Date: 2026-11-03. The earlier symlink-based cold cutover failed after
a 95-minute final sync. Automatic rollback recorded a transient
COMMAND_FAILED:docker:stop; user verified both original Mac paths
are physical directories, both Docker containers are running, the
5 original bind mounts are correct, and their exact restart policies
are restored (RECUPERACION_OPERATIVA=PASS).

The user independently verified all 3 direct mount prerequisites:
  CONTROLLER_EXEC=PASS
  WORKSTATION_EXEC=PASS
  SSD_DIRECT_BIND=PASS

The temporary Docker test container with read-only direct SSD bind
was automatically removed. The original controller and workstation
remain on the internal Mac, and all SSD staged data was preserved.

## Technical conclusion

Existing Docker bind mounts are fixed during creation. Replacing a
host directory with a symlink does not guarantee that Docker Desktop's
Linux VM resolves an established bind mount to the new underlying
source. The previous alias approach is DEPRECATED. Do not run
sandbox-v3-ssd-cold-cutover-20261102/cold-cutover-on-mac.mjs
--activate again.

New plan: take a grounded, sanitised inventory of both exact live
container specs before designing a direct SSD recreation. Avoid
guessing / dropping extra binds, labels, Compose metadata, environment
variables, networks, ports, or privileged nested Docker options.
Respect and preserve old identifiers as rollback references until a
separate audited acceptance.

## One Mac read-only audit

    BASE="$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/sandbox-v3-ssd-direct-bind-audit-20261103"
    node "$BASE/direct-bind-audit-on-mac.mjs" --inspect

The auditor:
- Pins Toshiba UUID A6268296-0330-4A69-9BE3-059BE8E4016A and
  validates APFS writable external volume and original source dirs.
- Validates the actual successful initial staging receipt and all
  5 exact original data source bind mounts.
- Reads running Docker inspect for the EXISTING names only.
- Summarizes image references, network mode/names, port mappings,
  resource limits, restart policy, privileged mode, label KEYS,
  primary bind destination names, extra mount paths, and unsupported
  lifecycle settings that require explicit reconciliation.
- Does NOT print secret env values, raw full Docker inspect,
  auth tokens, private environment or full command/entrypoint content.
- Does NOT mutate Mac paths, write files, invoke sudo, run rsync,
  stop/recreate/rename Docker resources or change Docker.raw.

The audit results are design input, NOT cutover authorization. The
explicit SSD direct-bind candidate plan must retain runtime parity.
No one-off recreations should occur until a dry-run candidate config
is demonstrated against the real Docker inspect configuration.

## Planned later cutover constraints

Keep the 40 GB Toshiba stage as the base. Final cold sync is required
for live-changed data, but should be specifically scheduled after
all in-container and native Mac writers have stopped. Copy delta
rather than manually replicating the entire dataset.

Use physical SSD bind sources for controller /data and worker
/workspace, /home/agent, /shared-auth and /var/lib/docker. Preserve
any additional mounts, port publications, network names/aliases,
container flags, image identity, secrets and all other options.
When a full Docker create/Compose spec is not perfectly represented,
STOP and reconcile instead of quietly dropping a flag.

Before production traffic is switched, test an isolated candidate
container from the exact pinned existing image with direct SSD bind,
then compare inspect values. During planned downtime, preserve
original containers as rollback artifacts and never prune Docker.
Do not trust a successful container start alone; independently test
nested Docker, projects, persisted data, read/write probes and actual
physical backing file. Do not remove Mac originals before acceptance.

Docker Desktop Docker.raw disk relocation is SEPARATE and must use
Docker Desktop Settings > Resources > Advanced > Disk image location,
not manual filesystem copies.
