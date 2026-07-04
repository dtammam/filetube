# Roadmap

## Planned

- [ ] **Reorder sidebar folders** — let the user set the display order of mapped folders in the sidebar (simple manual ordering).
- [ ] **Recursive subfolder display** — when a mapped folder contains subfolders, surface them as their own (nested/expandable) entries in the sidebar instead of flattening everything.
- [ ] **PWA home-screen icon (PNG)** — web manifest + PNG references are wired; still needs the actual PNGs (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) generated from the SVG and committed.
- [ ] **Screenshots** — capture real desktop + iPhone screenshots into `assets/images/` and enable the README screenshot block.

## Considering

- **AVI live transcode** — tried it; reverted because a live (non-seekable) MP4 stream won't play on iOS Safari (needs HLS or a complete file). Could revisit via HLS segmenting to get instant-start + iOS support, but that's a big lift. Pre-transcode (below) is the pragmatic choice for now.

## Shipped

- [x] **YouTube-style player** — inline iOS playback (no forced fullscreen) plus ±15s skip via on-player buttons, double-tap, and the ← / → keys; buttons hidden on mobile, autoplay disabled on mobile.
- [x] **AVI playback** — AVI-class containers are pre-transcoded (ultrafast H.264/AAC MP4) on scan so they play with full skip/resume/seek on all devices incl. iOS; a "Preparing video" overlay with live % shows while a file converts.
- [x] **Simplified audio player** — dropped the spinning vinyl; shows the embedded cover art (or placeholder) as a still with native controls that work on desktop and iOS.
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
