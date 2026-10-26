# P0 — Real macOS Terminal and host command execution

Date: 2026-10-26. Status: NOT IMPLEMENTED IN CURRENT 29 MCP TOOLS.

Three engines must never be confused:

1. `workspace_exec`: root inside Linux workstation; Docker, shared
   storage, repos and deterministic commands already work. Not Mac Terminal.
2. **Terminal.app Computer Use**: native macOS application/window discovery,
   Accessibility inspection, focus and precise input with independently
   observable command output. This is a GUI/CUA capability, not web CDP.
3. **macOS host command runner**: deterministic execution in the host user
   session, a separately authenticated/audited Bridge action. It should not
   require opening Terminal or simulating keystrokes for non-GUI commands.
   Host OS privileges and TCC still apply.

## Acceptance

- Identify Terminal.app via the Mac native AX desktop adapter, not by
  pretending Browser MCP can control nonbrowser apps.
- Existing Terminal window remains intact; deterministic read-only
  `pwd` and `uname` smoke, with observable output and app identity.
- Separate host exec smoke returns an explicit macOS process ID, exit code,
  stdout/stderr boundaries and execution receipt, never Linux shell output.
- No automatic profile modifications, browser debugging, terminal-history
  secret leakage, unauthorized focus stealing, or destructive cleanup.
- Use the operator's trusted delegation policy rather than a new per-command
  permission bureaucracy; preserve explicit user intent and scoped audit.
- Do not present this P0 as completed based on prior anecdotal Mac Terminal
  demos. Current Sandbox V3 registry provides browser-focused native tools.

## Engineering sequence

Design and test native Mac desktop/AX adapter and host command transport
separately; add MCP tool schemas after a guarded Mac Bridge upgrade; verify
source and actual installed runtime; keep Browser MCP and Mac desktop CUA
as different execution engines.
