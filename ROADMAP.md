# Roadmap

## Planned

### 🐞 Bugs (fix first)

- [ ] **Subscription count edit reverts** — editing a subscription's "download last N" (e.g. 3→2, or any number) switches back to the first/original number even after pressing Edit; the per-sub value doesn't persist. The v1.20.0 default-2 change works, but the edit flow is broken. Root-cause in PATCH /api/subscriptions or the /subscriptions client edit form. _(bug — Dean, post-v1.20.0)_
- [ ] **Watch-page scroll layout bug** — on certain videos, scrolling UP makes the whole bottom panel jump to the middle of the screen; scrolling down snaps it back; a refresh fixes it. Likely sticky/position interaction on the watch page. (May share a root cause with the v1.17.x mobile-layout fixes — re-verify whether still reproducible before deep work.) _(bug)_

### 🎧 Audio player upgrades (Dean — best done as one coherent round)

- [ ] **Audio player dark-mode** — the audio "now playing" view renders pure white in the browser regardless of light/dark theme; make it follow the theme (candidate: reuse the video player/controls chrome for audio, or theme the audio-mode surface with the era tokens). _(Dean — "if it's crazy out of scope we can skip," but likely doable)_
- [ ] **Blocky, non-derpy media controls** — the default rounded Chromium `<audio>`/`<video>` controls look a bit derpy / non-native; build a custom BLOCKY control bar that fits the retro skin (custom controls over native, or heavily-styled). _(Dean)_
- [ ] **Click the cover-art to play/pause** — the audio background art is currently just visual; make tapping/clicking it toggle play/pause like a video surface (Spotify/Apple-Music pattern). _(Dean)_
- [ ] **Persist volume across tracks** — remember the media-control level (volume, etc.) and keep it between songs until the user changes it (localStorage, applied on load). _(Dean)_

### 📺 Subscriptions + library rearchitect (informed by the UI-research pass)

- [ ] **Rearchitect the /subscriptions page — subscriptions-FIRST** — today the page is add-subscription-form at top → one-off download → a small scroll window for the actual subs, which buries them and makes finding a sub "not intuitive or smooth" (Dean). Reorganize so the SUBSCRIPTIONS LIST is the primary, smooth-to-navigate content (bigger, better proportioned), with add-subscription + one-off-download as secondary/collapsible actions. This is the headline of the round. _(Dean — the page IA is wrong)_
- [ ] **"Subscribed to" date + clickable channel link** — in Your Subscriptions, show a subscribed-on date per channel and make the channel link an actual clickable URL. _(Dean)_
- [ ] **Pin a channel's "View as Playlist"** — v1.20.0 added "View as Playlist" (a filtered view of a channel's videos via `?root=`); make it PINNABLE so it sticks as a persistent entry under Playlists/Folders, not just a transient view. _(Dean — extends v1.20.0 FR-4)_
- [ ] **Library grid mobile density** — tighten card sizing so more than ~one card is comfortably in view on mobile (cards read a bit large/zoomed). _(carried; informed by the research pass)_

### 🗑️ Delete safety

- [ ] **Extra-deliberate delete for local (non-yt-dlp) files** — a yt-dlp download is re-downloadable (the v1.17.0 two-tap arm is fine for it), but a LOCAL file is irreplaceable. For non-yt-dlp files, add a more deliberate 3rd step — a proper hard-warning confirm button in a distinct spot — so deleting an irreplaceable file is a conscious decision. _(Dean)_

### 📥 yt-dlp / downloads

- [ ] **Retry button on a failed download** — if a yt-dlp download exits non-zero (fails), surface a Retry button rather than just failing silently. _(Dean)_
- [ ] **Clearer active-download status** — a clearer, optional/dismissible status surface for active downloads (candidate: a bottom-left corner chip/tray) instead of the current window. _(Dean)_

### 🎨 UI polish / 🔧 Infra / 📄 Docs

- [ ] **Card-level download-to-device** — the watch-page download-to-device button shipped v1.19.0; a fast-follow could add the same affordance on the home/library cards for one-tap grabbing without opening the video. _(deferred fast-follow)_
- [ ] **Broaden core test coverage** — the core app's scan/config/transcode logic and HTTP endpoints still have thinner coverage than the yt-dlp module. Backfill unit + smoke tests. _(partially progressed)_
- [ ] **README update** — refresh the README to reflect everything shipped since v1.10 (the yt-dlp subscription module + subscribe-from-downloads + per-channel playlists, the docked mini-player / SPA-lite nav, prev/next + autoplay, download-to-device, iOS codec transcoding, PWA icons, quicker delete, etc.) and add fresh screenshots. _(Dean)_

### 🧹 Tech-debt (see [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md))

- [ ] **yt-dlp prune/mount-loss deep redesign** (#10) — treat "a root's entire content vanished at once" as an unmount signature globally so an empty-but-present mountpoint can't reap library entries/watch-progress.
- [ ] **yt-dlp narrow-config edges** (#12–14) — dedup-collapse discards a duplicate alias's ephemeral progress; download-dir == a mapped folder loses its mount-loss row; cosmetic title-clean when the download dir is an ancestor of a library folder. Mitigated by "use a dedicated download dir."
- [ ] **v1.20.0 channel-capture edges** (#16–18) — a manually-named `[<id>].mp4` under the download root can absorb an unconsumed channel identity; the subscription fallback records identity for failed-download survivors; `channelDir` discloses an absolute server path. All LOW/bounded.

## Shipped

- [x] **Optional yt-dlp integration module (v1.11.0–v1.12.0)** — native, toggleable, off-by-default yt-dlp module: subscribe to channels → poll → download into the media dir → the existing UI surfaces them; per-channel audio/video + quality dropdowns + "download last N"; dedupe via yt-dlp's download-archive; members-only skip toggle; poll-and-defer premieres; pause/edit subscriptions; a one-shot URL download endpoint (`POST /api/ytdlp/download`, single-video, for the iOS-Shortcut workflow); live download status via polling; clean display titles; duplicate-entry fix + display-only synthetic download folder; embedded metadata/thumbnails; pinned in-container yt-dlp. Two-reviewer gate on every risky task (it caught a data-loss blocker + a maxBuffer bug on large channels among many). See the completed exec plans in `docs/exec-plans/completed/`.
- [x] **Real icon assets** — replaced the emoji `.icon-*` set + raw inline emojis with self-hosted Google Material Symbols (Apache-2.0), themed via `currentColor`, plus an icon-set system (Outlined/Rounded/Filled/Emoji + auto-per-era).
- [x] **Agent SDLC pipeline (handoff-harness)** — the multi-agent engineering pipeline (`.claude/agents` + commands + `.state`) is installed and in active use to drive every feature.

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
- [x] **Atomic `db.json` writes + write-concurrency hardening (v1.9.0)** — all `db.json` writers route through one serialized in-process `updateDatabase` primitive (fresh-read-inside-lock -> mutate -> atomic write-temp-then-rename), structurally eliminating the read-modify-write clobber class the v1.8.0 remediation had patched finding-by-finding. A crash mid-write can no longer truncate/corrupt `db.json` (temp + `fsync` + rename, original left intact on failure); the scan's re-read-merge is collapsed under the lock without regressing the mount-loss guard / lastServedAt authority / transcodeStatus seed; a concurrent DELETE during a scan is no longer resurrected; and a dropped rescan tail is now deferred via a single `unref()`'d timer. Includes the error-handling remediation (async-route 500s, `saveDatabase` error propagation, streaming-hot-path throttle, partial-DB backfill, orphan-temp sweep). Two-reviewer QA gate; converged.
- [x] **Mobile logo top-left (v1.9.0)** — on mobile, the logo now sits top-left on both the home and watch pages (matching desktop), with the search full-width on the row below; desktop, a11y, safe-area, and the bottom-nav app-shell unchanged.
- [x] **Related-items fuzzy ranking (v1.10.0)** — the watch page's "Related Files" list now ranks by lightweight content similarity instead of being effectively most-recent. A pure, unit-tested `rankRelated` scores other items by title/filename/tags token overlap (primary), shared folder (secondary), and cross-folder same-channel (tertiary), with a deterministic total-order tie-break, and falls back to most-recent so the list is never empty or worse than before. Weights and the similarity floor are named constants (retunable). No new endpoint, DB field, or dependency; QA-approved.
- [x] **Audio thumbnail-as-background art (v1.10.0)** — audio-only playback now shows the item's thumbnail as cover-framed background art behind the player (a CSS `#audio-bg-art` layer + transparent player in `.audio-mode`) so audio reads like a video is playing, without touching video-frame display, `playsinline`, iOS background-audio, or the lock-screen Media Session. iOS in-page rendering during playback is the on-device arbiter: if iOS paints black regardless, a one-line `AUDIO_PLAYER_MODE='visualizer'` flip falls back to the retained vinyl/cover-art view. Nice-to-have: an optional iOS-only UA-gate could keep desktop art while forcing the iOS fallback simultaneously.
- [x] **yt-dlp parity + quick wins + polish (v1.11.0–v1.15.1)** — mini-MeTube parity (one-shot URL download endpoint, format/quality/filetype dropdowns, per-channel "download last N", pause/edit subs, live status); random "feeling lucky" sort + shuffle; mobile wordmark; hide-a-sidebar-entry; default landing view; folder drag-and-drop; skip-YouTube-Shorts toggle; nicer on-disk filenames (`--windows-filenames`); one-off re-download of already-downloaded content; configurable transcode dir + CRF; PWA PNG icons; one-off download header button + modal (reachable on mobile); graceful delete on read-only mounts; embedded-metadata scan exclusion + configurable download timeout; iOS-Shortcut/share-sheet URL support. Node 22 standardized. Two-reviewer gate throughout.
- [x] **Watch experience — docked mini-player + SPA-lite nav (v1.16.0)** — persistent app shell so a video keeps playing (docked to a corner) while you navigate home/browse/search on mobile — no reload; watch page unchanged, desktop unencumbered. Plus prev/next navigation (home sort order), an autoplay-next Setting, home view+scroll retention on back-nav, and share-URL validator robustness (iOS YouTube share-sheet). Heavy two-reviewer gate on the shell/router/player + a release-blocking URL-ordering bug caught and fixed.
- [x] **Polish round (v1.17.0 + v1.17.1)** — mobile page-sizing root-cause (sort-select + safe-area de-dup; then embedded-metadata/long-path overflow in v1.17.1); quicker delete (no success modal + card trash-can with tap-to-arm→confirm); watch-page autoplay toggle + skip-resume-on-advance + reset-to-0 on end; PWA lifecycle (music keeps playing on lock, video pauses, clean resume); stuck one-off modal fix; proper themed download icon; new-subscription default 25→3.
- [x] **iOS playability + player polish (v1.18.0)** — yt-dlp downloads prefer H.264/AAC (`-S`) so they play on iOS; codec-based transcode detection (ffprobe) so HEVC/VP9/AV1/AC-3 files in web containers transcode instead of appearing-but-not-playing (lazy/on-watch); player poster/FOUC reset on load; rescan surfaces the pending-transcode list.
- [x] **UI polish + download-to-device (v1.19.0)** — one-off modal oversized-select fix; larger subscriptions list box; download-to-device button (original file, `?download=1`, header-injection-safe Content-Disposition); synthetic Downloads folder remove-button disabled with tooltip; mobile search-heading overflow fix; **fixed the v1.18 thumbnail-regeneration regression** (probe-only codec backfill preserves thumbnails); both ffmpeg thumbnail spawns hardened exec→execFile.
