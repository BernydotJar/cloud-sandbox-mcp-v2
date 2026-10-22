# ArtCraft MCP in Cloud Sandbox V2

**Status:** PdfCraft CLI v0.10.1 was installed and verified on the canonical
ARM64 Linux workstation; its stdio MCP server has been added to the installed
Claude Code agent's **user-scope** configuration as `artcraft-pdfcraft`.
Other ArtCraft applications are not installed or validated. The ChatGPT-side
Cloud Sandbox MCP tool catalog is *not* extended automatically by this
Claude Code registration.

## Tool layout

| Component | Workstation location |
| --- | --- |
| PdfCraft binary | `/workspace/.local/bin/pdfcraft-cli` |
| Installed package | `/workspace/.local/opt/artcraft/pdfcraft-cli/0.10.1/` |
| Scoped MCP wrapper | `/workspace/.local/bin/pdfcraft-mcp` |
| Version-controlled wrapper | `scripts/artcraft/pdfcraft-mcp.sh` |
| Claude Code MCP config | User-scope entry under `/home/agent/.claude.json` |
| Agent instructions | `AGENTS.md` |
| QA script | `scripts/artcraft/smoke.mjs` |
| Generated outputs | `/workspace/projects/<project>/artifacts/artcraft/` |

The wrapper reads the current process directory and identifies its project as
the immediate child of `/workspace/projects`. It refuses to start outside
that tree. An explicit `ARTCRAFT_PROJECT_ROOT` may designate the **exact**
project root when launched from another working directory. Symlinked project
roots or an output directory escaping the project are rejected.

PdfCraft is launched with:

```bash
pdfcraft-cli mcp --compact \
  --automation-read-root "/workspace/projects/PROJECT" \
  --automation-write-root "/workspace/projects/PROJECT/artifacts/artcraft"
```

This grants read access inside **one project** and write access only under
that project's `artifacts/artcraft` directory. It does not authorize sharing
files externally, accessing browser/host credentials, or publishing artifacts.
Keep sensitive inputs within their project's normal access rules.

## Verify current registration

```bash
cd /workspace/projects/cloud-sandbox-mcp-v2
/home/agent/.local/bin/claude mcp list
node scripts/artcraft/smoke.mjs
```

The smoke script uses a real stdio MCP client to connect, discover tools, open
an isolated synthetic PDF, inspect metadata, extract text, save an output, and
assert that reads and writes outside the approved paths are denied. It removes
the synthetic PDF and writes a JSON report to
`artifacts/artcraft/last-smoke.json`.

For any other project's Claude Code session, start Claude from inside
`/workspace/projects/<project>` and the same user-scope MCP configuration
will resolve that project automatically.

## Recover or reinstall registration

If the wrapper is missing or outdated:

```bash
cd /workspace/projects/cloud-sandbox-mcp-v2
install -m 0755 scripts/artcraft/pdfcraft-mcp.sh /workspace/.local/bin/pdfcraft-mcp
test -x /workspace/.local/bin/pdfcraft-cli
```

If Claude Code has no MCP registration:

```bash
cd /workspace/projects/cloud-sandbox-mcp-v2
/home/agent/.local/bin/claude mcp add --scope user --transport stdio \
  artcraft-pdfcraft -- /workspace/.local/bin/pdfcraft-mcp
```

**Do not overwrite an existing entry without inspecting it.** To intentionally
remove only this integration:

```bash
/home/agent/.local/bin/claude mcp remove --scope user artcraft-pdfcraft
```

Do not remove `/workspace/.local/opt/artcraft/` or other agents' settings during
recovery. Installing other ArtCraft applications is a separate approval and
verification step (architecture, exact upstream release, checksum, license,
runtime support, security, and storage footprint).

## Boundaries and agent behavior

- Do not claim registration in Gemini, Codex, ChatGPT's direct MCP tool catalog,
  or the Mac host from this one Claude Code user-scope registration.
- Use existing `workspace_exec` for task-specific CLI operations when there is
  no first-class native tool available; that path does not require new MCP tools.
- Use Claude Code only for user-authorized project actions, with the inherited
  project and Graph Harness policies. Record outputs, commands, exit codes, and
  representative visual checks before marking a creative task accepted.
- If started from `/workspace` instead of inside a project, the scoped server
  intentionally refuses startup with `ARTCRAFT_SCOPE_DENIED`.
- Keep derived creative outputs separate from sources. Production publishing,
  remote upload, and use of other ArtCraft apps need their own authorization.
