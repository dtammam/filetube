# FileTube for Roku

A minimal sideloadable Roku channel for [FileTube](../README.md): sign in,
browse the video library as a poster grid (newest first), press OK to play.
**Grid controls:** **Left** = Libraries picker (library roots + a Channels
view with avatar tiles — pick a channel to browse just its content; Back
climbs back out — and a Shows view: a 2:3 poster wall of your TV shows;
pick a show, then a season, then an episode. A single-season show goes
straight to its episodes, and Back climbs the same path out. The season's
episode list is the playback queue, so Next/Previous/Autoplay work
mid-binge). **Up** = search. **Right** (at a row's right edge) or
**\*** (anywhere) = cycle the media filter All → Video → Audio (persisted;
videos view only).

**During playback:** **Down** opens the playback menu — Next / Previous /
Chapters (when the file has them) / Loop (Off · This video · All) /
Autoplay next (persisted) / Restart from beginning. Selecting an item with
watch progress asks Resume-or-start-over; autoplay-advanced items resume
silently. Audio files get a full-screen now-playing view (ambient backdrop +
art card + title) with the native controls in the bottom band.

## One-time Roku setup (dev mode)

1. On the Roku remote press: **Home ×3, Up ×2, Right, Left, Right, Left, Right**.
2. Accept the developer agreement and set a dev password. Note the Roku's IP.
3. The Roku reboots with the web installer live at `http://<roku-ip>`.

## Deploy

Requires `zip` and `curl` on your machine, on the same LAN as the Roku:

```bash
ROKU_IP=192.168.1.50 ROKU_DEV_PASSWORD=yourpass ./scripts/deploy.sh
```

That zips the channel and uploads it; the channel launches on the TV
immediately. Roku OS updates occasionally wipe sideloaded channels — just run
the same command again.

`./scripts/deploy.sh --package-only` builds `out/filetube-roku.zip` without
uploading (install it manually via the web installer).

## First launch

Pick **Server** and enter your FileTube address (e.g. `http://192.168.1.10:3000`
— plain HTTP is fine on the LAN), then username and password, then **Sign in**.
The session cookie is stored in the Roku registry, so subsequent launches go
straight to the grid. FileTube sessions last 30 days; after that (or after a
password change) the channel returns to the sign-in screen.

## Debugging

BrightScript console (prints, crashes, stack traces):

```bash
telnet <roku-ip> 8085
```

Press `Ctrl+]` then `quit` to leave. SceneGraph warnings appear on port 8089.

## Known limitations (v1)

- **Videos + Shows libraries** — no Music/Books/Podcasts sections yet.
- **Episodes stream without the `?compat=roku` demuxer fixes** (embedded-art
  strip / rotation bake) — TV rips essentially never carry those shapes, and
  codec-incompatible episodes already play via the server's tv rendition
  (H.264/AAC MP4, same 503-then-ready "being converted" flow as videos). No
  episode captions or chapters yet (no server surface for them), and no
  next-episode prewarm.
- **Codec support is the Roku's own**: H.264/H.265 MP4 and MKV play natively.
  Files FileTube marks for transcoding (AVI etc.) are served as MP4, but the
  server builds that rendition lazily — the first attempt can fail with a
  "being converted" message; wait a minute and try again. WebM/VP9 and unusual
  audio containers (`.ogg`, `.flac`, `.wav`) may not play on all Roku models.
- **Watch progress syncs both ways** (v1.47.1): the channel pings the same
  /api/progress endpoint the web player uses (every 30s + on stop; a
  finished video records as completed, matching the web). Exiting straight
  to the Roku home screen mid-video can lose the last ~30s of progress. The screen no longer dims
  during audio playback (`disable_screensaver`); the TV panel's own sleep
  timer is outside channel control.
- **Captions**: items with a subtitle sidecar (`hasSubtitles`) expose a
  captions track — toggle with the * (Options) button > Closed Captions.
- **Phone videos may play sideways**: Roku's Video node ignores the MP4
  rotation flag that browsers honor. The fix is server-side (bake rotation
  into the transcoded rendition) and is planned for the v1.47 release.
- `https://` addresses use the Roku's built-in CA bundle — a self-signed
  certificate will not work; use plain `http://` on the LAN instead.
- Password characters may be visible on screen while typing (Roku keyboard).
- Sessions can't be refreshed remotely — re-entering the password on the TV
  once every 30 days is the trade-off for keeping the server untouched.
