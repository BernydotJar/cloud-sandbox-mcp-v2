# Agent operating protocol

When using this MCP server:

1. Create or resume one workspace per task.
2. Inspect `workspace_status`, repository instructions, and current diffs before editing.
3. Prefer `file_apply_patch` or `file_write` with `expected_sha256` for controlled edits.
4. Use `workspace_exec` for repository inspection and development commands; do not attempt Docker, sudo, or git push there.
5. Run `project_verify` and inspect failures before claiming completion.
6. Review `git_diff`, then create a local commit.
7. Use `git_push` only after explicit authorization and only when enabled by the operator.
8. Report commands, exit codes, changed files, tests, assumptions, and remaining risks.

## Optional capability: ArtCraft creative-production tools

ArtCraft (`https://getartcraft.com/apps`) is an **optional, on-demand** tool family
for PDFs, images, UI design, video, presentations, and other creative artifacts.
Treat each application and its automation interface independently; a website
listing is not proof that a CLI, MCP server, or headless feature works.

### Verified baseline and discovery

- The canonical Linux ARM64 workstation previously passed PdfCraft CLI v0.10.1
  smoke tests for `info`, `text`, and PDF-page `render`.
- Its versioned installation is
  `/workspace/.local/opt/artcraft/pdfcraft-cli/0.10.1`, with entry point
  `/workspace/.local/bin/pdfcraft-cli`. Check that the executable is available
  **in the active workstation** before using it; installations are not assumed
  to exist in other containers, runtimes, or developer machines.
- PhotoCraft, FigCraft, FilmCraft, VectorCraft, DeckCraft, and other ArtCraft
  applications are **candidates**, not installed or validated capabilities.
  Do not claim that they are operational or register nonexistent tools.
- Prefer an existing documented native CLI/API over simulated GUI interaction
  when it meets the task requirements. Use browser automation only for actual
  UI flows and their reproducible QA.

### PdfCraft CLI quick start

Run in `workspace_exec` after confirming that the active workspace has the binary:

```bash
set -eu
PDFCRAFT=/workspace/.local/bin/pdfcraft-cli
test -x "$PDFCRAFT" || { echo "PDFCRAFT_UNAVAILABLE"; exit 2; }
"$PDFCRAFT" --help
"$PDFCRAFT" info "/path/to/input.pdf"
"$PDFCRAFT" text "/path/to/input.pdf"
"$PDFCRAFT" render "/path/to/input.pdf" --page 1 --dpi 96 --out "/path/to/artifacts/page-1.png"
```

Other documented commands include `check`, `audit`, `combine`, `extract`,
`split`, and `batch`. Inspect `--help` and tool-specific schemas before
running edits or destructive transformations. Always write results to a
separate output path and preserve originals unless the task explicitly
authorizes replacement.

### Agent and MCP access controls

- PdfCraft exposes an opt-in stdio MCP mode, **not** an already-registered
  Cloud Sandbox MCP tool. Configure the client-side MCP registration and
  validate tool discovery before claiming the integration is enabled.
- Scope every MCP server to an approved project input directory and a
  dedicated output directory. Example command for an MCP client launch
  (substitute an actual registered project path and create the output directory):

```bash
/workspace/.local/bin/pdfcraft-cli mcp --compact \
  --automation-read-root "/workspace/projects/PROJECT" \
  --automation-write-root "/workspace/projects/PROJECT/artifacts/artcraft"
```

- Do not grant entire host-home, browser-profile, credentials, or shared-auth
  paths to a creative tool. Respect project boundaries, symlinks, and the
  user's authorization for private or third-party assets.
- Do not auto-install the entire suite. For a new ArtCraft application,
  verify architecture, exact upstream release, checksum/signature when
  available, license, disk footprint, dependency requirements, and native
  automation support. Install versioned and reversibly, without changing the
  Mac host or unrelated containers.
- Never upload private project files to external services as a fallback
  without authorization. Use the workstation-local operation when possible.

### QA, evidence, and release gating

- Record application/version, inputs, output filenames, executed commands,
  exit codes, and reproducible steps in the task evidence.
- For PDFs, verify output structure and render representative pages; for
  images, videos, slides, and UI designs, add suitable visual and functional
  checks rather than treating process exit 0 as acceptance.
- Keep generated artifacts in project-controlled output directories and
  exclude bulky temporary data from commits unless requested.
- Feed artifacts and checks into the project's Graph Harness acceptance
  workflow where available; never equate successful generation with product
  release approval. Production publishing remains separately authorized.
- If the CLI, MCP registration, or an application feature is unavailable,
  report the specific gap and use an approved alternative rather than
  silently claiming ArtCraft success.
