# Roadmap

Planned improvements for FileTube, roughly in priority order. None of these block the first published image.

- [ ] **YouTube-style player behavior** _(in progress — `feature/player-ux`)_
  - Play inline on iOS instead of forcing native fullscreen (small in-page player like YouTube).
  - Skip forward/back 15s via on-player buttons and double-tap on the left/right of the video.
- [ ] **AVI playback** — `.avi` files are detected but don't play in the browser. Investigate streaming/codec handling (likely transcoding or `Content-Type` for legacy containers).
- [ ] **Favicon** — add a proper FileTube favicon so browser tabs and bookmarks look finished.
- [ ] **Example asset images** — produce the app icon and desktop/iPhone screenshots referenced in the README (`assets/images/`).
- [ ] **Standardize README** — polish for visibility: real screenshots, badges, consistent structure across repos.
