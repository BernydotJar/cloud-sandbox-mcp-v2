# Changelog

## 0.2.0

- Added VM-like workstation mode as the default.
- Added root and apt package installation.
- Added Python 3, pip, venv, uv, Node 22, Chromium, PostgreSQL/Redis clients, GitHub CLI, and common engineering tools.
- Added a private nested Docker daemon and Docker Compose.
- Persisted nested Docker state per workspace.
- Allowed Docker and system package operations through `workspace_exec` in workstation mode.
- Added `workspace_recreate_runtime`.
- Added `scripts/upgrade-workspaces.sh` for preserving existing checkouts and home directories.
- Increased default CPU, memory, PID, timeout, and output limits.

## Unreleased — native macOS Computer Use integration

- Added first-party `computer_use_status/state/focus/screenshot/action` MCP tools.
- Added macOS Chrome/Edge host component with native per-action approval, origin allowlisting and authenticated Docker Desktop transport.
- Added opt-in launchd registration from the standard Mac setup path and read-only/UI security test coverage.
- Does not use or expose the legacy raw CDP 9223 relay.
