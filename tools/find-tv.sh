#!/bin/bash
# Print the TV's current address: the device on this computer's home network with the Tizen
# developer port (26101) open. Routers hand out new addresses after restarts, so never hard-code it.
# Works on macOS and Linux; assumes a /24 home network (a private address range, as most routers use).
if command -v ipconfig >/dev/null 2>&1 && ipconfig getifaddr en0 >/dev/null 2>&1; then
  ME=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
else
  ME=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
NET=${ME%.*}
[ -z "$NET" ] && { echo "no network address found" >&2; exit 1; }
if nc -h 2>&1 | grep -q -- '-G'; then T="-G 1"; else T="-w 1"; fi
for ip in $(seq 2 254); do (nc -z $T "$NET.$ip" 26101 2>/dev/null && echo "$NET.$ip") & done | head -1
