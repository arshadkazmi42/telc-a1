#!/usr/bin/env bash
# Start the telc-a1 local server (macOS / Linux).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or not on PATH. Install it from https://nodejs.org (18+)."
  exit 1
fi

exec node scripts/start.js
