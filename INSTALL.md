# Installing opencream TV

Samsung only lets apps from its store install normally. Everything else is installed once from a
computer, with the TV in Developer Mode. It takes about 20 minutes the first time.

You need: a Samsung TV from 2019 or newer, a computer (Windows, macOS or Linux) on the same home
network, a free Samsung account, and your IPTV login (server address, username, password).

## Recommended: Apps2Samsung

1. **Find your computer's IP address.** Windows: Settings, Network, your connection, "IPv4 address".
   macOS: System Settings, Wi-Fi (or Network), Details, "IP address". It is four numbers separated by dots.
2. **Turn on Developer Mode on the TV.**
   1. Open **Apps** on the TV.
   2. Type **1 2 3 4 5** with the remote's number buttons (on remotes without numbers, use the
      **123** button to show them).
   3. Switch **Developer mode** to **On** and enter your computer's IP address. Confirm.
   4. **Restart the TV**: hold the power button until the Samsung logo appears.
3. **Install Apps2Samsung** on the computer:
   https://github.com/PatrickSt1991/Samsung-Jellyfin-Installer (see its Releases page).
4. Open Apps2Samsung. It finds the TV. When it asks, **sign in with your Samsung account**: this
   makes the certificate Samsung requires for your TV. It is reused for later installs and updates.
5. Pick **opencream TV** (category IPTV & Live TV). The form asks for your IPTV login. You can
   leave it empty and type it on the TV instead.
6. Install. opencream TV opens on the TV.

## On the TV afterwards

- If you did not enter your login in the form, the app asks for it on first start. You can change
  it any time in **Settings**.
- To start the TV in opencream TV: Samsung **Settings, General, Start Screen Options**: turn
  **Autorun Last App** on and **Start with Smart Hub Home** off.
- The remote's Home button still opens Samsung's home. That cannot be changed by an app. To get
  back quickly, put opencream TV first in Samsung's apps row on the home screen: highlight it,
  press down (or hold OK), choose **Move** and move it to the far left. Then Home, then OK
  usually brings you back.

## Updates

Update **the same way you installed**: open Apps2Samsung and update opencream TV. Your login,
dock and favorites stay on the TV. The form shown during an update only matters for a first
install: change your login in the app's **Settings** instead.

Switching between install methods (Apps2Samsung and a coding agent) needs an uninstall first,
because each signs the app with its own certificate. Uninstalling clears the app's settings.

## Install with a coding agent

If you use Claude Code, Codex or a similar agent that can run commands on your computer: clone this
repository, open it in the agent and ask: "Install opencream TV on my TV, following AGENTS.md."
It asks you for the steps only you can do (Developer Mode, Samsung sign-in).

If you give the agent your IPTV login, it passes through that AI provider and is saved in
`local/config.local.js` on your computer. To avoid that, skip it and type the login on the TV.

## When something goes wrong

| Message or symptom | What to do |
|---|---|
| The TV is not found | TV and computer must be on the same network. Check the IP in Developer Mode matches the computer's current IP, then restart the TV. |
| `Check certificate error` (often `[118,-12]`) | The certificate does not match this TV. Sign in to Samsung again in the installer so it makes a new one. |
| Install refused on an older TV | The TV is older than 2019 (Tizen 5.0). It is not supported. |
| "Could not connect" in the app | Check server address, username and password with your provider. Several servers can be entered, separated by commas. |
| A channel says the connection slot is taken (HTTP 460) | Your subscription allows one device at a time. Stop playback on the other device. |
| No sound on some channels | The channel uses an audio format this TV cannot play. Pick another audio track with Down during playback. |
