# FileTube for Roku

A minimal sideloadable Roku channel for [FileTube](../README.md): sign in,
browse the video library as a poster grid (newest first), press OK to play.
Press **Left** on the grid to pick a library root ("Libraries"); press **Up**
to search. Audio files get a full-screen now-playing view (ambient backdrop +
art card + title). Uses only FileTube's existing API — no server-side changes
required.

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

- **Videos library only** — no Music/Books sections yet.
- **Codec support is the Roku's own**: H.264/H.265 MP4 and MKV play natively.
  Files FileTube marks for transcoding (AVI etc.) are served as MP4, but the
  server builds that rendition lazily — the first attempt can fail with a
  "being converted" message; wait a minute and try again. WebM/VP9 and unusual
  audio containers (`.ogg`, `.flac`, `.wav`) may not play on all Roku models.
- **Resume is read-only**: playback starts where the web player left off, but
  the channel does not report watch progress back to the server.
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
