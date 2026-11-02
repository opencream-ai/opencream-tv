# Older Samsung TV compatibility

Target: Tizen 5.0+ (2019 and newer). `required_version="5.0"` in app/config.xml.
Reference device for everything verified: QN55QN90CAFXZA, Tizen 8 (2023).

## Chromium 63 audit (Tizen 5.0, 2019)

The app's runtime web view on 2019 sets is Chromium 63. Every API the app uses was checked:

| API | In Chromium 63? | Notes |
|---|---|---|
| `AbortController` | **No** (Chrome 66) | **Fixed** — see below |
| `fetch` + `ReadableStream` body reader | Yes (Chrome 43) | guide streaming in search.js |
| `TextDecoder` | Yes (Chrome 38) | |
| `String.prototype.normalize('NFD')` | Yes (Chrome 34) | search.js norm() |
| `classList.toggle(name, force)` | Yes (Chrome 24) | used widely |
| `Object.assign` | Yes (Chrome 45) | |
| `Promise`, `IndexedDB`, `Array.from`, `includes`, `padStart` | Yes | |
| optional chaining `?.` / `??` | n/a | not used anywhere (code is ES5-style) |

Only `AbortController` was a real blocker.

## Fix: AbortController fallback (01.11.2026)

`app/js/compat.js` adds `window.Net`:
- `Net.hasAbort` — feature flag.
- `Net.canceller()` — returns a controller-like object; `signal` is `undefined` on old TVs.
- `Net.fetchTimeout(url, opts, ms)` — whole-request timeout. Real cancel where supported;
  a Promise/timeout race otherwise (the pending fetch finishes unread, the caller gets a timely
  rejection).

Call sites updated:
- `xtream.js fetchJson` → `Net.fetchTimeout`.
- `search.js readEpg` → `Net.canceller()` + `reader.cancel()` to stop the guide stream (works with
  or without AbortController).

Verified on Tizen 8 (has AbortController, so the normal path runs): clean startup, Xtream
`liveCategories()` returned 759 via the refactored code. The no-AbortController branch can only be
confirmed on a real 2019–2020 TV — part of the public beta.

## Still open for old TVs
- Low-memory guide cap: `tizen.systeminfo.getTotalMemory()`; below ~2 GB keep ~12 h of guide.
- 720p scaling for TVs that report 1280×720 (the `screen.size.normal.1080.1920` feature in
  config.xml may also need relaxing so 720p sets can install — untested, rare on Samsung).
- No regressions expected on new TVs; these are additive.

## Policy
Keep `required_version="5.0"`. Treat 2019–2020 support as **experimental** until at least one
confirmed report from a 2019–2020 TV. New-TV behavior is unaffected.
