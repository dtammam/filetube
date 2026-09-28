#!/bin/bash
# Serves a seeded DATA_DIR (test/visual/seed.js) read-only, in the foreground:
#   test/visual/start-server.sh [DATA_DIR] [PORT]
# DATA_DIR defaults to $VISUAL_DATA_DIR, else <tmpdir>/filetube-visual-data; PORT to 3917.
# FILETUBE_READONLY=1 refuses every mutating request server-side (the capture's
# request policy also fulfils them in the browser), so a scene can never change the fixture.
#
# Determinism (plan D10.5; the visual job diffs at 0 changed pixels). Nothing may change
# what a page shows while the server runs, however long it has been up:
# - the library re-scan timer: off (seed.js stores scanIntervalMinutes 0; the one boot
#   scan runs at listen, and test/visual/server.js waits for it to finish);
# - the yt-dlp subscription poll: off (FILETUBE_YTDLP_POLL_MINUTES=0);
# - the podcast feed poll: off (seed.js stores podcasts pollMinutes 0 = manual only);
# - boot-time yt-dlp one-shot requeue and folder migration: skipped by
#   FILETUBE_READ_ONLY_MEDIA=1;
# - the downloader-engine daily check: a no-op (the fixture's engine channel is the
#   bundled one; the hourly tick skips it);
# - the clock: when the seed was pinned (fixtures.json "pinned": true, i.e. SEED_NOW was
#   set), the server's wall clock starts at fixtures.json viewNow (clock-shim.js), unless
#   FILETUBE_CLOCK_MS is already set; TZ is UTC.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA="${1:-${VISUAL_DATA_DIR:-${TMPDIR:-/tmp}/filetube-visual-data}}"
PORT="${2:-3917}"
if [ ! -f "$DATA/.filetube-visual-seed" ]; then
  echo "start-server: $DATA is not a seeded dir; run node test/visual/seed.js first" >&2
  exit 1
fi
cd "$REPO"
CLOCK="${FILETUBE_CLOCK_MS:-}"
if [ -z "$CLOCK" ]; then
  CLOCK="$(node -e 'const f=require(process.argv[1]); process.stdout.write(f.pinned && f.viewNow ? String(f.viewNow) : "")' "$DATA/fixtures.json")"
fi
NODE_REQUIRE=()
if [ -n "$CLOCK" ]; then NODE_REQUIRE=(--require "$REPO/test/visual/clock-shim.js"); fi
DATA_DIR="$DATA" PORT="$PORT" TZ=UTC FILETUBE_CLOCK_MS="$CLOCK" FILETUBE_READONLY=1 FILETUBE_READ_ONLY_MEDIA=1 \
  FILETUBE_YTDLP_ENABLED=true FILETUBE_YTDLP_POLL_MINUTES=0 exec node "${NODE_REQUIRE[@]}" server.js
