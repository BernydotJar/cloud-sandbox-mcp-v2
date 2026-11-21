# Persistent workstation: zombie process reaping

## Incident and cause

On 2026-11-19, the shared `cloud-sandbox-dev-main` workstation showed 348 zombie processes, including 189 Chromium/Chrome entries. Every Chromium zombie had PPID 1. The live PID 1 was `sleep infinity`, a process that does not call `wait(2)` for adopted children. Killing these already-dead processes cannot reap them. This affects a shared workstation with 116 registered projects, nested Docker and live application supervisors; it is not an Antigua XP app failure.

## Source fix

`docker/workstation-entrypoint.sh` now ends with `exec /usr/bin/tini -g -- sleep infinity` after nested Docker readiness. Because the entrypoint shell is PID 1 and executes `tini`, the init process inherits PID 1 and reaps orphaned children. The image explicitly installs `tini` instead of depending on a transitive package.

If a workstation launcher *overrides* the image ENTRYPOINT or CMD with its own inert `sleep infinity`, this source fix will be bypassed: that launcher MUST use Docker's `--init` / `HostConfig.Init=true` or an equivalent verified init as PID 1. Do not infer that an image change alone fixes a launcher override.

## Non-disruptive diagnostics

```sh
ps -p 1 -o pid,ppid,stat,args
ps -eo pid,ppid,stat,comm | awk '$3 ~ /^Z/ {total++; if ($4 ~ /chrome|chromium/) chrome++} END {print "total="total+0,"chrome="chrome+0}'
ps -eo pid,ppid,stat,args | grep -E 'supervisord|dockerd|node|java' | grep -v grep
```

When investigating the live host, additionally inspect the **host** container configuration and saved rollback identity through an authorized Mac operator tool. Running `docker` inside the workstation targets the *nested* daemon, not Docker Desktop on the Mac.

## Controlled recovery (requires service owner / maintenance authorization)

1. Inventory and secure running supervisors, nested containers, HTTP endpoints, session bridges, persistent paths, image identity, mounts, networks, and rollback configuration. Confirm other agents are no longer running jobs. Save nonsecret evidence and backup/rollback identifiers.
2. On the **Mac host**, build/release the corrected workstation image and verify its `tini` executable. If the launcher overrides ENTRYPOINT, configure `HostConfig.Init=true` and verify it in a staged candidate.
3. Use the approved workstation cutover/rollback mechanism to replace the single shared container while preserving `/workspace`, `/home/agent`, `/var/lib/docker` and any other original volume or network bindings. Do **not** run `workspace_recreate_runtime` against one of the 116 registered project records: they share `cloud-sandbox-dev-main`, so that API does not provide project-level isolation.
4. Rehydrate every original supervised service. Confirm PID 1 is `tini` (or equivalent verified init) and zombie counts are near zero; validate nested Docker, Sandbox V3 workspaces, HTTP availability, authentication bridges and browser QA. If any required service fails, roll back the container via the preapproved recovery plan.

**Forbidden as a quick fix:** `kill -9` against zombies (has no effect), destructive workspace cleanup, changing the shared container blindly, or `docker restart` of an image/entrypoint that still uses raw `sleep infinity` (only a transient reset).

## Evidence required to close

- Existing application uptime/health checks before and after maintenance.
- Exact init identity, zombie counts before/after and stable process counts after a real headless browser test.
- Restored nested Docker and any previously running supervisors.
- Recorded new image digest and rollback reference.
