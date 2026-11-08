# Development

## Layout

```
app/              the Tizen web app (config.xml, index.html, css/, js/, fonts/, img/)
app/js/config.local.js   installer template (placeholders); your own copy lives in local/
local/            your household config (gitignored, never published)
tools/build.sh    build, sign and install (see below)
tools/scan-package.py    privacy check of a built package
tools/find-tv.sh  find the TV on the home network (developer port 26101)
tools/remote.py   send remote keys over Wi-Fi (needs `pip install samsungtvws`)
tools/make-qr.py  QR codes for Settings, About (needs `pip install qrcode`)
packaging/apps2samsung.json   catalog entry for Apps2Samsung
```

The code is plain ES5 (no arrow functions, let/const, async or template strings) so it runs on the
Chromium 63 engine of 2019 Samsung TVs. Keep it that way.
The same goes for CSS: no `inset` (write out top/right/bottom/left), and every flex `gap` needs a
matching `.no-flexgap` margin rule at the end of `app/css/style.css` (see docs/COMPATIBILITY.md).

## Build

- `tools/build.sh` builds `build/app` with `local/config.local.js` and signs it with the Tizen
  security profile in `$TIZEN_PROFILE` (AGENTS.md names it `opencream`).
- `tools/build.sh install` also installs and starts it on the TV found by `tools/find-tv.sh`
  (or `TV_IP=...`).
- `tools/build.sh --public` builds the unsigned release package `build/opencream-tv.wgt` with the
  installer placeholders and runs `tools/scan-package.py`. It needs no Tizen tools: Apps2Samsung
  signs every package with the user's own certificate. It never contains
  `local/`.

## Browser preview

`cd app && python3 -m http.server 8799`, open http://localhost:8799 at 1920x1080. Arrows, Enter,
Esc; PageUp/PageDown = CH. Settings, "Try with sample channels" gives demo content.
Storage keys are prefixed `calm.`.

## On the TV

- `logUrl` in `local/config.local.js` sends the app's log lines to a small HTTP server on your
  computer (POST, one line per request), if you run one.
- Many IPTV accounts allow one connection at a time: stop playback on the TV before testing a
  stream from the computer. HTTP 460 means the slot is taken.

## Rules learned the hard way

- Settings that only change the look must be `choice` rows, never `toggle`: toggles rebuild the
  search index, which means hundreds of provider requests.
- Never change the `v3` part of `filterKey()` in `search.js`: it rebuilds every list.
- Changing the app id in `config.xml` means a fresh install that wipes the TV's saved settings.
