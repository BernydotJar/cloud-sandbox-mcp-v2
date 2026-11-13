#!/usr/bin/env bash
# Launch PdfCraft MCP with read access restricted to one sandbox project.
# Intended for a client started from /workspace/projects/<project>/...
set -euo pipefail

pdfcraft_bin="${ARTCRAFT_PDFCRAFT_BIN:-/workspace/.local/bin/pdfcraft-cli}"
projects_dir="/workspace/projects"

if [[ ! -x "$pdfcraft_bin" ]]; then
  printf '%s\n' 'ARTCRAFT_UNAVAILABLE: install the trusted PdfCraft CLI binary first.' >&2
  exit 69
fi

workdir="$(pwd -P)"
if [[ -n "${ARTCRAFT_PROJECT_ROOT:-}" ]]; then
  candidate="$(realpath -e -- "$ARTCRAFT_PROJECT_ROOT")"
else
  candidate="$workdir"
fi

case "$candidate" in
  "$projects_dir"/*) ;;
  *)
    printf '%s\n' 'ARTCRAFT_SCOPE_DENIED: start the agent inside /workspace/projects/<project>, or set ARTCRAFT_PROJECT_ROOT to an approved project root.' >&2
    exit 77
    ;;
esac

relative="${candidate#"$projects_dir"/}"
project_name="${relative%%/*}"
if [[ -z "$project_name" || "$project_name" == '.' || "$project_name" == '..' ]]; then
  printf '%s\n' 'ARTCRAFT_SCOPE_DENIED: invalid project name.' >&2
  exit 77
fi
project_root="$projects_dir/$project_name"
resolved_root="$(realpath -e -- "$project_root")"
if [[ "$resolved_root" != "$project_root" || ! -d "$project_root" ]]; then
  printf '%s\n' 'ARTCRAFT_SCOPE_DENIED: project root must be a real directory, not a symlink.' >&2
  exit 77
fi
if [[ -n "${ARTCRAFT_PROJECT_ROOT:-}" && "$candidate" != "$project_root" ]]; then
  printf '%s\n' 'ARTCRAFT_SCOPE_DENIED: ARTCRAFT_PROJECT_ROOT must identify the project root.' >&2
  exit 77
fi

artifacts="$project_root/artifacts/artcraft"
mkdir -p -- "$artifacts"
resolved_artifacts="$(realpath -e -- "$artifacts")"
case "$resolved_artifacts" in
  "$project_root"/*) ;;
  *)
    printf '%s\n' 'ARTCRAFT_SCOPE_DENIED: output directory escapes the project.' >&2
    exit 77
    ;;
esac

exec "$pdfcraft_bin" mcp --compact \
  --automation-read-root "$project_root" \
  --automation-write-root "$resolved_artifacts"
