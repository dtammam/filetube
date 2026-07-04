# Roadmap

## Planned

- [ ] **Clearer scan feedback** — when adding a folder or scanning the library, surface what's actually happening (scanning, number of files found, transcoding progress) instead of a generic "scanning…" message.
- [ ] **Custom folder display names** — let each mapped folder have a friendly display name shown in the left sidebar, instead of the raw folder basename.
- [ ] **Include/exclude folders from "Recently added"** — a per-folder toggle controlling whether a folder's files appear in the home/recent display.
- [ ] **Sort options** — let the home/library view be sorted (newest, oldest, title, etc.).
- [ ] **Fix description indentation** — the "File Path" and "This file is self-hosted…" lines in the watch-page description box are indented oddly; align them cleanly.
- [ ] **Show file type** — display the file type/extension next to the file size in the video description.
- [ ] **AVI live transcode** — pivot from pre-transcode-on-scan to on-demand live transcoding (starts playing sooner on slow hardware; needs seek handling).
- [ ] **Icon: solid red, no border** — make the app/favicon icon fully red with no border/outline.
- [ ] **PWA home-screen icon** — "Add to Home Screen" doesn't use the FileTube icon; add PNG apple-touch-icons + a web manifest so the shortcut shows the real icon.
- [ ] **Screenshots** — capture real desktop + iPhone screenshots into `assets/images/` and enable the README screenshot block.

## Shipped

- [x] **YouTube-style player** — inline iOS playback (no forced fullscreen) plus ±15s skip via on-player buttons, double-tap, and the ← / → keys.
- [x] **AVI playback** — AVI-class containers are pre-transcoded to MP4 on scan so they play with full skip/resume/seek; a "Preparing video" overlay shows while a file converts. _(shipped — verifying on device)_
- [x] **Favicon + app icon** — self-contained SVG favicon across all pages; matching SVG app icon.
- [x] **Standardized README** — centered icon, status/Docker/license badges, tidied structure.
