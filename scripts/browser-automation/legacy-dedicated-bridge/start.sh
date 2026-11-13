#!/bin/sh
# Dedicated, local-only CDP browser for one-time authentication and agent reuse.
set -eu
if [ "$(uname -s)" != Darwin ]; then echo "Requires macOS"; exit 2; fi
PORT="${BRIDGE_PORT:-9223}"
case "$PORT" in *[!0-9]*|'') echo "Invalid port"; exit 2;; esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then echo "Invalid port"; exit 2; fi
PROFILE="$HOME/.ido-chrome-bridge/profile"
mkdir -p "$PROFILE"
chmod 700 "$HOME/.ido-chrome-bridge" "$PROFILE"
if curl --silent --fail --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null; then
  echo "Dedicated CDP endpoint already responding on loopback port $PORT. No browser launched."
  exit 0
fi
if lsof -n -P -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
  echo "Port $PORT already occupied by a different service; refusing to launch."
  exit 3
fi
open -na "Google Chrome" --args \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check
i=0
while [ "$i" -lt 20 ]; do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null; then
    echo "CDP_READY on 127.0.0.1:$PORT; authenticate once in this dedicated browser."
    exit 0
  fi
  i=$((i+1)); sleep 1
done
echo "CDP_NOT_READY: inspect the dedicated Chrome window; no existing browser was terminated."
exit 4
