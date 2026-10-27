# Architecture correction: native background CUA on this same Mac

**Decision 2026-10-26.** The operator explicitly rejected a VM, another Mac, and external APFS storage for background native Computer Use. The previous architecture recommendation was wrong. Do not propose isolated hardware again as a prerequisite for this P0.

The new primary implementation is in mac-host/same-mac-ax/. It uses a per-user service on the existing logged-in macOS desktop, backed by AXUIElementCreateApplication, exact window and AX role/name/revision. It targets non-frontmost applications without activating them, posting global keyboard events, simulating mouse clicks or enabling CDP.

Source components:
- mac-host/same-mac-ax/SameMacAX.swift — direct native Accessibility.
- mac-host/same-mac-ax/server.mjs — local authenticated background service, replay ledger and node references.
- mac-host/same-mac-ax/install-on-mac.mjs — same-Mac one-time install/configuration.
- mac-host/same-mac-ax/SameMacAXFixture.swift and accept-on-mac.mjs — disposable live background noninterference test.
- src/services/same-mac-ax-service.ts and src/mcp/server.ts — three optional new MCP tools.

**Important boundary.** AXSetValue and AXPress are not guaranteed to work on every background application. Some applications require activation or may activate themselves when AXPress is invoked. The engine stops and reports unsupported/uncertain rather than silently falling back to Tab, Arrow, Enter, coordinates or global keystrokes. The direct native AX model has no universal GUI-session isolation; only on-device foreground-preservation tests can qualify a specific action. A reported AX dispatch is not proof of persisted data.

Current installed Mac Browser Bridge remains active and unchanged. The new host AX provider is not installed until a Mac-specific Swift compiler check, install and disposable E2E succeed. The old independent-Mac source files are historical engineering exploration, not a runtime dependency. Preserve existing corporate timesheets and active Edge delegated sessions. Maintain Docker/root/shared storage without pruning.

Read mac-host/same-mac-ax/README.md before any next deployment. The goal is background native CUA on this same Mac and one-time local authorization, not recurring approval prompts or VM provisioning.
