---
plan: post-311-2-regressions
harness: v2 · filetube
branch: fix/post-311-2-regressions
anchor: outcome
status: Gate:pending r1 @54cc993b
next: dual-Node full suites @54cc993b, then FULL gate r1 (adversary + qa); R0/R2 await Dean's device answers
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
  **Result: Dean's oddity was REAL** (see R4 below), so A5/A6 were added.
- **A5 the album END stations on.** At the whole-file `ended`, the cascade's rewind to 0
  never re-registers nav: `reflectChapter` holds from `ended` until the next
  `play`/`loadstart`. The ended advance plays the radio-armed track, never chapter 2. A
  play after the end (a loop replay, or the user) re-reflects chapter 1. Bound in
  `music-chapter-reflect.test.js` in the real order (arm, `ended`, the rewind tick, the advance).
- **A6 (Dean's ruling, 2026-09-23) a chapter tap near its end starts it over.** A saved
  place in a chapter's last 5s (`CHAPTER_RESUME_TAIL_SEC`), or past its end, loads at the
  chapter head. An earlier saved place still resumes (v1.222). `chapterResumeSecFor` is the
  one producer of `chapterResumeSec`. Bound by a real row-click test and boundary checks.
- **R0 / R2:** no code until a device observation names the cause.

## R4 end-to-end findings (headless Chromium, a real 4-chapter mp3 + 3 other tracks)

Run by a delegated agent in a `git archive` sandbox (own port, throwaway DATA_DIR,
static ffmpeg 7.0.2; logs in the session scratchpad `r4/`, `r5/`).
- @07e3572d, **album Play: FAILED** at 1280 and 390. Every file end reloaded the
  album at Chap Two (`ended t=0` -> `NAV at registerTrackNav < reflectChapter` ->
  `playAt(1)`). A second end stopped playback dead on "Chap Two". Cause, confirmed in
  source: `player.js` `runEndedCompletionCascade` sets `el.currentTime = 0`; the tick
  from that re-registered chapter 1's nav over the radio arm. A v1.311.0 bug: its test
  fired `onNext` right after arming and never drove `ended`.
- Row tap: passes. Re-tapping a chapter just heard to its end resumed at 15.74 of
  [8,16) and exited after ~0.35s (this led to A6).
- @b1ad075f re-run: album Play 1280 natural (One->Four, then Other Song 2, the file
  never reloaded), 390 skin, and the row tap: PASS. Loop ON: "Loop chapter" repeats the
  last chapter (`ended` never fires naturally); a forced end replays from 0 and shows
  Chap One.

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

## Verification (builder, @07e3572d)

- Full suite `npm test`: Node 22.23.1 8942/8942 pass, 0 fail, 0 skipped; Node 24.20.0
  8942/8942 pass, 0 fail, 0 skipped (sequential).
- Mutants (sandbox from `git archive 07e3572d`, run against skin-surface, swipe-back-owners,
  body-scroll-lock, music-skin-integration): M1 no viewport listener · M2 covers never
  checked · M3 covers always false · M4 ghost left in DOM · M5 mms-haptic kept · M6 helper
  no dedup · M7 helper ignores signal · M8 music.js call dropped · M9 podcasts call dropped
  · M10 `.mms-full` owner restored · M11 NET exemption removed · M12 player host owner
  restored · M13 immersive stand-down restored · M14 lock stand-down restored · M15
  `.whcal-stage` dropped · M16 Brick dropped: all 16 KILLED.
- Not bound: `destroy()` removing the viewport listener. A stale listener is inert (with
  no lock held, `onViewportChange` returns early), so that mutant is equivalent. The test
  instead binds that a destroyed skin never releases another owner.
- The rotate is modeled in jsdom by flipping a `.mms-full{position}` rule (jsdom never
  matches media queries). The device confirmation is Dean's.

## Verification addendum (@54cc993b)

- Album-end mutants (sandbox): H1 hold check removed · H2 hold never set · H3 play never
  clears: all KILLED. Tail-rule mutants: T1 rule removed · T2 builder bypasses the helper
  · T3 `>` for `>=` · T4 tail 10s: all KILLED.
