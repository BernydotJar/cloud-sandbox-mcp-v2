# Security model — Workstation mode

Workstation mode prioritizes agent autonomy inside a bounded environment.

## Granted inside each workstation

- root access;
- package installation;
- outbound network;
- nested Docker and Compose;
- browser execution;
- persistent CLI credentials under `/home/agent`;
- local databases, queues, and Kubernetes-in-Docker.

## Not granted

- host Docker socket;
- arbitrary host filesystem mounts;
- controller environment or secrets;
- direct GitHub token access used by `git_push`;
- access to other workspace directories.

A privileged container is not equivalent to a strong VM boundary. For untrusted code or production credentials, run the controller and workstations inside a dedicated VM or dedicated cloud host.

## Native macOS UI automation controls

Native `computer_use_*` is disabled until enabled by a controller operator. It uses a unique 48-byte bridge secret (not the MCP URL secret), a Mac-local peer filter, an explicit HTTPS-origin allowlist, no arbitrary shell/script execution, and strict input validation. All click/type/key events require independent macOS GUI approval. Native script revalidates tab URL after approval before executing the event. Images remain in memory and temporary captures are deleted. Workstations are not given the bridge secret.

A compromised operator configuration or Mac login session is outside this boundary. Protect the controller `.env` with owner-only permissions. The default host listener is restricted by client IP and bearer token but operators should also apply a host firewall rule restricting port 9764 to Docker Desktop. Do not expose this port via Cloudflare Tunnel, ngrok or a public reverse proxy. Do not claim UI access has been tested until macOS TCC permission prompts and an authorized read-only smoke test succeed on the physical host.

The host appends sanitized action-approval and execution receipts to `~/.cloud-sandbox-mcp-data/audit/computer-use.jsonl` with owner-only permissions. Receipts exclude typed text, page query parameters and screenshots. A successful UI event means the input was dispatched, not that a remote account modification was completed; agents must verify independently after acting.
