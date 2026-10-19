#!/bin/sh
set -eu
if [ "$(uname -s)" != Darwin ]; then echo "Run on macOS host, not Linux"; exit 2; fi
MARKER="$HOME/Library/Application Support/Google/Chrome/DevToolsActivePort"
if [ ! -f "$MARKER" ]; then
  echo "Chrome remote debugging not enabled. In existing Chrome open chrome://inspect/#remote-debugging and allow it."
  exit 2
fi
node "$HOME/.cloud-sandbox-mcp-data/shared-auth/deployment/handoff/cloud-sandbox-computer-use/browser-provider-channels/install-on-mac.mjs" --inspect
echo "Preflight checked. For activation, first confirm authorized Chrome/Edge channels and use the existing installer --activate."
