"""Generate the QR codes shown in Settings -> About as SVG files in app/img/qr/.

Usage: python3 tools/make-qr.py   (needs: pip install qrcode)
Edit LINKS when the donation page or the public repository exist; the app shows only the
codes whose file is present (see ABOUT_LINKS in app/js/views/settings.js).
"""
from pathlib import Path
import qrcode
import qrcode.image.svg

LINKS = {
    "opencream": "https://opencream.ai",
    # "donate": "https://buymeacoffee.com/<handle>",       # once the page exists
    # "source": "https://github.com/<owner>/opencream-tv", # once the repo is public
}

out = Path(__file__).resolve().parent.parent / "app" / "img" / "qr"
out.mkdir(parents=True, exist_ok=True)
for name, url in LINKS.items():
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathFillImage, border=2)
    img.save(out / f"{name}.svg")
    print("wrote", out / f"{name}.svg", "->", url)
