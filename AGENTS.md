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
