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


## Quiet Glass design revision and automatic alerts

The source-only candidate now uses a neutral glass rim (0.65 pt),
popover blur plus top specular reflection, a 15-particle restrained burst,
small **Edu!** branding, semibold functional title, readable 2-line body,
and two working controls (audit directory and dismiss). Alerts are
nonactivating. This is an AppKit approximation with broad macOS compatibility,
not a claim that an unavailable \`NSGlassEffectView\` SDK has been installed.

\`deploy/bridge-toast/install-glass-on-mac.mjs\` performs a UI-only Mac
executable upgrade with compilation, pre-change backup, atomic replacement,
smoke and rollback, **without the Bridge baseline constraints** of the
unrelated delegated-session patch. It does not alter the Bridge itself.

\`deploy/bridge-toast/storage-watch-on-mac.mjs\` is optional and not yet
enabled: a user-level LaunchAgent can check authoritative Linux workspace
free space every six hours using Docker read-only \`df -Pk\`, then
request only severity-changing/5-GiB-worse native notices. Never run a
destructive cleanup from this mechanism. The user's existing ChatGPT
storage watch is separate.

Do not claim this candidate is installed merely because it was copied to
the shared-auth handoff. Mac Swift typecheck, live visual QA, and successful
Mac installer output establish native acceptance.
