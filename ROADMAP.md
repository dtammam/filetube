# Roadmap

## Planned

- [ ] **Clearer scan feedback** — when adding a folder or scanning the library, surface what's actually happening (scanning, number of files found, transcoding progress) instead of a generic "scanning…" message.
- [ ] **Custom folder display names** — let each mapped folder have a friendly display name shown in the left sidebar, instead of the raw folder basename.
- [ ] **Include/exclude folders from "Recently added"** — a per-folder toggle controlling whether a folder's files appear in the home/recent display.
- [ ] **Screenshots** — capture real desktop + iPhone screenshots into `assets/images/` and enable the README screenshot block.

## Shipped

- [x] **YouTube-style player** — inline iOS playback (no forced fullscreen) plus ±15s skip via on-player buttons, double-tap, and the ← / → keys.
- [x] **AVI playback** — AVI-class containers are pre-transcoded to MP4 on scan so they play with full skip/resume/seek; a "Preparing video" overlay shows while a file converts. _(shipped — verifying on device)_
- [x] **Favicon + app icon** — self-contained SVG favicon across all pages; matching SVG app icon.
- [x] **Standardized README** — centered icon, status/Docker/license badges, tidied structure.
