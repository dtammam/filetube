# FileTube features

What FileTube can do, one section per part. Each says what it is, whether it is **on by default**, and **how to turn it on or off**.
The short version of the project is in the [README](README.md); every environment variable is in the
[configuration reference](docs/CONFIGURATION.md).

Pocket is inspired by classic click-wheel players. FileTube is not affiliated with Apple or Google.

## Looks and layout

### Eras and themes
Four looks for the whole app - 2005, 2009, 2014 and 2021 - each with matching icons, plus light and dark mode.
**On by default:** yes (2021, following your system's light/dark choice). **Change it:** Settings > Appearance; light/dark is in the account menu (your avatar).

### Modern grid
A modern home page: one grid of large tiles with a row of filter chips (All, Videos, Audio, Podcasts, Continue watching, Unwatched) and, on a phone, an avatar bar of channels.
**On by default:** no. **Turn it on:** Settings > Home page > Modern grid.

### The home feed
Home as rows by topic (continue watching, new in your library, and more) instead of one flat grid.
**On by default:** yes for a new account on a new install; an install that already existed keeps the classic grid. **Change it:** Settings > Home page.

### The Feed
A reel-style page that mixes videos, podcasts, books and songs, one card at a time. **On by default:** it is a page of its own (`/feed`, also reachable from the bottom bar); every kind of card can be switched off. **Change it:** Settings > Feed (the settings follow you to your other devices).

## Watch

Library video plays in an app-owned player: keyboard shortcuts, chapters, a mini-player that docks while you browse, theatre mode, Picture-in-Picture, speed, loop, and progress that follows you across devices.
Files a browser cannot play (AVI, HEVC, VP9, AC-3 and friends) are transcoded on demand to H.264/AAC MP4, so they play on an iPhone too.
**On by default:** yes. It needs FFmpeg for thumbnails and transcoding (the Docker image includes it; on a local run it is optional and put on your PATH).
Add folders in Settings > Videos, then **Save & Scan Library**.

## Music and Pocket

### Music library
Albums, Artists, Songs and Liked, with album art, shuffle, search and sort. **On by default:** it appears once you add a Music folder (Settings > Music). Music folders must not overlap your video or book folders.

### Pocket and its skins
A phone-first now-playing view you can dress in a skin: Cider, Nordic, the Original, or one of the Click colorways (lines named Classic, Mini, Slim, Clip, Touch and Custom). The Click skins have a menu you steer with a wheel.
**On by default:** Cider on a phone. **Change it:** Settings > Mobile player, or from the player's own menu (Extras > Skins). Settings > Mobile player also has Keyboard search (experimental, off by default) and Keep Pocket upright (on by default).

### Speakers
Play music on another computer from your phone: turn on Remote control on a computer's Music page, then pick it under Speakers on the phone. Both must be signed in to the same account.
**On by default:** off until you turn it on. A dedicated speaker computer can bookmark `https://<your FileTube>/music?remote=on` to open ready. Browsers refuse to start sound on a page nobody has clicked in; click the computer's tab once, or launch Chrome, Chromium or Edge with `--autoplay-policy=no-user-gesture-required`.

### Radio
Start a radio from a song, an album, an artist or a genre; it queues more of what fits. **On by default:** yes; it uses your own library's tags only.

## Podcasts
Subscribe to RSS feeds (private feed URLs stay in a secrets file outside the database), auto-download new episodes for offline playback, with show art, per-user progress and played state, pins and a recoverable trash. **On by default:** the Podcasts page appears once you subscribe to a show. Details: [docs/CONFIGURATION.md](docs/CONFIGURATION.md#podcasts-v1690).

## Books
EPUB and PDF in the browser: paginated reader, table of contents, paper/sepia/night themes, per-account positions. **On by default:** it appears once you add a Books folder (Settings > Books).
**Listen from Here** reads book chapters aloud (lock-screen friendly). It works out of the box through the espeak-ng voice baked into the Docker image, and can be upgraded to a natural Piper voice: see [docs/CONFIGURATION.md](docs/CONFIGURATION.md#text-to-speech-tts-listen-from-here-v138-works-out-of-the-box).

## Shows and TV

### Shows
A library for series, organised as `Show name / Season N / Show SxxEyy - Title.mp4`, with an optional `poster.jpg` per show. **On by default:** it appears once you add a Shows folder (Settings > Shows). Shows folders must not overlap your other folders.

### The Roku channel
A native, sideloadable [Roku channel](roku/README.md): sign in once, browse your library as a poster grid with search, and play with resume, captions, chapters, loop and autoplay; progress syncs with the web app both ways. It is video-first (music, books and podcasts live on the web app). **On by default:** n/a - it is a separate install; see the channel's README.

## Apps and companions

### The iOS app
A native iPhone and iPad app hosts the web UI and adds a bridge to the phone: a rotation lock, a hidden status bar, battery and network awareness, and offline copies of music, podcasts and videos you choose, which play without a connection. The app talks only to the FileTube server address you enter. **On by default:** it is optional and separate from the server; nothing changes for a web browser. How it works: [docs/references/ios-host.md](docs/references/ios-host.md) and [docs/references/native-bridge.md](docs/references/native-bridge.md). Privacy: [PRIVACY-IOS.md](PRIVACY-IOS.md).

### The browser extension
A sideloadable Chromium extension (Chrome, Edge, Brave) that sends the current tab to your server's download endpoint, authenticated with an API token that only the extension's background worker holds. **On by default:** off; it needs `FILETUBE_YTDLP_ENABLED=true` on the server (see below) and `FILETUBE_API_TOKEN`. Setup: [extension/](extension/).

## Subscriptions and downloads (yt-dlp) - opt-in

FileTube can use [yt-dlp](https://github.com/yt-dlp/yt-dlp) to subscribe to channels on the sites it supports, download new videos into your library on a schedule, and fetch one-off URLs you paste in, with per-channel quality, length and Shorts controls.
**On by default: no.** With `FILETUBE_YTDLP_ENABLED` unset (or anything other than `true`, `1` or `yes`) the server registers **no** `/api/ytdlp/*` or `/api/subscriptions/*` routes and the web app shows no Subscriptions page, no Download button and no related controls.
**Turn it on:** set `FILETUBE_YTDLP_ENABLED=true` in `.env` and restart. The yt-dlp program is bundled in the image either way; the switch decides whether anything uses it. The downloader engine can optionally be updated at runtime from PyPI (off by default, an admin opt-in). Everything else - cookies for members-only content, the engine channels, the download directory - is in [docs/CONFIGURATION.md](docs/CONFIGURATION.md#optional-subscriptions-and-downloads-yt-dlp).
A native host such as the iOS app can also hide this whole interface even on a server that has it on: the app declares whether it shows it (the `mediaFetch` capability).

## Notifications

### Web Push
New-download alerts as push notifications to your devices, even when FileTube is closed. **On by default:** off until you enable it per device in Settings > Notifications (it needs HTTPS; on an iPhone it works for the home-screen-installed web app only). The in-app notification bell is part of the downloads feature above.

## Accounts, access and safety

### Multi-user and access control
An auth wall with per-user progress, likes, pins and reading positions; admin user management; per-user library access control (a block-list, or a fail-closed allow-list for a kid-safe account) across video, music, podcasts and books, on listings and on direct file access. **On by default:** yes; the first boot walks you through creating the admin account. Details: [docs/CONFIGURATION.md](docs/CONFIGURATION.md#accounts--signing-in-v143).

### Backup and restore
A one-click bundle of app state (settings, accounts, watch state, library metadata). Your media files stay where you keep them and are not in the bundle. **Use it:** Settings > Backup & Restore (admin).

### Scan and cache
The library rescans on an interval and removes entries only for files that are truly gone (an unmounted share is never treated as a deletion). Thumbnails come from FFmpeg, and the caches are size-capped and age-swept. **Tune it:** Settings > Scan & cache.

### Transcripts and sharing with an AI
Where a video has subtitles, you can read, copy or share the transcript, with prompts you write yourself placed in front of it. **On by default:** yes where subtitles exist. **Edit the prompts:** Settings > Transcript sharing.

### Install as an app
FileTube installs to a phone or desktop home screen as a PWA. **On by default:** the browser offers it; nothing to enable.
