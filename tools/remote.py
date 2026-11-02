"""Send remote keys to the Samsung TV over the local network.

Usage: remote.py KEY_HOME KEY_RIGHT ...   (a number = pause in seconds)
       remote.py --apps                   (list installed apps)
       remote.py --text "some text"    (type into the focused field)
"""
import json, sys, time
from pathlib import Path
from samsungtvws import SamsungTVWS

import os, subprocess
TV_IP = os.environ.get("TV_IP") or subprocess.run([str(Path(__file__).resolve().parent / "find-tv.sh")], capture_output=True, text=True).stdout.strip()
TOKEN = Path(__file__).resolve().parent.parent / ".tv-token"

tv = SamsungTVWS(host=TV_IP, port=8002, token_file=str(TOKEN), name="MacRemote", timeout=60)

args = sys.argv[1:]
if args[:1] == ["--apps"]:
    print(json.dumps(tv.app_list(), indent=2))
elif args[:1] == ["--text"]:
    tv.send_text(args[1])
else:
    tv.open()
    for a in args:
        try:
            time.sleep(float(a))
        except ValueError:
            tv.send_key(a)
            time.sleep(0.4)
    print("sent")
