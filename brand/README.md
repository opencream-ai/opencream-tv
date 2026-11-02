# opencream TV — brand assets

Part of the opencream brand system. opencream TV is an opencream.ai product, so it uses the **opencream.ai blue**
accent.

## Icon

A TV screen displaying the **`tv.`** wordmark — the opencream "`o.`" construction (letters + the
font's full stop in the accent color), set on a TV so it reads as both the product and the domain.

- Font: **Plus Jakarta Sans Bold** (700), the opencream logo font.
- `tv` and the TV frame: white `#FFFFFF`.
- The full stop (the Jakarta glyph, a rounded square): opencream.ai blue `#0EA5E9`.
- App-icon background: brand dark navy `#0A2540` (Samsung masks the corners; the PNGs are
  full-bleed, the SVG has the brand's rounded-square corners).

Colors match the brand tables exactly: navy `#0A2540`, white `#FFFFFF`, accent `#0EA5E9`.

## Wordmark

`opencream.tv`, following the opencream system: "opencream" in navy `#0A2540` (white on dark) and
the **`.tv` suffix, dot included, in the accent `#0EA5E9`**. Plus Jakarta Sans Bold, tracking
-0.025em. The display name is "opencream TV"; the logo uses the domain form `opencream.tv`, like
`opencream.ai`.

## Files

| File | Use |
|---|---|
| `logos/opencream-tv-app-icon.svg` | Vector master (glyphs as paths, no font needed), rounded navy square |
| `logos/opencream-tv-app-icon-512.png` | App icon / avatar (full-bleed navy) |
| `logos/opencream-tv-app-icon-192.png`, `-180.png` | Smaller app-icon / apple-touch sizes |
| `logos/opencream-tv-logo-dark.svg` / `.png` | Wordmark **opencream.tv** for dark backgrounds (white + blue `.tv`) |
| `logos/opencream-tv-logo-light.svg` / `.png` | Wordmark for light backgrounds (navy + blue `.tv`) |
| `logos/opencream-tv-lockup-dark.svg` / `.png` | Horizontal lockup: icon + wordmark on navy |

The Tizen app's launcher icon is `app/icon.png` (the 512 version), which is what Samsung Smart Hub
shows for the app.

## Regenerate

`python3` with `fonttools`, `brotli`, `Pillow`. The generator reads Plus Jakarta Sans from
`brand-studio/brand/plus-jakarta-sans-latin.woff2`. Source script kept with the brand session
notes; colours and construction above are the spec.
