---
plan: post-311-2-regressions
harness: v2 · filetube
branch: fix/post-311-2-regressions
anchor: outcome
status: Building
next: commit R3 + swipe-back scope, sandbox mutants, R4 end-to-end chaptered check, then dual-Node full suites and the FULL gate
gate: pending
---

# Post-v1.311.2 regressions (target v1.311.3)

Branch `fix/post-311-2-regressions`, base `9f440d47` (main, v1.311.2).

## Intake (Dean, 2026-09-23, iPhone, after v1.311.2)

0. CRITICAL: on mobile, video plays audio over a BLACK picture.
1. A music skin ("Pocket Classic", probably Click / `ipod`) got stuck with no way out.
2. Video faux fullscreen still scrolls up and down.
3. Rotating the phone in music mode locks all scrolling.
4. A chaptered album should play all its chapters before radio. Verify only.

Dean's answers (2026-09-23): black is "only on mobile"; skin identity, whether the
rotate lock needs a wheel skin, and #6 are "unsure"; fullscreen scroll is VIDEO
fullscreen, page-vs-overlay undetermined. **Scope ruling: swipe-back stands down on
scrubbers only.** ntfy deferred. Go given for R3 + the scope change + R4; R0 and R2
stay diagnosis-only until device evidence arrives (Dean will run the inline test:
play a video and do NOT enter fullscreen).

## Research (evidence gathered before any edit)

- **R0 is not the server, transcoding, or the image.** Docker Hub manifests for
  `deantammam/filetube:1.311.0`, `:1.311.1`, `:1.311.2`: layers 0-6 (Alpine base,
  Node, the `apk add ffmpeg` layer, yt-dlp, npm deps) are byte-identical digests
  across all three. Only the app-code layers (7-12) differ, and `git diff
  v1.311.1 v1.311.2` touches no server code (only `lib/ytdlp/views/subscriptions.html`).
  No dangling reference to the removed skip buttons remains in `public/` or `lib/`.
  **Hypothesis:** the `position:fixed` body pin faux fullscreen now takes
  breaks the iOS video layer. **Falsified by:** a black picture INLINE (inline
  takes no lock), or black on `:1.311.1`.
- **R3 mechanism (source).** `.mms-full{position:fixed}` lives inside
  `@media (max-width:768px)` (style.css:11127). The wheel skins (ipod, ipod-black,
  ipod-matte, zune-classic: every `.ip-wheel`) pin the body via the haptic ghost
  (skin-surface.js `mountWheelGhost`). Its only structural release is a childList
  MutationObserver (the ghost leaving the DOM). A rotate to ~844px un-fixes the panel
  but leaves the ghost attached, and nothing re-ran the view's panel update on a
  viewport change (music.js's only resize listener serves the pop-out). So the body
  stays pinned. The same strand has existed since v1.256 (v1.311.1's private copy
  pins identically); v1.311.2 made it inescapable, because swipe-back stood down
  while any lock owner was held. **Falsified by:** the lock-up on Cider or Nordic
  (no wheel, no lock).
- **R4.** Dean's v1.311.0 ruling: TAPPING a chapter row plays that chapter only, then
  radio; the album PLAY button plays every chapter. The chapter suites are green on
  main (114/114).

## Acceptance

- **A1 rotate releases the skin lock.** When the viewport changes (resize or
  orientationchange) and the full-screen skin panel no longer computes
  `position:fixed`, the engine releases its body lock, removes its ghost and lifts
  `mms-haptic`, even while paused (no reflect/click). A same-side resize keeps the
  lock. `destroy()` removes the viewport listener. Bound in `skin-surface.test.js`.
- **A2 the views re-render on a crossing.** music.js and podcasts.js both route a
  crossing of the 768px gate through ONE shared `SkinSurface.watchSkinViewport` to
  their `updateNowPlayingPanel` (bound to the view signal). The helper fires once per
  crossing, never on a same-side resize, and not after abort. The podcasts desktop
  branch drops `body.mms-on` (music parity).
- **A3 swipe-back: scrubbers only (Dean's ruling).** Owners are `[data-skin-seek]`,
  `.ip-wheel`, `.ipod-brick`, `.whcal-stage`, `input[type=range]`, `[role=slider]`,
  plus the touch-action NET outside `.mms-full` (inside it, touch-action is the page
  lock). The whole player host, the whole skin, faux fullscreen / expanded audio /
  native fullscreen, and a held body lock no longer stand the back down. Bound in
  `swipe-back-owners.test.js` against real shell and real skin markup.
- **A4** chaptered album verified end to end (Play, and a row tap), reported plainly.
- **R0 / R2:** no code until a device observation names the cause.

## Build notes

- `skin-surface.js`: `panelCovers` + `onViewportChange` (viewport-only on purpose: a
  per-timeupdate computed-style read would recalc style 4x a second, and every other
  un-render clears innerHTML, which the observer already heals); listeners in
  `bind()`/`destroy()`; `watchSkinViewport` exported.
- `common.js`: `SWIPE_BACK_OWNER_SELECTORS` narrowed, `SWIPE_BACK_NET_EXEMPT_ROOT`,
  `swipeBackImmersiveLive` deleted (no other caller) along with its release-time check.

## Deviations

- The wheel-calibration owner narrowed from `.whcal-overlay` to `.whcal-stage` (its
  spin area), per "scrubbers only". Its Step control is a range input (still covered).
