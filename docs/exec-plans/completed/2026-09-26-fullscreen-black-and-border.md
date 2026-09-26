---
plan: fullscreen-black-and-border
harness: v2 · lean
branch: feat/v1.336-fullscreen-black-border
anchor: outcome
status: Shipped v1.336.0
next: none - shipped. Dean owes the D1 capture and the D2 device check (tech-debt #284).
gate: APPROVED r2 @c712521c (adversary, qa)
---

# v1.336.0: the fullscreen video goes black after pause/resume, and the thin white border in fullscreen

## The asks (Dean, 2026-09-26, verbatim)

- **D1** "a recent regression where if I'm watching a video in full screen, there's some way in which after
  I pause or resume, pause and resume again, the screen of the video goes black. Unsure why."
- **D2** "in full screen, in all modes, I see a very thin white border around the entire screen. It doesn't
  appear in the screenshots, but it totally appears for our faux overlay."

Priority: D1 first, then D2. One plan, one gate, one release.

### Dean's answers at intake (AskUserQuestion, 2026-09-26)

- Which fullscreen: **the faux overlay, iPhone PWA**.
- While black: **audio keeps playing and the controls still show** (only the picture is black).
- What brings the picture back: **nothing / not tried**.
- Scope: **every video**; ambient / lighting was NOT marked on (corrected by the second round below).

### Dean's second answers (AskUserQuestion, same session)

- Pause/resume with the bar's play button only (never tapping the picture): **can't try now**.
- Once black, leave fullscreen: **still black inline**. The video element itself stopped showing
  frames; it is not a layer painted over the overlay.
- On: **dark mode, Ambient (cog menu), background audio for video**. (His first answer left ambient
  unmarked; this one is the discriminating read and it wins.)
- Since when: **not sure**.

### Dean's third answers (after gate r1 questioned the screenshot claim)

- The line's color in dark mode: **grey-ish**. It shows on a **paused** video and while playing.
  That matches the measured border (rgb 45-56 in the dark modes, rgb 204-226 in the light ones,
  painted in every state).

## Acceptance (outcome anchor)

1. D1: the four hypotheses are named with their falsifiers, and an instrument ships that separates them
   from ONE failing run on Dean's iPhone (the video's decode state, which element is sounding, its
   presentation mode, ambient, the overlay), proven to fire on the real media events and to be a no-op
   without `?debugLifecycle=1`. The fix is the next release, on the mechanism the capture names.
2. D2: the faux fullscreen overlay covers the whole screen edge to edge in every theme and era; no light
   edge shows; the cause is named, and why a screenshot missed it.
3. Everything outside the two fixes is byte-identical (skins probe, Off paths); anything headless cannot
   show is disclosed as Dean's device check.

## Decisions

| ID | Decision |
|---|---|
| D1 | NOT fixed this wave. Headless Chromium cannot show an iPhone video layer going black, and no device A/B exists yet, so a fix would be a theory-fix (LESSONS 1). This wave ships the INSTRUMENT: the video's own state in the `?debugLifecycle=1` log at every event that can start, stop or starve its picture, plus a check after each `playing` (one reading a second for six seconds, logged as one line with the frame series). The on-screen panel shows those lines in full and, in faux fullscreen, sits at the top and lets taps through. Dean captures one failing run; v1.337 fixes the mechanism it names. |
| D2 | Fixed: every fullscreen (the iPhone faux overlay, the Fullscreen API host, the staged desktop twin) drops the inline player's 1px `--border-color` border and its era radius. The inline player is unchanged. |
| B1 | (builder, disclosed) D2 covers DESKTOP fullscreen too: the probe measured the same border there in 8 of 8 themes, plus a 2px (2009/2014) or 12px (2021) rounded corner on the black stage. Dean's "in full screen, in all modes" does not exclude it; the rule is the same bug. |
| B2 | (builder) The instrument never calls `requestVideoFrameCallback` and never reads the video into a canvas: in WebKit both attach a video output to the player (the v1.312 ambient blackout's shape), so the instrument could cause the black it measures. It reads properties and calls `getVideoPlaybackQuality()`, which on iOS starts the GPU process polling the video LAYER's metrics on a background queue (what any page calling the API gets; no video output). A test bans both calls in player.js. |

## Research

### D2 - hypothesis, falsifier, measurement

- Hypothesis: the base `.player-container` rule (style.css, since the first commit) paints
  `border: 1px solid var(--border-color)`; `#player-wrapper.css-fullscreen` resets only
  `border-radius`, so the border rings the whole screen. The audio-expanded overlay has
  `border: none` (and never showed it), and so does the dock.
- Falsifier: a computed border of 0 on the overlay in faux fullscreen, or an overlay rect smaller than
  the viewport (then the edge would be the page showing through, a different cause).
- Measured (`scripts/faux-fullscreen-probe.js`, new: the real app, a real H.264 clip, the custom
  player on, iPhone emulation, the REAL `#fs-btn`; 4 eras x light/dark x portrait 390x844 and
  landscape 844x390, plus desktop 1280x800 staged fullscreen):
  - base 9946a335: `SUMMARY combos=24 edge-painted=24`. The overlay rect = the viewport exactly
    (0,0 390x844 etc.), the border 1px solid rgb(204-226) in the light modes and rgb(45-56) in dark,
    the video inset to (1,1) 388x842. Desktop adds a 2px (2009/2014) or 12px (2021) radius.
  - The headless PNG carries it: 2021 light, portrait, left/top/right edge pixel (226,226,226), the
    next pixel (0,0,0).
  - branch: `SUMMARY combos=24 edge-painted=0`; the video fills (0,0) to the full viewport in every
    combo. INLINE (before fullscreen) identical on both trees: `1px solid rgb(226, 226, 226)`, radius
    12px, video 17,73 356x200.25 (portrait) and 255,81 564x317.25 (landscape).
- Dean's line matches this border by every property he could report: grey-ish in dark mode (the
  measured ring is rgb 45-56 there), present paused and playing, every mode, on the faux overlay.
- OPEN: why his screenshots miss it. Our headless screenshot contains it (above), and an iOS
  screenshot captures a painted CSS border pixel for pixel, so the earlier "a light edge blends into
  a light viewer" explanation does not hold in his dark mode and is withdrawn (gate r1, both seats).
  His D2 device check is the falsifier: an edge still there after v1.336 means his edge has another
  cause, and it is re-root-caused, not re-patched.

### D1 - hypotheses and what would falsify each

The bisect over v1.311.2..v1.335.0 (corrected at gate r1; the first summary said player.js changed
only in v1.322 and v1.334, which was false): `git log --oneline v1.311.2..v1.335.0 --
public/js/player.js | wc -l` = 18 commits, released in v1.311.3, v1.317, v1.319, v1.320, v1.322 and
v1.334. The two that touch the suspects: v1.319 (77a3f5bc, "resume the video only if the audio was
playing", the background-audio swap-back; background audio is ON for Dean) and v1.318 (the Ambient
engine moved out of watch.js into ambient.js; Ambient is ON for Dean). No release in the window adds
a filter/mask/transform on or over the video, and none adds a `load()` or `src` reset on a user
pause/resume in the foreground.

| Hypothesis | Where | Falsified by |
|---|---|---|
| H1 Ambient (ON on Dean's phone; engine moved to ambient.js in v1.318). It re-evaluates on every play/pause (ambient.js:668-672), keeps running in faux fullscreen (no fullscreen exclusion), and repaints/cross-fades its two layers. v1.312's blackout had this exact signature (picture black, audio and glow continuing). | ambient.js, style.css `.ambient-glow` | It still goes black with Ambient OFF in the cog. |
| H2 The background-audio sidecar (ON on his phone; its swap-back changed in v1.319): the sound after the black comes from the hidden audio element, not the video. | player.js handoff / priming / swap-back | At the black resume the log reads `act=video`, `bgp=1` (the sidecar is paused) and `mu=0`: the sound can only be the video's. (`act` alone cannot rule it out: it is derived from the same state as `bg`, gate r1.) |
| H3 The tap glyph: every tap on the picture flashes `.art-play-glyph` (a `filter: drop-shadow` + an opacity/scale animation) over the video. Old (2026-08-16), so "recent" fits only an iOS change. | style.css `.art-play-glyph` | It still goes black using only the bar's play button. |
| H4 v1.311.2 (2026-09-23): faux fullscreen pins `<body>` with `position:fixed` (a stacking context around the fixed overlay). | body-scroll-lock.js | Weakened already: the picture stays black INLINE after leaving fullscreen (the lock is released there). |

The instrument's `video:check` line separates the layer from the frames by its SERIES `fser` (the
layer frame count at each of six seconds after the resume): climbing while black = frames reach a
layer that is not shown (H1/H3); flat while `+t` runs = no frames reach the layer, or there is no
layer (the series cannot tell those two apart; `wh`, `rs` and the A/B tries narrow it); `act=bgAudio` = H2; `pm` other than `inline` = iOS moved the video to a native presentation.
What the counters mean ON THE IPHONE (WebKit main, primary source, fetched 2026-09-26):
`HTMLMediaElement::getVideoPlaybackQuality` (Source/WebCore/html/HTMLMediaElement.cpp) adds
`player->videoPlaybackQualityMetrics()`, which for the AVFoundation player
(Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateAVFoundationObjC.mm) is
`[m_videoLayer videoPerformanceMetrics]`: the AVPlayerLayer's own `totalNumberOfVideoFrames` /
`numberOfDroppedVideoFrames`, and `std::nullopt` with no layer. On the iPhone media runs in the GPU
process, so the page reads `MediaPlayerPrivateRemote::videoPlaybackQualityMetrics`, a CACHED copy
that `RemoteMediaPlayerProxy` refreshes about every 2s while the page keeps asking, never while
paused, and that keeps its last value with no layer (gate r1 adversary, WebKit main). So one reading
2s after a resume can read `+f=0` on a healthy video: the check is therefore a six-second SERIES, one
read a second, spanning at least two refreshes. `webkitDecodedFrameCount` is
`[Conditional=MEDIA_STATISTICS]` in HTMLVideoElement.idl and MEDIA_STATISTICS is off on Cocoa: `dec`
reads `-` on the iPhone (Chromium fills it). `displayCompositedVideoFrames` is exposed only behind
`videoQualityIncludesDisplayCompositingEnabled` (VideoPlaybackQuality.idl), so `dc` is printed only
when present.

Reachability (the probe, real Chromium media events, `?debugLifecycle=1`, faux fullscreen, pause /
resume x2 by `#pp-btn`): r1 `INSTRUMENT pause=2 playing=2 check=1 fs-at-pause=2`; base: all 0. The r2
numbers (panel text, real touch tap) are in the fix round below.

## What ships (v1.336.0)

1. D2 fix (style.css: three fullscreen rules gain `border: none; border-radius: 0`).
2. The D1 instrument (player.js: `formatVideoStateDetail` pure + `readVideoState` / `recordVideoState`,
   wired on pause, playing, waiting, stalled, emptied, error, resize, loadstart,
   webkitpresentationmodechanged). A no-op unless `?debugLifecycle=1`.
3. `scripts/faux-fullscreen-probe.js` (the measurement above) and
   `test/unit/fullscreen-edge-and-video-state.test.js`.

## Deviations

- Acceptance 1 was written as "D1 fixed" at intake; research found no headless repro (Chromium cannot
  show an iPhone video layer going black) and no device A/B yet, so per the brief's own branch
  ("otherwise ship an instrument and have Dean capture one run") and LESSONS 1, D1 ships as an
  instrument. The ROADMAP D1 item stays open, marked instrumented.

## Fix round r1 -> r2

Both seats CHANGES r1 @5996fbc2 (findings in the Gate section). What changed:

| Finding | Fix |
|---|---|
| QA 1 / adv 1 (CRITICAL): the panel cut every line at 60 chars | `video:` lines render in full (cap 400, bound by a test that the longest possible line fits); other types keep 60. The probe now reads the PANEL's rendered text, not the store. |
| QA 2 (CRITICAL): the panel covered the fullscreen bar and a tap cleared the log | In faux fullscreen the panel moves to the top (safe-area padded) with `pointer-events:none` (style.css, `!important` over its inline style). The probe taps `#pp-btn` with a REAL touch event. |
| adv 2: `f` is a ~2s cached copy on the iPhone | The check is a six-reading series (`fser`), 1s apart. |
| QA 4: `act` cannot falsify H2 | `bgp` (the sidecar's own paused), `mu`, `vol` added; H2's falsifier rewritten. |
| QA 3 / adv 6: comments on `dec` | Corrected in player.js and the probe: `dec` reads `-` on the iPhone. |
| adv 3: the bisect summary was false | Rewritten with the measured count and the two relevant commits. |
| QA 5 / adv 4: the screenshot claim | Withdrawn; Dean's third answers recorded; left OPEN with his check as the falsifier. |
| adv 5: 7 surviving mutants | Delta and series are pure, exported and tested; locks for the 'playing' trigger, the cadence constants, the reader's `act`/`bgp`/`amb` sources (plus ambient.js writing `data-ambient-on`), the unconditional wiring, and a CSS scan that no fullscreen host rule re-adds an edge. The probe exits 1 on any failure. |
| adv 7: B2 overstated | B2 rewritten. |
| QA 6: skins byte-identity unrecorded | Recorded below. |
| QA 7 (log crowding) | Not changed: the adversary measured 6 entries per pause/resume cycle, so the 30-entry ring holds 5 cycles; the check stays ONE line. |

### r2 measurements (copied from the runs)

- Skins zero-delta (`scripts/pocket-render-probe.js`, LIGHTS=off, base 9946a335 vs the branch at
  5996fbc2): `TOTAL: 782 shots, 0 differing pixels, 0 differing element styles, 0 missing`. The r2
  CSS adds only `body.ft-css-fullscreen #ft-lifecycle-overlay`, which matches no pocket element.
- `node scripts/faux-fullscreen-probe.js` on the r2 tree, exit 0:
  - `TAP pp-btn hit=(none) paused true->false log 3->5 ok` (the tap reached the button's inner icon
    and played; the log kept its entries)
  - `INSTRUMENT pause=3 playing=3 check=1 fs-at-pause=3`
  - `PANEL ok video:check (rs=4 ns=1 p=0 wh=640x360 t=8.1 f=206/0 dec=206 pm=- act=video
    bg=inline_video bgp=1 mu=1 vol=1.00 fs=1 ah=1 amb=0 lock=1 ld=1 +f=150 +dec=150 +t=6.0
    fser=25,50,75,100,125,150) ...` (the healthy series: it climbs every second)
  - `SUMMARY combos=24 edge-painted=0`; INLINE identical to base.
- The same probe with FT_ROOT = base 9946a335, exit 1: `TAP pp-btn hit=ft-lifecycle-overlay paused
  true->true log 2->0 FAIL` (QA r1 finding 2 reproduced), `PANEL FAIL`, `SUMMARY combos=24
  edge-painted=24`.
- `node --test test/unit/fullscreen-edge-and-video-state.test.js`: `# tests 17`, `# pass 17`,
  `# fail 0`. The pre-existing panel lock (test/unit/player-lifecycle-release.test.js, the 60-char
  cut) was updated to bind the new cap: 39/39. `npm run lint:css`: `TOTAL 0`. `npm run lint:overlay`: `clean (0 violations)`.

## Carried to v1.337 (gate r2, disclosed; the next release touches the instrument for the D1 fix)

Both seats APPROVED r2 @c712521c with these left open, none blocking (a code change now would be a
third round):

- adv W1: nothing binds the frame SERIES (`samples.push(s.frames)` survives the tests and the probe).
  The behaviour at c712521c is measured correct (`fser=25,50,75,100,125,150`). Fix: the probe asserts
  a climbing series and `mu=1`.
- adv S1: the series keeps sampling through a pause; a check with `p=1` has a flat tail. Reading
  guide: judge a check by its `p` first.
- adv S2: in landscape the panel's 6px left padding sits under the 59px left inset (the first
  characters of its top lines under the rounded corner). Fix: left/right safe-area padding.
- adv S3: three mutants survive the unit locks (a stronger non-fullscreen host rule re-adding a
  border, the wiring inside an `if (false)` at the same indent, `detailCap` reset to 60 after the
  ternary); the probe would catch the first and third (reasoned, not run).
- qa b / adv S5: `bgp=0` also reads during the muted gesture-prime play; the comment "bgp=0 while
  act=video = the sound is not the video's" overstates. Fix: log the sidecar's muted flag.
- qa a / adv S4: done in this doc (Dean's steps say to leave fullscreen before scrolling).

## Dean's device check (after v1.336)

- D2: fullscreen, any theme: no light edge.
- D1: open `<app>/?debugLifecycle=1` once; play a video, fullscreen, pause/resume until it goes black;
  wait 8 seconds; screenshot the log panel (at the TOP while in fullscreen, newest line first). For
  the older lines, leave fullscreen first (the panel ignores touches in fullscreen, so a swipe there
  moves the picture), then scroll it and screenshot again. Leaving fullscreen adds no entries. Also, if he can: the same
  with Ambient OFF, and once using only the bar's play button.

## Gate

Gate: CHANGES r1 @5996fbc2 - qa

1. CRITICAL - the capture cannot be read from Dean's screenshot. public/js/player.js:4566 (unchanged) renders
   `String(entry.detail).slice(0, 60)`; the new detail lines are 114-133 chars. An iPhone-shaped reading renders as
   `rs=4 ns=1 p=0 wh=1920x1080 t=734.2 f=18342/3 dec=0 pm=inline ` and stops: no act/bg/fs/amb/lock/ld, and the
   video:check deltas `+f/+dec/+t` (the plan's primary discriminator) never appear. Measured in headless faux
   fullscreen: the RENDERED overlay line is `video:check (rs=4 ns=1 p=0 wh=640x360 t=2.0 f=53/4 dec=53 pm=- act=video )`
   while localStorage holds `... +f=49 +dec=49 +t=2.0`. The probe reads localStorage, never the overlay, so its
   reachability proof misses what the device shows. Fix: every discriminating field visible in the rendered
   overlay, bound by reading the overlay's textContent (probe and/or test), not the store.
2. CRITICAL - with ?debugLifecycle=1 the debug overlay (fixed, bottom:0, z 999999, max-height 35vh,
   pointer-events:auto, tap = clear log) sits over the faux-fullscreen control bar. A real touch tap
   (Input.dispatchTouchEvent) at #pp-btn's centre hits `ft-lifecycle-overlay` and CLEARS THE LOG without pausing:
   390x844 logLen|paused 10|false -> 0|false; 844x390 15|false -> 0|false. Dean's procedure ("pause/resume until
   black", and the H3 run "using only the bar's play button") erases its own capture; any tap in the bottom 35vh of
   the picture does too. The probe's `pp-btn.click()` bypasses hit-testing, so it could not see this. Fix: the
   overlay must not take taps over the player in faux fullscreen (e.g. pointer-events:none while
   body.ft-css-fullscreen; he reads it after leaving fullscreen), bound by a real touch tap in the probe
   asserting paused flips and the log survives.
3. WARNING - lying comment, scripts/faux-fullscreen-probe.js (D1 block): "Chromium has no webkitDecodedFrameCount
   ... so those read '-' here; the iPhone fills them". Inverted: this probe's own output reads `dec=19`..`dec=85`
   in Chromium, and the plan (WebKit source) says dec reads 0 on the iPhone. 5996fbc2 corrected player.js but not
   the probe. A reader of a device capture primed by this comment reads dec=0 as "decode stopped".
4. WARNING - `act` cannot falsify H2. player.js readVideoState: `act` = activeMediaElement(), a pure function of
   bgAudioState, so `act=video` iff `bg` is inline/swap-back: the plan's H2 falsifier ("act=video with
   bg=inline_video") is circular. Scenario: bgAudioEl.paused=false (sidecar sounding) while
   bgAudioState=INLINE_VIDEO -> logs `act=video bg=inline_video` -> the plan's table reads H2 as falsified. Acceptance 1
   promises "which element is sounding". Fix: log the sidecar's own paused/currentTime and the video's
   muted/volume (plain reads).
5. WARNING - D2 overclaims "why a screenshot missed it". The plan says "on his phone it is 3 device pixels of
   near-white", but Dean runs DARK mode, where the measured ring is rgb(45,45,45)/(51,51,51)/(52,48,43)/(56,56,56)
   (base probe). A painted CSS border lands in an iOS screenshot pixel for pixel, so the asymmetry Dean reports
   ("doesn't appear in the screenshots") is NOT explained by this cause. The fix is right (the border is real,
   24/24 -> 0/24), but record the asymmetry as open and make Dean's D2 check a falsifier: a light edge still
   there in dark mode after v1.336 means his edge has another cause.
6. WARNING - acceptance 3 is unevidenced at this sha: "skins probe" byte-identity has no recorded run in the plan
   (only INLINE geometry). Record the run's summary line, or narrow the claim.
7. SUGGESTION - the log ring: at a plain load+play+fullscreen, 6 of 10 entries are video:* (measured); the ring
   stays LIFECYCLE_LOG_CAP=30, whose comment budgets for a handoff cycle, and the flag is shared with the open
   #282 notification capture. Consider scoping video:* to css-fullscreen or raising the cap (with its lock).
8. SUGGESTION - player.js recordVideoState comment "(frames decoded vs media time)" and the test's "zero frames
   decoded": `+f` is totalVideoFrames (the layer's count on the iPhone, per the header comment), not decoded frames.
9. SUGGESTION - frontmatter `next: commit the build, then the gate` is stale (the build is committed); the
   deviation's "ROADMAP D1 item ... marked instrumented" is not in this sha (fine if it lands in the release commit).

Evidence (qa, Node 22.23.1): `npm run test:unit` -> `# tests 7463` `# pass 7463` `# fail 0` EXIT=0; `npm run lint` ->
`6 problems (0 errors, 6 warnings)` (all in public/js/common.js, untouched); `npm run lint:css` -> `TOTAL 0`;
`npm run lint:overlay` -> `overlay-containment: clean (0 violations)`; `bash .harness/lib/check-markers.sh` ->
`check-markers: clean (docs/exec-plans)`; probe on HEAD -> `INSTRUMENT pause=2 playing=2 check=1 fs-at-pause=2`,
`SUMMARY combos=24 edge-painted=0`; probe with FT_ROOT=git archive of 9946a335 -> `INSTRUMENT pause=0 playing=0
check=0 fs-at-pause=0`, `SUMMARY combos=24 edge-painted=24`; INLINE lines identical on both trees. U+2014 in the
diff: 0. Security: no surface of concern - the probe binds 127.0.0.1, mints its session in-process
(`__mintTestSession`, not a route), uses mkdtemp dirs and execFileSync with argv arrays (no shell); like its
siblings it leaves its temp dirs (a scratch session-secret, 0600). The instrument writes element state only
(no title/id/URL/user) to the existing same-origin debug log, rendered via textContent, flag-gated before any read.

Gate: CHANGES r1 @5996fbc2 - adversary

1. CRITICAL - the capture is truncated on the only surface Dean can read (concurs with qa 1, measured independently).
   renderLifecycleOverlay (player.js:4566, unchanged) prints `String(entry.detail).slice(0, 60)`. A scratch copy of the
   probe (FT_ROOT = git archive of 5996fbc2) that reads `#ft-lifecycle-overlay` textContent after 2 pause/resume cycles
   and a fullscreen exit prints `video:check (rs=4 ns=1 p=0 wh=640x360 t=9.6 f=245/1 dec=245 pm=- act=vide) ...`,
   while the stored entry ends `... ld=1 +f=50 +dec=50 +t=2.0`. An iPhone-shaped line (formatVideoStateDetail with
   1920x1080, t=754.21, f=18234/12, dec undefined) is 134 chars; the panel shows only
   `rs=4 ns=1 p=0 wh=1920x1080 t=754.2 f=18234/12 dec=- pm=inlin`: act, bg, fs, amb, lock, ld and all check deltas are
   cut. The shipped probe reads localStorage, not the overlay, so its reachability proof missed this (LESSONS 2, inert
   feature). Fix: every discriminating field visible in the RENDERED overlay, bound by reading the overlay text.
2. WARNING (blocks) - on the iPhone `f` does not mean what the plan says. The plan cites
   MediaPlayerPrivateAVFoundationObjC, but on Cocoa media runs in the GPU process (PlatformEnableCocoa.h
   `#define ENABLE_GPU_PROCESS_BY_DEFAULT 1`; UnifiedWebPreferences.yaml UseGPUProcessForMediaEnabled true under it).
   The page calls MediaPlayerPrivateRemote::videoPlaybackQualityMetrics (WebKit main,
   WebProcess/GPU/media/MediaPlayerPrivateRemote.cpp), which returns a CACHED copy (`return m_cachedState.videoMetrics;`).
   RemoteMediaPlayerProxy.cpp refreshes it on pause/rate/readyState changes, when the page's query cadence changes, and
   on the cached-state timer (2000 ms when observing time changes, else 250 ms), never while paused
   (maybeUpdateCachedVideoMetrics returns if `m_cachedState.paused`). The page stops the refresh after 30 s with no
   query, and keeps the LAST value when the layer is gone (`if (state.videoMetrics)` only overwrites a present value).
   From that code (not measured on a device): (a) pause at P, resume at P+3s: the 'playing' query renegotiates the
   interval to 3 s (next refresh at resume+2.75s), so the check at resume+2s returns the value from the resume and
   reads `+f=0 +t=2.0` on a HEALTHY video. That is the plan's "frames stopped" signature, for any resume gap over
   ~2.25 s. (b) With no layer, `f` freezes instead of dropping to 0, so "layer torn down" and "frames stopped" read
   the same. Fix: poll the quality object at a steady 1 s cadence while the flag is on and the video plays, and take
   the check later (e.g. +4 s, or +2 s and +5 s). Correct the plan's counter semantics and cite the Remote path. Also
   log a healthy baseline check in the same capture. This prescription is reasoning, not a measurement.
3. WARNING - the plan's bisect summary is false. It says "player.js changed in v1.322 (Chapter Snap) and v1.334
   only". `git log --oneline v1.311.2..v1.335.0 -- public/js/player.js` lists 17 commits, first released in
   v1.311.3 (3b4a9b12), v1.317 (bc488b95, 35a3bb1d), v1.319 (77a3f5bc lock-to-audio: "resume the video only if the
   audio was playing"; background audio is ON for Dean), v1.320 (a28f8b32, 612cadd5), v1.322 and v1.334 (+660 lines).
   `git diff --stat v1.311.2 v1.335.0 -- public/js/ambient.js` = 762 insertions: the H1 engine (Ambient is ON for Dean)
   moved into ambient.js in v1.318 (45815d94, 45284736, 61904f6c) inside the regression window. The H1 row omits this.
   Fix: correct the Research text. The v1.337 bisect should start at v1.318 ambient and v1.319 bg audio.
4. WARNING - D2 "3 device pixels of near-white" does not hold in Dean's DARK mode (concurs with qa 5). Base probe (my
   run): dark ring rgb(51,51,51) / rgb(52,48,43) / rgb(56,56,56) / rgb(45,45,45). 390x844-2021-dark.png edge pixel
   (45,45,45) next to (0,0,0), and 24/24 -> 0/24 edge-painted after the fix. Keep D2's screenshot asymmetry OPEN. A
   light edge that remains in dark mode after v1.336 means another cause (suspicion only: no other light edge found
   headless).
5. WARNING - the instrument's runtime half is not bound. 16 mutants of 5996fbc2 in a /tmp archive sandbox against
   test/unit/fullscreen-edge-and-video-state.test.js: 9 red (each border:none removal, the base border, the flag gate,
   the ld guard, +f dropped, pm constant, a wrong event list). 7 SURVIVE green (11/11 pass):
   - M4: a later `body #player-wrapper.css-fullscreen { border: 1px solid var(--border-color); }`. The lock proves the
     rule exists, not that it wins (LESSONS 6).
   - M7: the check fires after 'pause' instead of 'playing'.
   - M8: the check delay is 20000 ms.
   - M9: `act: 'video'` as a constant.
   - M10: the wiring inside `if (false)`.
   - M11: amb reads `data-ambient`.
   - M12: the +f sign is flipped.
   The probe prints INSTRUMENT counts but asserts nothing (exit 0 either way) and cannot see M9/M11 (no handoff, no
   ambient headless). Fix: a behavioural test that runs the real listener with the flag on (jsdom/vm), plus the probe
   failing on its counts.
6. SUGGESTION - `dec` is absent on the iPhone, not 0. HTMLVideoElement.idl `[Conditional=MEDIA_STATISTICS]
   webkitDecodedFrameCount`. PlatformEnable.h `#define ENABLE_MEDIA_STATISTICS 0`, with no override in
   PlatformEnableCocoa.h or WebCore FeatureDefines.xcconfig (WebKit main). So the line reads `dec=-` and `+dec=-`.
   The player.js comment and the plan ("reads 0 on the iPhone") are wrong. Beware qa 3's prescription: the probe
   comment's "'-' ... on the iPhone" is the RIGHT half, and its Chromium half is the wrong one.
7. SUGGESTION - B2 "plain property reads only" overstates the passivity. On iOS the first getVideoPlaybackQuality()
   sends SetVideoPlaybackMetricsUpdateInterval and makes the GPU process query the AVPlayerLayer on a background
   WorkQueue. It adds no video output, and it is the path every page calling the API takes. Say so.

Verified, not findings: only the base `.player-container` rule gives the host a non-none border (comment-stripped rule
walk of style.css). No host-state class rule adds border/outline/shadow. No JS writes style.border* to the host.
INLINE is identical on both trees (`1px solid rgb(226, 226, 226)` r=12px, video 17,73 356x200.25 and 255,81 564x317.25).
The check timer dies at close() (player.js:9127) and teardownMediaState (8367) via loadGeneration. Measured load: 6 log
entries per pause/resume cycle (bgAudio:candidate, media:pause, video:pause, media:play, video:playing,
video:check), so the 30-entry cap holds 5 cycles, and leaving fullscreen adds 0. bgTimingTap drops video:* (player.js:4250).
The probe's first-combo bodyBg rgb(255,255,255) is body's `transition: background-color var(--dur-fast)` (0.15s)
toward the #000 belt. It is identical on both trees and pre-existing. qa 2 (the overlay eats bar taps) was not
independently re-measured.
Evidence (adversary): probe, base archive: `INSTRUMENT pause=0 playing=0 check=0 fs-at-pause=0`,
`SUMMARY combos=24 edge-painted=24`. Probe, HEAD archive: `INSTRUMENT pause=2 playing=2 check=1 fs-at-pause=2`,
`SUMMARY combos=24 edge-painted=0`, healthy check `+f=50 +dec=50 +t=2.0`. New test file: 11/11 on Node 22.23.1 and
24.20.0. `npm run test:unit` in the /tmp archive: `tests 7463 pass 7455 fail 8` on BOTH Nodes. All 8 are
sandbox-only: `fatal: not a git repository` (6) and `EISDIR` (2, comment-debt-census TIER 1/2). Their 7 files re-run
in the repo: `# tests 69 # pass 69 # fail 0`. `npx eslint .` = `6 problems (0 errors, 6 warnings)` on base and HEAD.
`lint:css` TOTAL 0. `lint:overlay` clean.

Gate: APPROVED r2 @c712521c - qa

Blocking (CRITICAL/WARNING): none open. Each r1 qa finding against c712521c:
1. CRITICAL panel cut at 60 - FIXED as prescribed. Re-measured with the r1 method (rendered textContent of
   #ft-lifecycle-overlay, real Chromium, faux fullscreen): 390x844 `video:check (rs=4 ns=1 p=0 wh=640x360 t=9.7
   f=246/55 dec=246 pm=- act=video bg=inline_video bgp=1 mu=1 vol=1.00 fs=1 ah=1 amb=0 lock=1 ld=1 +f=150 +dec=150
   +t=6.0 fser=24,49,74,100,125,150)`; it is the newest entry and its Range rect (17-78 in a 0-295 panel; 17-47 of 0-137
   at 844x390) lies wholly inside the panel box. The probe now asserts on the panel text and goes red on base.
2. CRITICAL panel over the bar, a tap cleared the log - FIXED as prescribed. Same real touch tap
   (Input.dispatchTouchEvent at #pp-btn's centre): 390x844 hit=pp-btn, paused false->true, log 9->12; resume tap
   hit=SPAN.pp-icon-play, true->false, log 12->14; 844x390 false->true 29->30, true->false 30->30. Panel top=0,
   pointer-events none in fullscreen; after exit back at the bottom with pointer-events auto (549-844 / 254-390).
   Probe on base: `TAP pp-btn hit=ft-lifecycle-overlay paused true->true log 2->0 FAIL`, `PANEL FAIL`, EXIT=1.
3. WARNING probe `dec` comment - FIXED (Chromium fills dec, lacks pm; the iPhone the reverse), and it matches the probe's
   own output (dec=205, pm=-).
4. WARNING `act` cannot falsify H2 - FIXED: bgp (bgAudioEl.paused), mu, vol read from the elements; the H2 falsifier
   is now act=video + bgp=1 + mu=0, which is not circular.
5. WARNING screenshot overclaim - FIXED: withdrawn, recorded OPEN with Dean's check as the falsifier; his third
   answer (grey-ish in dark, paused and playing) fits the measured rgb 45-56 ring.
6. WARNING skins byte-identity - FIXED: recorded run at 5996fbc2 (`TOTAL: 782 shots, 0 differing pixels ...`); the
   only r2 CSS is scoped to #ft-lifecycle-overlay, which exists only with the flag on (reasoned, not re-shot).
7-9. SUGGESTIONS - 8 and 9 fixed; 7 declined with the adversary's measurement (6 entries/cycle, 5 cycles in 30).
   Accepted; the check stays newest and visible even with the ring full (my 844x390 run above was at 30/30).

What the fix round introduced (reviewed; nothing blocking):
- Chained sample timer: one handle (videoStateCheckTimer) always names the pending timeout (nulled then re-set in
  each tick); a new 'playing' clears it; each tick re-gates flag + loadGeneration, so close()/teardown's
  loadGeneration++ drops it; samples are per-series closure state. The comment's claims match the code.
- `body.ft-css-fullscreen #ft-lifecycle-overlay`: top-level (no @media), the body class is toggled in the same
  setCssFullscreen as the host class, !important is needed over the inline style, and it is behaviourally bound
  by the probe's real tap. lint:css TOTAL 0.
- 400 cap: only for `video:` types; bound by a test that the longest formattable line fits.
- player-lifecycle-release.test.js edit: intent preserved (non-video types still bind the 60 cut through the
  ternary literal); the title states the exception.

SUGGESTIONS (non-blocking):
a. Plan device check says "scroll it for more" while in fullscreen, but the panel is pointer-events:none there, so a
   swipe goes to the picture (reasoned from pointer-events semantics, not measured on touch). Say "leave fullscreen,
   then scroll" (the adversary measured 0 entries added on exit). The CSS comment already says "after leaving fullscreen".
b. player.js header "bgp=0 while act=video = the sound is not the video's" (and the test message) overstates it:
   primeBackgroundAudioElement plays the sidecar MUTED for a moment, which reads bgp=0. Say "the sidecar is playing",
   or log its muted flag too.

Evidence (qa r2, Node 22.23.1): `npm run test:unit` -> `# tests 7469` `# pass 7469` `# fail 0` EXIT=0; `npm run lint` ->
`6 problems (0 errors, 6 warnings)` (all common.js, untouched); `lint:css` -> `TOTAL 0`; `lint:overlay` ->
`overlay-containment: clean (0 violations)`; `bash .harness/lib/check-markers.sh` -> `check-markers: clean
(docs/exec-plans)`; `node scripts/faux-fullscreen-probe.js` on HEAD, EXIT=0: `TAP pp-btn hit=(none) paused
true->false log 3->5 ok`, `INSTRUMENT pause=3 playing=3 check=1 fs-at-pause=3`, `PANEL ok ... fser=25,50,76,101,126,151)`,
`SUMMARY combos=24 edge-painted=0`, INLINE unchanged; same probe with FT_ROOT = archive of 9946a335, EXIT=1. U+2014
in 5996fbc2..c712521c: 0. Security: unchanged from r1 (no new surface; the probe's new tap is CDP input only).

Gate: APPROVED r2 @c712521c - adversary

Blocking (CRITICAL/WARNING): none open. One WARNING (W1) is argued safe to ship, disclosed below.

Each r1 adversary finding against c712521c:
1. CRITICAL, panel cut at 60: FIXED as prescribed. My r2 probe run on a c712521c archive (exit 0) printed
   `PANEL ok video:check (... bgp=1 mu=1 vol=1.00 fs=1 ah=1 amb=0 lock=1 ld=1 +f=151 +dec=151 +t=6.0
   fser=25,51,76,101,126,151) ...`. The same probe on a 9946a335 archive (exit 1) printed `PANEL FAIL`.
   At 393x852 with a 59px top inset, the check is the newest entry and its text lies at y 76-137 inside the
   0-298 panel. At 852x393 it lies at y 17-47 inside 0-138. The worst-case line, with negative deltas and
   series, is 298 chars, under the 400 cap.
2. WARNING, `f` is a cached copy: FIXED differently than I prescribed, and the design holds. Six reads 1s apart,
   logged once. My own prescription re-checked against WebKit main (reasoning, not a device measurement): the
   first tick renegotiates the 1s interval, and RemoteMediaPlayerProxy::setVideoPlaybackMetricsUpdateInterval
   refreshes the cache at once. After that it refreshes on the proxy's cached-state timer, so six seconds span
   at least two refreshes. The plan now says "flat = no frames OR no layer (cannot tell apart)". That is correct.
3. WARNING, bisect: FIXED. `git log --oneline v1.311.2..v1.335.0 -- public/js/player.js | wc -l` = 18, as the
   plan says (14 with --no-merges). My r1 "17" was a miscount. v1.318 ambient and v1.319 bg audio are named.
4. WARNING, D2 screenshot claim: FIXED. Withdrawn and left OPEN with Dean's check as the falsifier. His
   "grey-ish" fits the rgb 45-56 ring I measured.
5. WARNING, surviving mutants: all 7 r1 survivors now die. I re-ran the r1 set adapted to c712521c against both
   edited test files (`# pass 56` pristine): M4, M7, M8, M9, M10, M11 and M12 go red, and so does every r1 red.
   New survivors are W1 and S3 below.
6. and 7. (dec comments, B2 wording): FIXED as prescribed.

W1. WARNING, disclosed and argued safe to ship: the new frame series is not bound, in the tests or in the probe.
   Mutant N1 (`samples.push(n.frames)` -> `samples.push(s.frames)`) survives the unit tests (56/56). The shipped
   probe on that mutant also passes: EXIT 0, `PANEL ok ... +f=150 +dec=150 +t=6.0 fser=0,0,0,0,0,0`.
   So a healthy video would print the "no frames reach the layer" signature, and nothing goes red. These
   also survive both: N2 (frames read from droppedVideoFrames), N3 (`muted: false`), N4 (`vol: null`),
   N10 (every other sample null).
   Why it can ship: at this exact sha the behaviour is MEASURED correct. The healthy series climbs
   (`fser=25,51,76,101,126,151`), and mu=1 vol=1.00 match the probe's muted video. The instrument is flag-gated and
   lives for one capture. Fix at the next touch: the probe asserts that the series climbs every second and
   reads `mu=1` for its muted video.

Fix round, attacked (verified unless marked reasoned):
- Chained timer: each tick nulls the handle, then re-arms it. A new 'playing' clears the pending tick. Each tick
  re-gates the flag and loadGeneration, which close() and teardown bump. No leak (reasoned from the code, bound
  by source locks).
- The panel rule. Measured in faux fullscreen at 393x852 (insets top 59, bottom 34): rect 0,0 393x298,
  padding-top 61px, pointer-events none, and elementFromPoint at the panel centre = media-player. So nothing Dean
  must tap is covered. At 852x393 (insets left/right 59): rect 0,0 852x138. Only #ft-lifecycle-overlay matches
  it, and that element exists only with the flag on. pocket-render-probe never sets the flag.
- player-lifecycle-release.test.js: its intent is kept. The non-video 60-char cut is still bound by the exact
  ternary literal.

SUGGESTIONS (not blocking):
S1. The series keeps sampling through a pause, and the check still logs. In my 852x393 run the newest check came
    right after a video:pause. A check with p=1 has a flat tail by design, so say so in the plan's reading guide.
S2. In landscape the panel pads only the top (padding-left 6px against a 59px left inset). The first characters
    of the top lines sit under the rounded corner or the Dynamic Island. Add env(safe-area-inset-left/right).
S3. Blind spots in the unit locks. The probe covers these three (reasoned from its measurements, not run):
    - M4b: a stronger rule that does not name fullscreen re-adds the border, e.g. `#view-root #player-wrapper
      {border:1px solid ...}`. The CSS scan only reads rules naming a fullscreen state.
    - M10b: the wiring inside `if (false) { ... }` at the same indent.
    - N7: `detailCap = 60;` re-assigned after the ternary.
    Nothing binds N6 (the safe-area padding dropped).
S4. On screen, fullscreen shows 4 entries (portrait and landscape both), so the previous, healthy cycle's check
    is off screen. The panel cannot scroll in fullscreen. Concur with qa (a): "leave fullscreen, then scroll".
    Leaving adds no entries (measured r1).
S5. Concur with qa (b): the muted priming play reads bgp=0.

Evidence (adversary r2):
- Probe on a c712521c archive, EXIT 0: `TAP pp-btn hit=(none) paused true->false log 3->5 ok`,
  `INSTRUMENT pause=3 playing=3 check=1 fs-at-pause=3`, `SUMMARY combos=24 edge-painted=0`. INLINE is unchanged:
  `1px solid rgb(226, 226, 226)` 12px, video 17,73 356x200.25 and 255,81 564x317.25.
- The same probe on a 9946a335 archive, EXIT 1: `TAP pp-btn hit=ft-lifecycle-overlay paused true->true log 2->0
  FAIL`, `PANEL FAIL`, `SUMMARY combos=24 edge-painted=24`.
- `npm run test:unit` in the /tmp archive: `tests 7469 pass 7461 fail 8` on Node 22.23.1 AND 24.20.0. All 8 are
  the same sandbox-only r1 failures (no .git). Their 7 files re-run in the repo at c712521c: `tests 69 pass 69
  fail 0` on both Nodes.
- `npx eslint .` 6 problems (0 errors, 6 warnings). `lint:css` TOTAL 0. `lint:overlay` clean.
