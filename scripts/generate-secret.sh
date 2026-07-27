#!/usr/bin/env bash
set -euo pipefail
if command -v openssl >/dev/null 2>&1; then
  openssl rand -hex 32
else
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
fi
