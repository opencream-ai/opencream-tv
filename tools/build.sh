#!/bin/bash
# Build, sign and (with "install") put the app on the TV.
#   tools/build.sh            -> build/app (with local/config.local.js) + a signed .wgt in build/app
#   tools/build.sh install    -> also install on the TV and start it
#   tools/build.sh --public   -> unsigned build/opencream-tv.wgt with the installer placeholders, then a privacy scan
# Signing uses the Tizen security profile in $TIZEN_PROFILE.
set -e
APP_ID=OpnCrmTV01.opencreamtv
# sed -i that works with both BSD (macOS) and GNU sed
sedi() { sed -i.bak "$@" && rm -f "${@: -1}.bak"; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TIZEN="$HOME/tizen-studio/tools/ide/bin/tizen"
if [ "$1" = "install" ]; then
  # Only an install needs the TV (a release build works without a network).
  TVIP="${TV_IP:-$("$ROOT/tools/find-tv.sh" || true)}"
  [ -z "$TVIP" ] && { echo "TV not found on the network (is it switched on?)"; exit 1; }
  TV="$TVIP:26101"
fi
B="$ROOT/build/app"
rm -rf "$ROOT/build"; mkdir -p "$B"
rsync -a --exclude '.DS_Store' "$ROOT/app/" "$B/"
# License texts travel with the package (GPL-3.0 and the third-party notices).
cp "$ROOT/LICENSE" "$ROOT/THIRD_PARTY.md" "$ROOT/TRADEMARK.md" "$ROOT/DISCLAIMER.md" "$B/"
rsync -a "$ROOT/licenses/" "$B/licenses/"
if [ "$1" = "--public" ]; then
  # Public package: the installer placeholders stay in js/config.local.js, no lab console,
  # then a scan for anything private (tools/scan-package.py). Not installed on the TV.
  rm -f "$B/js/lab.js"
  sedi '/js\/lab.js/d' "$B/index.html"
  # Release packages are unsigned: Apps2Samsung signs every package with the user's own
  # certificate. A developer certificate would also put its owner's email and TV id in the file.
  (cd "$B" && zip -q -r -X "$ROOT/build/opencream-tv.wgt" . -x '.*')
  PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3
  "$PY" -I "$ROOT/tools/scan-package.py" "$ROOT/build/opencream-tv.wgt" || { echo "PUBLIC BUILD FAILED THE SCAN"; exit 1; }
  echo "Public package (unsigned): build/opencream-tv.wgt"
  exit 0
else
  [ -f "$ROOT/local/config.local.js" ] && cp "$ROOT/local/config.local.js" "$B/js/config.local.js"
fi
"$TIZEN" package -t wgt -s "${TIZEN_PROFILE:-opencream}" -- "$B" | grep -E 'Package File|ERROR|error' || true
# The package is named after <name> in config.xml.
WGT=$(ls "$B"/*.wgt 2>/dev/null | head -1)
[ -z "$WGT" ] && { echo "PACKAGING FAILED (is the security profile set up?)"; exit 1; }
if [ "$1" = "install" ]; then
  # Reconnect every time: after a TV restart the old developer connection is dead, and the
  # install used to fail silently (31.10.2026).
  "$HOME/tizen-studio/tools/sdb" disconnect "$TVIP" >/dev/null 2>&1 || true
  "$HOME/tizen-studio/tools/sdb" connect "$TVIP" >/dev/null
  OUT=$("$TIZEN" install -n "$(basename "$WGT")" -s "$TV" -- "$B" 2>&1) || true
  if ! echo "$OUT" | grep -q 'successfully installed'; then echo "$OUT" | tail -5; echo "INSTALL FAILED"; exit 1; fi
  echo "Tizen application is successfully installed."
  "$TIZEN" run -p "$APP_ID" -s "$TV" | grep -E 'launched|ERROR|error'
fi
