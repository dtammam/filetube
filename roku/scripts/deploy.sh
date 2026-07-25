#!/usr/bin/env bash
# Package the FileTube Roku channel and (optionally) sideload it.
#
#   ./deploy.sh --package-only          # just build out/filetube-roku.zip
#   ROKU_IP=192.168.1.50 ROKU_DEV_PASSWORD=secret ./deploy.sh
set -euo pipefail

ROKU_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROKU_DIR}/out"
ZIP="${OUT_DIR}/filetube-roku.zip"

mkdir -p "$OUT_DIR"
rm -f "$ZIP"
if command -v zip >/dev/null 2>&1; then
  (cd "$ROKU_DIR" && zip -r -q "$ZIP" manifest source components images)
else
  (cd "$ROKU_DIR" && python3 -m zipfile -c "$ZIP" manifest source components images)
fi
echo "Packaged: $ZIP"

if [[ "${1:-}" == "--package-only" ]]; then
  exit 0
fi

: "${ROKU_IP:?Set ROKU_IP to the Roku LAN IP (Settings > Network > About)}"
: "${ROKU_DEV_PASSWORD:?Set ROKU_DEV_PASSWORD to your Roku dev-mode password}"

# Send the running channel home first; installs fail while a channel is active.
curl -s -d '' "http://${ROKU_IP}:8060/keypress/home" >/dev/null || true
sleep 1

RESPONSE="$(curl -s --user "rokudev:${ROKU_DEV_PASSWORD}" --digest \
  -F "mysubmit=Install" -F "archive=@${ZIP}" \
  "http://${ROKU_IP}/plugin_install")"

if grep -qiE "Install Success|Identical to previous version" <<<"$RESPONSE"; then
  echo "Installed on ${ROKU_IP} — the channel should be launching now."
else
  echo "Install may have failed. Roku said:" >&2
  grep -oiE "<font color=\"red\">[^<]*" <<<"$RESPONSE" | sed 's/<[^>]*>//g' >&2 || true
  exit 1
fi
