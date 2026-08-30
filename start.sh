#!/usr/bin/env bash
# mytutor — one-command local launcher.
# Boots the Vite frontend + the local faster-whisper STT server together.
# (AI word-choice/coaching tips are optional — start llama-server separately.)

set -e

cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1"; exit 1; }; }
need node
need npm
need uv

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies…"
  npm install
fi

echo
echo "Starting mytutor (frontend + local STT server)…"
echo "Open http://localhost:5173"
echo "Ctrl-C stops both."
echo

npm run dev:all
