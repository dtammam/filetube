# Watch chrome consolidation + Ambient mode (v1.186.0)

**Status:** SHIPPED v1.186.0 (2026-08-24) - FULL two-reviewer gate, both APPROVE
(round 1: both caught a red integration suite - the v1.79 unit-hook-hides-
integration class; fixed + re-confirmed). Dual-Node 7533/7533. Device pass PENDING.

Dean, one branch, four parts. Intake answered: all four in ONE wave; ambient =
YouTube-style bloom BEHIND/around the player; desktop + mobile (hard-throttled +
visibility-gated); source = video frames AND audio cover art; dark-only;
default OFF (opt-in).

## Grounding (verified in source)

- The page `‹Previous / Next›` buttons (`#watch-prev-btn`/`#watch-next-btn`, in
  the `#watch-prevnext` bar) navigate the derived feed order
  (deriveOrderedIds/computeNeighbors). The PLAYER's own prev/next
  (`#track-prev-btn`/`#track-next-btn`) is wired to the SAME neighbors via
  `setTrackNav({onPrev:effPrev,onNext:effNext})` (watch.js:1776) and is
  queue-first via manualTrackStep, and it SHOWS for video too since v1.133
  (comment: "keep both for now"). => removing the page buttons loses NO nav.
- Theater ALREADY exists: `ft-theater` + `.watch-container.theater-mode`
  (widens player, desktop-only CSS) + `setupTheatreToggle()` which today builds
  a TEXT "Theatre" button into `#watch-prevnext`. This wave RELOCATES it to an
  icon by the cog.
- The cog `#settings-btn` opens `#settings-menu` (speed/cc/pip) - both live
  INSIDE the persistent player host `#player-wrapper`. Docked CSS hides the cog
  + menu (style.css:6134), so menu contents are FULL-view-only interactive =>
  autoplay/loop wiring can stay in watch.js (id-wired; the v1.181 move-lesson).
- Dark detection: `document.documentElement.getAttribute('data-mode') === 'dark'`
  (era in `data-theme`, light/dark in `data-mode`).
- Player host `#player-wrapper` (`<video id="media-player">`) is reparented into
  `#player-slot` on the watch view and travels FULL/DOCKED/CLOSED. The ambient
  canvas is a WATCH-VIEW element (behind `#player-slot`), NOT inside the host -
  so it is absent when docked/closed for free; it samples `#media-player` /
  the audio cover by id regardless of where the host is parented.

## Item 1 - remove the page Prev/Next (and the whole bar)

- watch.html: delete `#watch-prev-btn`, `#watch-next-btn`. After items 1+3 the
  `#watch-prevnext` bar + `.watch-nextgroup` are empty -> remove them.
- watch.js: drop the page-button wiring (`setupPrevNext` click/disabled), KEEP
  the computeNeighbors -> `setTrackNav` registration (feeds the player buttons).
- style.css: drop the now-dead `.watch-prevnext*` / `.watch-nextgroup` /
  `.watch-prevnext-btn` rules (census/lint stays green).

## Item 2 - theater icon by the cog (desktop only)

- watch.html: add `#theater-btn.pc-btn` with an inline SVG (YouTube widescreen
  rectangle, `pc-svg-ico` style like the gear) right before `#settings-btn`.
- watch.js: rework `setupTheatreToggle` to wire `#theater-btn` (aria-pressed
  reflects state), keeping `ft-theater` + `.theater-mode` flip. No text button.
- style.css: `#theater-btn` desktop-only (hide <= the mobile breakpoint AND
  `#player-dock #theater-btn`), matching theater's existing desktop-only nature.

## Item 3 - Autoplay + Loop into the cog menu

- watch.html: move the two toggle `<label>`s (ids `#watch-autoplay-check`,
  `#watch-loop-check`) into `#settings-menu` as rows (keep the switch markup;
  style as `settings-menu-item` rows). Ids unchanged.
- watch.js: `setupAutoplayToggle`/`setupLoopToggle` are id-wired -> unchanged;
  verify no old-guard-scope coupling (v1.181). Full-view-only (docked hides
  the menu) - acceptable (autoplay/loop already only toggled in full).

## Item 4 - Ambient mode (the new build)

- Toggle: `#ambient-btn` settings-menu-item (aria-pressed), persisted
  `localStorage['ft-ambient']`, default OFF. The ROW is HIDDEN unless dark
  (`data-mode==='dark'`); a light theme hides it and forces the effect off.
- Canvas: `#ambient-glow` (`<canvas>`), absolutely positioned BEHIND
  `#player-slot`, overflowing the player box (~1.25-1.4x), heavy CSS blur,
  modest opacity, `pointer-events:none`, `aria-hidden`. Bleeds outward.
- Sample loop: draw the live source into a tiny offscreen buffer (e.g. 32x18),
  then paint it scaled+blurred onto `#ambient-glow`. Source:
  - VIDEO: `#media-player` current frame (same-origin -> no canvas taint).
  - AUDIO: the cover image element (same-origin) when no video frames.
- Pure decision `ambientShouldRun({prefOn, dark, viewActive, playing, docVisible})`
  = ALL true. The loop starts/stops off this predicate; re-evaluated on: toggle,
  theme change (data-mode), play/pause, `visibilitychange`, view teardown.
- Throttle: rAF-gated to ~5fps desktop / ~2-3fps mobile (a min-interval); ALWAYS
  stop the loop (cancel rAF/interval) when the predicate is false (battery -
  the v1.160 global-listener lesson: no idle cost when off). Stop on pause and
  when the tab is hidden.
- Dark-only + default-off + opt-in: nothing runs, and no canvas paints, until
  Dean turns it on AND the theme is dark.
- Reduced motion: the glow is a slow crossfade, not motion; still, keep updates
  gentle. No layout impact (absolute, behind).

## Predictions the tests re-verify

- No `#watch-prev-btn`/`#watch-next-btn` in watch.html; `setTrackNav` still
  registered from computeNeighbors (player nav intact).
- `#theater-btn` exists in `#player-controls`, wired to the ft-theater toggle,
  desktop-only CSS; no text "Theatre" button remains.
- `#watch-autoplay-check` + `#watch-loop-check` live inside `#settings-menu`;
  their handlers still fire (id-wired).
- `ambientShouldRun` is true ONLY when all of {prefOn, dark, viewActive,
  playing, docVisible}; false in a light theme even with the pref on; the loop
  is torn down (no rAF/interval pending) whenever it is false.
- The ambient toggle row is hidden in a light theme.
- Default OFF; `ft-ambient` persists; same-origin sampling never taints.

## Attack surfaces for the gate (FULL)

- A leaked rAF/interval/observer that samples while paused, hidden, docked,
  light-themed, or after view teardown (battery; the v1.160/v1.166.4 classes).
- Ambient showing in a LIGHT theme, or the toggle reachable there.
- Canvas taint (a cross-origin source throwing on drawImage) killing playback.
- Autoplay/loop losing their handlers after the move (id-wiring vs guard scope).
- Theater icon appearing on mobile or docked; the removed page-nav leaving
  video with no prev/next (it must not - player track-nav covers it).
- The persistent host: ambient must NOT travel docked (it's a watch-view node).
