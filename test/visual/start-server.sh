#!/bin/bash
# Serves a seeded DATA_DIR (test/visual/seed.js) read-only, in the foreground:
#   test/visual/start-server.sh [DATA_DIR] [PORT]
# DATA_DIR defaults to $VISUAL_DATA_DIR, else <tmpdir>/filetube-visual-data; PORT to 3917.
# FILETUBE_READONLY=1 refuses every mutating request server-side (the capture's
# request policy also fulfils them in the browser), so a scene can never change the fixture.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA="${1:-${VISUAL_DATA_DIR:-${TMPDIR:-/tmp}/filetube-visual-data}}"
PORT="${2:-3917}"
if [ ! -f "$DATA/.filetube-visual-seed" ]; then
  echo "start-server: $DATA is not a seeded dir; run node test/visual/seed.js first" >&2
  exit 1
fi
cd "$REPO"
DATA_DIR="$DATA" PORT="$PORT" FILETUBE_READONLY=1 FILETUBE_READ_ONLY_MEDIA=1 \
  FILETUBE_YTDLP_ENABLED=true FILETUBE_YTDLP_POLL_MINUTES=0 exec node server.js
