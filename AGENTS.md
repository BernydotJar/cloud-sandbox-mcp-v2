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

## Native Computer Use routing

9. When a task requires the Mac user's authenticated Chrome/Edge UI, choose `computer_use_status` then `computer_use_state`; discover current tab indices and origin every time. Prefer APIs for deterministic changes.
10. Never use `workspace_exec` to infer access to native Mac apps. Do not enable raw CDP ports or automate login barriers.
11. For an authorized UI change, pass the exact current sanitized URL and reason to `computer_use_action`; native macOS approval must be independently granted by the user. Never treat tool arguments as that approval. Reinspect and independently verify after the action.
12. If the capability is disabled or the user denies a native prompt, stop the UI portion safely; do not fallback to an unapproved control path.
