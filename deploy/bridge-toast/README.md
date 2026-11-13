# Native green portal splash — Sandbox V3

Current 2026-11-13 design replaces the hand-drawn mascot with a luminous green, organic portal: animated spiral filaments, an undulating rim, soft bloom and drifting sparks. It is inspired by the green opening created by the portal gun in Rick and Morty; no gun or character appears.

The native AppKit window uses system-adaptive Liquid Glass on macOS 26+, a vibrancy fallback on older SDKs, readable typography and a visible quote:
“Estamos hechos de la materia de los sueños.”
— William Shakespeare, La tempestad, 4.1 (our Spanish translation).
Primary text: https://www.folger.edu/explore/shakespeares-works/the-tempest/read/
Original: “We are such stuff as dreams are made on.”

The original joke “Portal listo. Multiverso intacto.” has no borrowed attribution.
No network assets, web views, browser injections or focus activation.
A quiet original 640ms synthesized portal whoosh plays once when the splash appears.
It is generated in memory, uses no microphone or downloaded soundtrack and honors system
mute. Disable it with --silent or the process setting SANDBOX_PORTAL_SOUND=0.
Reduce Motion disables portal animation. Connection confirmation lasts 5 seconds;
task delegation lasts 20 seconds and can be dismissed. Closing the notice only
hides it; computer_use_session_end revokes the grant. Browser, duration and finite
action budget remain visible. Task authority comes from the separately configured
bridge policy, never from a splash or web content.

On the Mac, after hash verification:
    node install-glass-on-mac.mjs --inspect
    node install-glass-on-mac.mjs --install

The UX-only installer compiles Swift, backs up the previous executable privately,
atomically replaces only ~/Library/Application Support/LCH/CloudSandboxComputerUse/ux/bridge-toast
and supports --rollback. No browser or bridge restart is required for the visual
change. Combine with deploy/task-scoped for the bounded task-delegation update;
do not run the historical unlimited trusted-session installer.

For a preview, run preview-on-mac.mjs. For app-only visual QA, a compiled binary
accepts --session-notice edge 20 120 --render-preview /absolute/output.png. This
renders only the app view; it does not screenshot unrelated desktop or web pages.
A source commit is not evidence of Mac installation; verify the on-device receipt.

The production splash inherits system light/dark appearance. It does not paint an opaque black panel or force darkAqua. NSGlassEffectView uses regular glass with nil tint; older systems use adaptive popover vibrancy. All text and controls use semantic label colors. --preview-appearance light|dark exists only for visual QA.
