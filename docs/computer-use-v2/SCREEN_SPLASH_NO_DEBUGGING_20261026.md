# Sandbox V3 — Native on-screen laboratory splash and no-debug browser policy

Date: 2026-10-26. Status: SOURCE CANDIDATE, not installed on Mac.

## Screen UX

- **Actual native macOS AppKit window**: `deploy/bridge-toast/bridge-toast.swift`.
  It is not HTML, an image file, a website, or a static dashboard.
- Existing Akira mascot with a radial burst of colored particles (lab-style,
  inspired by the energy of animated science laboratories without copyrighted
  characters/artwork). Uses CoreAnimation; honors Reduce Motion; no downloads.
- Normal connection: floating upper-right 5-second splash, nonactivating,
  click-through and never shown repeatedly for each tool call.
- Delegation: 20-second notice with explicit session scope; Close hides
  the notice, **not** the session.
- Optional operator-requested alert:
  `bridge-toast --status-alert storage` (or `edge`, `terminal`, `recovery`).
  20 seconds, nonactivating, dismissible; **Ver registros** opens the
  local audit directory via NSWorkspace. No inert buttons or hidden shell.
- Renderer only: automatic invocation by Mac storage or Bridge telemetry is
  NOT integrated yet. The Linux storage monitor remains independent.
- Release gate: `xcrun swiftc -typecheck` on macOS, actual screen capture,
  accessibility, focus preservation, Reduce Motion, and existing toast smoke
  before installing. No Mac deployment is asserted for this change.

## Browser engines without enabling Remote Debugging

- **Default**: isolated Playwright Chromium for web QA and E2E.
- **Existing authenticated Mac tabs**: native discovery and Accessibility;
  do not require `chrome://inspect` or `edge://inspect`, debug ports,
  browser profile migration, browser restart, or dedicated debug profile.
- A working existing CDP connection can be reused as-is; it must never be
  considered mandatory. Runtime probe 2026-10-26 showed Chrome persistent
  semantic inspection and Edge native read-only discovery. Edge CDP remained
  BROWSER_ATTACH_FAILED. Do not publish old pilot results as current.
- Native tab discovery is not semantic QA. Separately prove AX targeting,
  dispatch and post-action readback before claiming functional parity.

## Pilot handoff reconciliation

The handoff and `PILOT_USAGE.md` describe a working pilot snapshot
from 2026-10-12: Edge had semantic inspection and Chrome had inspection
failures. By 2026-10-26 the live status had changed, confirming the runtime
must be probed each session. Preserve that evidence as historical, do not
erase it, and do not tie tool acceptance to an old commit alone.

## Remaining release gates

1. Compile/visually verify the native splash on the actual Mac and deploy
   only with known installed baseline, backup and rollback.
2. Test Edge native AX semantic behavior on benign test data, under task
   authorization; never change Edge debugging settings.
3. Verify Mac Terminal P0 independently from Linux shell execution.
4. Correlate storage watch to explicit native status alerts without launching
   windows repeatedly or occupying the user's desktop.
