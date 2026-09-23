---
plan: post-311-2-regressions
harness: v2 · filetube
branch: fix/post-311-2-regressions
anchor: outcome
status: Gate:CHANGES r1 @de29fc19
next: gate r2 delta re-confirmation (same adversary + qa instances) on the r1 fix round; then release v1.311.3
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
  lock. `destroy()` removes the viewport listener (unbound on purpose: a stale listener
  is inert; the test binds that a destroyed skin never releases another owner). A rotate
  DURING a wheel scrub never re-locks when the finger lifts (gate r1 W1). Bound in
  `skin-surface.test.js`.
- **A2 the views re-render on a crossing.** music.js and podcasts.js both route a
  crossing of the 768px gate through ONE shared `SkinSurface.watchSkinViewport` to
  their `updateNowPlayingPanel` (bound to the view signal). The helper fires once per
  crossing, never on a same-side resize, and not after abort. The podcasts desktop
  branch drops `body.mms-on` (music parity), and both desktop branches reset the panel's
  skin classes. Bound behaviourally through each REAL view (gate r1 W2).
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

## R0 / R2 device evidence (Dean, 2026-09-23) and the WebKit bisect

- Dean: black video happens INLINE too, on EVERY video, mobile only. That **falsifies**
  the body-lock hypothesis (inline takes no lock). He cannot pin `:1.311.1` right now, and
  declined an on-device diagnostics readout. R2: after a drag in video fullscreen the page
  STAYS moved (not a rubber-band spring-back).
- Source bisect v1.309.0..HEAD: no change touches the video element's visibility, opacity,
  transform or layers. The `mms-on` rules that hide player parts are scoped to
  `#view-root[data-view="music"]` (cannot reach the watch page).
- Playwright WebKit 1.58.2 (WebKitGTK, "Version/26.0", iPhone 13 emulation), a real
  H.264/AAC mp4, sandboxes from `git archive v1.311.1`, `v1.311.2`, `de29fc19`: every build
  paints the picture (videoWidth 640, readyState 4, 1/121 near-black samples) inline with
  native controls, inline custom, in faux fullscreen and after exit; no hidden ancestor;
  the video is the top element. Only difference: v1.311.2+ pins the body in faux
  fullscreen (expected). Synthetic vertical drags in faux fullscreen: no scroll leak.
- **Conclusion: R0 and R2 are NOT diagnosed and NOT fixed.** WebKitGTK is not iOS's
  AVFoundation compositing, so an iOS-only cause is not ruled out. They ship DISCLOSED.

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

Gate: APPROVED r1 @de29fc19 — qa

Gate: CHANGES r1 @de29fc19 — adversary

## Verification (@de29fc19, builder)

- `npm test` Node 22.23.1: 8946/8946 pass, 0 fail, 0 skipped. Node 24.20.0: 8946/8946
  pass, 0 fail, 0 skipped (sequential, before the gate).

## Gate r1 fix round

| Finding | Fix | Binding |
|---|---|---|
| ADV W1 rotate mid-scrub re-locks on the finger lift | `endWheel` flushes a deferred paint only into a panel still wearing `mms-full`; `onViewportChange` drops the deferred paint + ends the spin when the panel stops covering (before the release, lock or not: a real resize lets the ghost observer release first) | W1 test (view re-render, microtask order), W1 no-re-render test (DOM sentinel + lock count), dock sibling test |
| ADV W2 view wiring only source-locked | - | music-skin-integration + podcast-nowplaying-view rotate tests through the real views (panel classes, transport, `mms-on`, both directions) |
| QA S2 desktop panel kept skin classes | both desktop branches reset `className` | killed by the W2 tests (F6, F7) |
| ADV S1 watcher start state / S2 orientationchange | - | start-wide + orientationchange-alone test |
| ADV S3 `loadstart` clear unbound / S4 paused seek after the end | `seeked` above 0.5s releases the hold and re-reflects | hold test; the end-rewind test now fires the rewind's own `seeked` at 0 |
| QA S1 over-claiming test title | retitled; A1 says the listener removal is unbound | - |
| QA S5 stale player.js comment | "no swipe-back" dropped | - |
| QA S6 / ADV S5 stale plan markers | fixed; the de29fc19 dual-Node record added | - |
| QA S3 hold until play | fixed by S4 | - |
| QA S4 source lock | superseded by behavioural W2 tests | - |

Found while fixing W1 (sibling, same seam): a spin that outlived a view-side DOCK flushed
its deferred paint into the docked panel (un-hiding it). Closed by the same flush guard.

Fix-round mutants (sandbox from `git archive 3b4a9b12` + the final tests): F1 flush guard
removed · F2 viewport keeps the deferred paint · F3 music watch call dead · F4 podcasts
watch call dead · F5 podcasts `mms-on` removal dropped · F6/F7 className resets dropped ·
F8 watcher starts narrow · F9 no orientationchange · F10 `loadstart` clear dropped · F11
seek release dropped · F12 seek release at 0: all 12 KILLED (F2 and F12 survived the
first run and were bound before this record).
