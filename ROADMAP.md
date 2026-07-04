# Roadmap

## Planned

- [ ] **Simplify the audio player** — drop the spinning vinyl visualizer (red dot + circle); show a still of the embedded cover art if present, otherwise a simple placeholder. Audio controls should "just work" on both desktop and iOS (currently the HTML5 audio control shows on desktop but is invisible on iOS).
- [ ] **AVI live transcode** — pivot from pre-transcode-on-scan to on-demand live transcoding (starts playing sooner on slow hardware; needs seek handling). _Tradeoff: live transcode weakens clean seeking/resume — decision pending._
- [ ] **PWA home-screen icon (PNG)** — the web manifest is wired, but iOS "Add to Home Screen" needs PNG apple-touch-icons (192/512 + 180 apple-touch). Requires rasterizing the SVG.
- [ ] **Screenshots** — capture real desktop + iPhone screenshots into `assets/images/` and enable the README screenshot block.

## Shipped

- [x] **YouTube-style player** — inline iOS playback (no forced fullscreen) plus ±15s skip via on-player buttons, double-tap, and the ← / → keys; buttons hidden on mobile, autoplay disabled on mobile.
- [x] **AVI playback** — AVI-class containers are pre-transcoded to MP4 on scan so they play with full skip/resume/seek; a "Preparing video" overlay with live % shows while a file converts.
- [x] **Custom folder display names** — each mapped folder can have a friendly display name shown in the sidebar (set in Setup).
- [x] **Hidden folders** — per-folder "Hide from home" toggle keeps a folder's files out of the home/recent view (still browsable by opening the folder).
- [x] **Clearer scan feedback** — Setup now polls scan status and shows live file counts + background transcode count.
- [x] **Sort options** — home library sorts by newest/oldest/title/size (persisted).
- [x] **Caching fix** — static assets served with `Cache-Control: no-cache` so updates aren't served stale by browsers/nginx.
- [x] **Mobile search bar** — no longer overflows off-screen; tightened mobile header.
- [x] **Description + file type** — fixed odd indentation; file type shown next to file size.
- [x] **Icon** — solid red, full-bleed, no border.
- [x] **Favicon + app icon + PWA manifest** — SVG favicon/icon across all pages; web manifest wired (Android/Chrome).
- [x] **Standardized README** — centered icon, status/Docker/license badges, tidied structure.
