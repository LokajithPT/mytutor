#!/usr/bin/env bash
# Downloads the Vosk Indian-English model (zip) and repacks it as the
# gzipped-tar format vosk-browser requires. Output is gitignored.
set -euo pipefail

DEST="$(dirname "$0")/../public/models"
URL="https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip"
NAME="vosk-model-small-en-in-0.4"

mkdir -p "$DEST" "$(mktemp -d)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -L --fail -o "$TMP/$NAME.zip" "$URL"
unzip -q "$TMP/$NAME.zip" -d "$TMP"
tar -czf "$DEST/$NAME.tar.gz" -C "$TMP" "$NAME"

echo "Wrote $DEST/$NAME.tar.gz"
