# FileTube (Chromium extension)

A sideloadable Manifest V3 browser extension that sends the current tab to your
self-hosted FileTube instance: **Save to Pages** (v1.395.0) keeps the page as
you see it in your Pages, and **Audio** / **Video** start a one-tap download.

- **Save to Pages** reads the tab (with your logins, as rendered) through
  `chrome.scripting` + `XMLSerializer` and POSTs it to `POST /api/pages` with a
  **Pages token**: make one in FileTube, Settings > Pages > Set up the browser
  extension. That token can only save pages to your own Pages and is removable
  under Account > Devices. A tab it cannot read (the Web Store, a PDF) is sent as
  its link and the server fetches it. Permissions: `activeTab` + `scripting`
  (new in 0.3.0, to read the tab you clicked on) + `storage`.
- **Audio / Video** POST the tab URL to `POST /api/ytdlp/download`,
  authenticated with the server's `FILETUBE_API_TOKEN`.

Both tokens live only inside the extension's background service worker.

This is a dev/unpacked extension - load it yourself, it is not published to a
store. It works in Chrome, Edge, Brave, and other Chromium-based browsers.

## Prerequisites

Save to Pages needs only a Pages token (above). For downloads, your FileTube
instance must be started with both of these set:

- `FILETUBE_YTDLP_ENABLED` - turns on the yt-dlp download endpoint.
- `FILETUBE_API_TOKEN` - a secret string. The extension sends it in the
  `X-FileTube-Token` header as an alternative to a session cookie, so the server
  accepts the download without a browser login.

See [docs/CONFIGURATION.md](../docs/CONFIGURATION.md) for how to set instance
environment variables.

## Load it

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the FileTube icon if you like, then open its **Options** (right-click the
   icon > Options, or the gear on the extensions page).
5. Enter your **instance URL** (e.g. `https://filetube.example.com`, no trailing
   path), your **Pages token**, and (for downloads) your **API token** (the
   `FILETUBE_API_TOKEN` value), then **Save**.
   Use **Test connection** to confirm the instance is reachable.

## Use it

Open any page you want to grab, click the FileTube icon, and choose **Audio** or
**Video**. The download is handed to yt-dlp on your instance and lands in your
library. On a YouTube video that is part of a playlist, Audio and Video still
download just that video; **Choose from playlist...** (shown on a playlist tab,
not on a YouTube Mix) opens FileTube's playlist picker in a new tab, signed in as
you, to pick several videos at once. The popup shows a positive hint for well-known yt-dlp sites (YouTube,
Vimeo, SoundCloud, Twitch, TikTok, and ~1800 more); it never blocks an
unrecognized site - the server makes the final call.

## Files

- `manifest.json` - MV3 manifest (`activeTab` + `storage`; host access is
  requested per-instance on demand, not granted up front).
- `popup.html` / `popup.js` - the Audio/Video popup and the site-recognition hint.
- `options.html` / `options.js` - instance URL + API token settings.
- `background.js` - the service worker; holds the token and issues the authed POST.
- `ftClient.js` - pure request-building logic (unit-tested in `ftClient.test.js`).
