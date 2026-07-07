# Software Developer inbox — T2 (v1.21 FR-2: audio/video player overhaul)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T2**, **Wave 1** —
runs in PARALLEL with **T9 only** (README; disjoint file sets). T2 is the longest
pole. Because T2 edits `public/css/style.css`, and 6 other tasks also edit it,
**no other code task may run until T2's changes are integrated** — you lead the
serialized CSS chain (T2 → T3 → T4 → T5 → T6 → T7 → T8). Finish cleanly so the
coordinator can integrate and start Wave 2 (T3).

**Review tier: HEAVIEST two-reviewer / adversarial gate this round** (shared-player
regression risk spans BOTH audio and video and the entire v1.16
FULL/DOCKED/CLOSED persistent-shell/dock machinery). **Dean's on-device pass —
especially iOS Safari — is the arbiter** for feel and for any regression outside
`node:test` (no headless/E2E infra exists per `docs/RELIABILITY.md`).

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
  e.g. `export PATH="/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin:$PATH"`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. When done, report exact files changed/created plus full
`npm run lint` (0 warnings) and `npm test` output under Node 22. Fix any failure
before reporting done.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.21-polish-release.md` — the **## Design**
  section **"FR-2 — custom blocky audio/video controls (HEAVIEST)"** (names every
  element id, helper, and behavior) plus the FR-2 scope block and **AC6–AC17**.
- `docs/CONTRIBUTING.md` (vanilla DOM, no framework/bundler, 2-space, semicolons,
  single-quotes, `textContent` over `innerHTML`, `node:test`, lint 0, **no new
  deps**) and `docs/RELIABILITY.md` (rAF loop must be cancelled on pause/close;
  no new budget impact).
- Live code (read in full): `public/js/player.js` — the v1.16 persistent player
  controller: `ensureHost`/`wireHostListeners`, the FULL/DOCKED/CLOSED state
  machine, `STATE_FULL`, skip controls, hold-to-2x, double-tap, `currentAbsTime`,
  `startLiveStream`, `pollTranscodeUntilReady`, resume/transcode overlays, Media
  Session wiring, `updatePositionState`, progress saving. The
  `<template id="player-host-template">` in all four shells and `#audio-bg-art`/
  `.audio-mode` + existing control styling in `public/css/style.css`.

## Task — implement THIS ONE task only (FR-2)

Follow the Design's FR-2 section exactly. Summary:

1. **Markup — all FOUR shells' `#player-host-template`** (`public/index.html`,
   `public/setup.html`, `public/watch.html`, `lib/ytdlp/views/subscriptions.html`;
   keep them byte-identical): remove the `controls` attribute from
   `<video id="media-player">`; inside `#player-wrapper` add
   `<div id="player-controls" class="player-controls">` (play/pause `#pp-btn`,
   `#time-cur`, `<input type="range" id="seek-bar">`, `#time-dur`, mute `#mute-btn`,
   `<input type="range" id="vol-bar" min="0" max="1" step="0.01">`, fullscreen
   `#fs-btn`) and `<div id="art-play-glyph" class="art-play-glyph">`.
2. **Controller (`public/js/player.js`), all listeners wired ONCE in
   `wireHostListeners()`** so the bar travels with the host across
   FULL/DOCKED/CLOSED: play/pause → `updatePlayPauseUI()`; click-`#audio-bg-art`
   toggles play/pause + flashes glyph **only when `state === STATE_FULL`**
   (`stopPropagation` there; docked taps bubble to `#player-dock` unchanged);
   seek `input` = visual scrub only (`--seek-fill` var + `#time-cur`, an
   `isScrubbing` flag, never touch `currentTime`), `change` = the ONLY commit via
   pure `seekCommitTarget({duration,ratio,liveMode,liveTotal})`; a `rAF` fill loop
   while playing (not `timeupdate`), cancelled on pause/close/scrub; live-transcode
   uses `currentAbsTime()` and `startLiveStream(target)` on a committed seek in
   `liveMode`; volume via pure `clampVolume(raw)` → `[0,1]|null`, read from
   `localStorage['ft-volume']` and applied BEFORE playback, persisted on
   `volumechange`; **iOS**: run `volumeIsSettable(el)` feature-detect once and
   HIDE `#vol-bar`/`#mute-btn` + skip apply when not settable (degrade silently,
   never an error); fullscreen retarget via `enterFullscreen()` preferring
   `mediaPlayer.webkitEnterFullscreen()` (iOS) else `host.requestFullscreen()`
   (desktop) — update the `f`-key handler, rotate-to-fullscreen path, and `#fs-btn`.
3. **Styling (`public/css/style.css`)** — add ONE new labeled section
   `/* === v1.21 FR-2: player controls / audio-mode === */`: fixed-height flex
   bar pinned to `.player-container` bottom, always visible, `border-radius:0`,
   beveled inset/outset borders + square range thumbs/segmented fill via
   `::-webkit-slider-*`/`::-moz-range-*`, all colors from **era CSS vars** (dark
   mode "just works"), `color-scheme: dark light`. In `.audio-mode` re-enable
   `pointer-events` on `#audio-bg-art` for the click-to-play surface.

**PRESERVE (AC12/AC14), all untouched:** inline iOS playback, ±15s skip
(buttons/double-tap/hold-2x/keyboard), transcode "Preparing…" overlay + polling,
resume overlay, the full FULL/DOCKED/CLOSED machine (reparent, dock,
tap-to-expand, `[x]` close, iOS reparent-resume-guard), Media Session
metadata/state/position, progress saving. Media Session stays as-is; adding
seek/track action handlers is OPTIONAL (AC13), not required.

## Tests to add

`node:test` unit coverage for the extracted pure helpers: `clampVolume`
(in-range, out-of-range clamp, garbage/`NaN`/empty → `null`) and
`seekCommitTarget` (normal source; live-transcode with `liveMode`/`liveTotal`;
ratio 0 and 1 boundaries). The `volumeIsSettable` feature-detect is browser-only
(not unit-tested).

## File-ownership / serialization contract (STRICT — shared tree)

Hard rule: while you are running you are the **ONLY** editor of every file you
touch (no other concurrent task shares any file with you this wave — only T9 on
`README.md` runs alongside). Your files: `public/js/player.js`,
`public/index.html`, `public/setup.html`, `public/watch.html`,
`lib/ytdlp/views/subscriptions.html`, `public/css/style.css`. You may edit these
freely (later tasks serialize AFTER you integrate). Do NOT touch
`public/js/common.js`, `public/js/watch.js`, `public/js/main.js`,
`public/js/main.js`, or `lib/ytdlp/**` (subscriptions.js/index.js/store.js).
Keep the `style.css` additions in a clearly labeled `/* v1.21 FR-2 */` block and
the four shells' `#player-host-template` byte-identical — this makes the
coordinator's integration and the following serialized CSS edits clean.

## Report back

Files changed (path + one-line each); the control-bar element ids; the
`clampVolume`/`seekCommitTarget`/`enterFullscreen`/`volumeIsSettable` signatures;
a short "every v1.16 behavior preserved" checklist (skip, dock, overlays, Media
Session, progress) and the fullscreen-retarget + art-play-only-in-FULL notes for
Dean's iOS pass; lint + Node 22 test result; any deviation/fork with a
recommendation. Flag clearly that this is the HEAVIEST gate and needs Dean's iOS
on-device arbitration.
