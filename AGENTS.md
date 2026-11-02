# Instructions for coding agents: installing opencream TV

You are helping a person install this app on their own Samsung TV from their computer. Work step by
step, explain each step in one or two plain sentences, and stop for the person where noted.

## Rules

- Never print, log, commit or paste the person's IPTV login. It belongs only in
  `local/config.local.js` (gitignored). Do not create any other copy.
- Before asking for the login, tell the person: what they type here passes through their AI
  provider and is saved in `local/config.local.js` on this computer; they may skip it and type it
  on the TV instead.
- Do not change `app/js/config.local.js` (the public template) or the app id in `app/config.xml`.
- Do not install anything without saying what it is and where it comes from.

## Steps

1. **Check the system.** macOS, Linux or Windows (WSL). Note the computer's IP address on the home
   network.
2. **Developer Mode (the person does this).** On the TV: Apps, type 1 2 3 4 5 with the remote,
   Developer mode On, host IP = this computer's IP, OK, then restart the TV by holding the power
   button. Wait until they confirm.
3. **Find the TV:** `tools/find-tv.sh` prints its address (port 26101 open). If nothing is found,
   re-check step 2 and that both are on the same network.
4. **Tizen tools.** Install Samsung's Tizen Studio CLI (or the current Tizen command-line tools)
   from developer.samsung.com into `~/tizen-studio`, with the "Samsung Certificate Extension" and
   TV extensions. On Apple Silicon Macs the CLI may need Rosetta.
5. **Certificate (the person signs in).** Open Certificate Manager, create a **Samsung** certificate
   for **TV**, sign in with the person's Samsung account, and add the TV's DUID (Certificate Manager
   reads it when the TV is connected: `~/tizen-studio/tools/sdb connect <tv-ip>` first). Name the
   security profile `opencream` and set it active.
6. **Login file.** Copy `app/js/config.local.js` to `local/config.local.js`. If the person wants to
   enter the login here, replace the placeholders with their values inside the double quotes,
   escaping `"` and `\`. Several servers: comma separated. Otherwise leave the placeholders; the
   app asks on the TV.
7. **Install:** `TIZEN_PROFILE=opencream tools/build.sh install`. Success prints
   "Tizen application is successfully installed" and the app opens on the TV.
8. **Finish.** Tell the person about Autorun Last App (INSTALL.md, "On the TV afterwards") and that
   updates must also go through this repository (`git pull`, then step 7 again).

## If it fails

Use the table in INSTALL.md. `Check certificate error` means the certificate was made for another
TV or profile: make a new Samsung certificate with this TV's DUID.
