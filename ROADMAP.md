# Roadmap

## Planned

- [ ] **Real icon assets** — replace the emoji `.icon-*` set + raw inline emojis with self-hosted Google Material Symbols (Apache-2.0), themed via `currentColor` so they work across all era themes. _[in progress]_
- [ ] **MeTube / yt-dlp delete-sync** — keep MeTube's record in sync when a file is deleted in FileTube. Analyzed; deferred. See [docs/exec-plans/future/metube-yt-dlp-sync.md](docs/exec-plans/future/metube-yt-dlp-sync.md).
- [ ] **Handoff-harness install** — install & seed the agent pipeline on branch `setup/handoff-harness` (no functional app changes). _[next]_
- [ ] **Test coverage** — add automated tests (unit for scan/config/transcode logic, smoke tests for the HTTP endpoints) wired into CI. _[after harness]_
- [ ] **Hide a sidebar entry entirely** — a per-folder option to remove a folder from the left sidebar completely (distinct from "Hide from home", which only affects the recent view).
- [ ] **Configurable transcode dir (env)** — so the transcode cache can live on roomy NFS instead of the local disk, plus a higher CRF for smaller files. (Size-cap eviction itself has shipped — see "Automation & Storage" below.)
- [ ] **Atomic `db.json` writes** — write-temp-then-rename + never overwrite a good DB with an empty one. (A full disk once truncated it to 79 bytes; it recovered, but this should be impossible.)
- [ ] **PWA home-screen icon (PNG)** — manifest is wired; still needs raster PNGs generated from the SVG. Parked (no rasterizer handy).

## Shipped

- [x] **YouTube-style player** — inline iOS playback (no forced fullscreen); ±15s skip via on-player buttons, double-tap, and ← / → keys; buttons hidden on mobile; autoplay disabled on mobile.
- [x] **AVI playback (hybrid + lazy)** — desktop streams a live transcode (instant); mobile/iOS plays a seekable pre-transcoded MP4. Transcoding is **lazy** — only AVIs actually watched on mobile are cached (not the whole library), with a "Preparing video" overlay + live %.
- [x] **Simplified audio player** — no spinning vinyl; embedded cover art (or placeholder) as a still with native controls that work on desktop and iOS.
- [x] **Custom folder display names** — friendly per-folder name shown in the sidebar (set in Setup).
- [x] **Recursive folder view** — opening a mapped folder shows everything under it, including subfolders.
- [x] **Reorder sidebar folders** — up/down ordering in Setup drives the sidebar order.
- [x] **Hidden folders** — per-folder "Hide from home" toggle keeps a folder's whole subtree out of the home/recent view (still browsable directly).
- [x] **Channel names** — uploader shows the folder's friendly name, else the file's artist tag, else the folder name.
- [x] **Clearer scan feedback** — Setup polls scan status and shows live file counts.
- [x] **Sort options** — home library sorts by newest/oldest/title/size (persisted).
- [x] **Caching fix** — static assets served `Cache-Control: no-cache` so updates aren't served stale by browsers/nginx.
- [x] **Mobile search bar** — no longer overflows off-screen; tightened mobile header.
- [x] **Description + file type** — fixed odd indentation; file type shown next to file size.
- [x] **Bigger mock comments** — larger pool of silly retro comments/usernames.
- [x] **Icon + favicon + PWA manifest** — solid-red full-bleed SVG icon across all pages; web manifest wired.
- [x] **Screenshots** — real desktop + iPhone screenshots in `assets/images/`, shown in the README.
- [x] **Standardized README** — icon, badges, screenshots, tidied structure.
- [x] **Transcode cache safety** — size-capped LRU eviction for `data/transcoded/` (default 5 GB, `TRANSCODE_CACHE_MAX_BYTES`) with startup orphan `.tmp.mp4` cleanup and recently-served protection.
- [x] **Automation & Storage settings (v1.8.0)** — configurable auto-scan interval (Off/30m/1h/6h/12h/24h, default 30m, with an overlap guard and a "Scan now" button); a "Remove entries for deleted files during scan" toggle (default on) with a mandatory mount-loss guard so an unmounted folder is never mistaken for a deletion; transcode-cache age-retention (Off/7/14/30/90 days, default 30, keyed off a last-served timestamp rather than raw filesystem atime) layered on top of the existing size cap; and a cache-size display with "Clear cache now". All server-side, persisted in `db.json`.
