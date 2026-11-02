"""Check a built .wgt for anything private before it is published.

Usage: python3 -I tools/scan-package.py build/opencream-tv.wgt

Fails (exit 1) when the package contains:
- any value from local/config.local.js (logins, servers, log address), if that file exists,
- a private LAN address (the RFC 1918 ranges, see LAN below),
- the lab console (js/lab.js) or a lab flag,
- the personal background service (service/, tizen:service).
Only file names and finding types are printed, never the values themselves.
The installer placeholders (__OCTV_...) are expected and allowed.
"""
import re, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
pkg = Path(sys.argv[1])
secrets = []
cfg = ROOT / "local" / "config.local.js"
if cfg.exists():
    text = cfg.read_text()
    # every quoted string of 4+ characters in the household config, minus comments
    code = re.sub(r"(^|\s)//[^\n]*", r"\1", text)  # comments only, not the // in URLs
    secrets = sorted({m for m in re.findall(r"['\"]([^'\"]{4,})['\"]", code)})
    # also the bare host names of the servers, in case a URL is written differently
    secrets += sorted({re.sub(r"^https?://", "", s).split("/")[0] for s in secrets if s.startswith("http")})
    secrets = sorted(set(secrets))

LAN = re.compile(rb"\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b")
problems = []
with zipfile.ZipFile(pkg) as z:
    names = z.namelist()
    if "js/lab.js" in names:
        problems.append("js/lab.js: lab console is in the package")
    if any(n.startswith("service/") or n == "js/service-start.js" for n in names):
        problems.append("service/: personal background service is in the package")
    if b"tizen:service" in z.read("config.xml"):
        problems.append("config.xml: tizen:service element")
    for n in names:
        data = z.read(n)
        if n.endswith((".js", ".html", ".xml", ".json", ".css", ".md", ".txt")):
            if LAN.search(data):
                problems.append(f"{n}: private LAN address")
            if n.endswith(".js") and re.search(rb"\.lab\s*=", data):
                problems.append(f"{n}: lab flag")
        for i, s in enumerate(secrets):
            if s.encode() in data:
                problems.append(f"{n}: household config value #{i + 1}")

print(f"scanned {len(names)} files, {len(secrets)} household values checked")
for p in problems:
    print("PROBLEM", p)
sys.exit(1 if problems else 0)
