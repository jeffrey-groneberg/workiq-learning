#!/bin/sh
# Starts the Work IQ Showcase desktop app from this checkout (macOS, Linux, Git Bash on Windows).
set -e
cd "$(dirname "$0")"
command -v npm >/dev/null || { echo 'Install Node.js 22.12 or later first: https://nodejs.org' >&2; exit 1; }
[ -d node_modules ] || npm ci
# Some Electron-based hosts set this, which would run Electron as plain Node without a window.
unset ELECTRON_RUN_AS_NODE
exec npm start
