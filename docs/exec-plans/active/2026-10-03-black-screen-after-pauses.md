---
plan: black-screen-after-pauses
harness: v2 · lean
branch: plan/black-screen-after-pauses
anchor: outcome
status: Draft
next: EVIDENCE 1 (section 7) makes H2 the leader (frames stop reaching the video layer after a pause/unpause, sound is the video's own). Owed from Dean: did tap / seek / rotate / reload recover it? was the mini player black? Then W1/W2 design a recovery for H2 on a feat/ branch; this branch carries the plan only
gate: pending
---

# Black picture after pause / unpause / pause: assess it, then fix the mechanism it names

Planned 2026-10-03 by the Architect at main 4c366600 (v1.359.0 shipped). This branch is PLAN ONLY: no product code, no tests,
no probe. It decides how to find the cause. The fix, if any, is built on a separate `feat/` branch after the finding.

## 1. The outcome (what Dean sees)

1. Pause, unpause, pause (any number of times, by the bar's button, by tapping the picture, by double-tapping) never leaves the
   picture black. The inline player and the mini player both keep showing frames while the audio plays.
2. Whatever the cause is, we can SAY what it is, from a measurement, before any fix is written. A fix that fails on Dean's
   device means the diagnosis was wrong: re-root-cause, never re-patch (his standing rule, memory index, "Lessons").
3. If a headless run cannot reproduce it (the likely case: the same bug has been unreproducible since 2026-09-26), the plan ends
   in a precise on-device capture request for Dean, not a theory fix.

### What Dean has reported (verbatim chain, 2026-10-03)

- "after multiple pauses on a given video the screen goes black, it's like an overlay that just doesn't go away"
- "it's on pause/unpause/pause - like something about the double tap maybe. Audio is playing and so is ambient mode, it's like a
  layering thing"
- "it shows up in the MiniPlayer as black when the issue occurs"

Facts, in order of how much they narrow the cause:

- The audio keeps playing and Ambient keeps running (the glow reads `playing`), so the media element is genuinely playing. The
  picture is what is missing.
- The mini player is black too. The dock and the watch stage are different hosts for the SAME persistent `#player-wrapper` and the
  same `<video id="media-player">` (player.js header: the host is only reparented). So the fault travels with the host: either the
  `<video>`'s own layer is not shown, or something INSIDE the wrapper (which rides every reparent) covers it. A cover that lives
  on the stage (the ambient glow, a stage rule, v1.358/v1.359 stage CSS) cannot follow the wrapper into the dock, so it is weakened
  by this fact. A cover that lives in the wrapper survives it.
- The trigger is a short run of play/pause toggles, with the double-tap suspected (his words: "maybe").

## 2. Architect challenge (intake)

**Could this be not worth solving? It may already be a known open bug.** ROADMAP Planned > Bugs (about line 86, still `[ ]`,
"HIGHEST PRIORITY (1 of 2). Bug: the fullscreen video goes BLACK after a pause / resume, pause / resume", Dean 2026-09-26: "after I
pause or resume, pause and resume again, the screen of the video goes black"; audio keeps playing, controls show, STILL black after
leaving fullscreen, on every video; Dark + Ambient + background audio for video all on). v1.336.0 shipped an INSTRUMENT, not a fix
(tracker #284 (a): "D1 is NOT fixed"; DEVICE-CHECKS "Only if it comes back": capture `?debugLifecycle=1`, Ambient off, bar-button only).
Dean never returned that capture. Today's report matches it point for point and adds two new facts (inline, not just fullscreen; the
dock is black too).

Recommendation: treat this as D1 REOPENED WITH A STRONGER REPRO, not a second bug. Consequences for the plan:

- One ROADMAP entry, not two (the 2026-10-03 line near the top of Planned > Bugs folds into the 2026-09-26 one; W0 does the edit).
- The first move is NOT code. It is two cheap observations from Dean (section 7) that eliminate or confirm the top hypothesis
  at zero build cost.
- The v1.336 instrument is already shipped and passive; use it before writing a new one. A new instrument (W1) is only for the
  gaps it cannot see (DOM facts, section 5).

**Could the problem be made not worth solving?** If Ambient is the cause, Dean can turn it off today; that is a workaround, not a
fix, and he ruled in v1.312 against interim guards ("rebuild, no interim iOS guard"). So: never ship an "ambient off while paused"
patch on a theory. If the A/B proves it, the fix is a real change to how the glow coexists with the video layer, gated.

**Prior art that bounds the answer (LESSONS sections 6 and 7, ROADMAP v1.312.0 / v1.311.3):** on Dean's iPhone, a filter, blur, mask,
transform, will-change, contain or isolation on or near the player blanked the video while audio and the glow's colours carried on.
v1.312 rebuilt the glow to never touch the video; the picture "went black again with the bitmap glow" was the stated falsifier and
was never confirmed or refuted on device ("Shipped on Dean's call before the device check"). Treat "ambient vs the iOS video
layer" as the live hypothesis, not a closed one.

## 3. What is known and unknown

Known (read at main 4c366600; line numbers drift, names do not):

- `#player-wrapper` is one persistent host; `expand(slot)` and `dock()` only reparent it. `<video id="media-player">` ships with
  inline `style="display: none;"` in `public/watch.html` (the template); setup flips it visible per item.
- Tap on the picture: the touch gesture layer `wireSkipHoldGestures` (`DOUBLE_TAP_MS = 350`, `HOLD_MS = 500`): a single tap schedules
  `videoSingleTapOrReveal` -> `toggleArtPlayPause` -> `togglePlayPause` + `flashArtGlyph`; a second tap inside the window cancels the
  pending toggle and skips +-15s (`cancelPendingArtTap`); a hold goes 2x, and since v1.358 a drag down locks it.
- `.art-play-glyph` is inside the wrapper, `z-index: 2`, `::before` carries `filter: drop-shadow(...)`, animated by opacity and a
  transform scale for 650 ms. It rides the reparent.
- `#transcode-overlay` (class `resume-overlay`, `--scrim-heavy`, z-index 10) is inside the wrapper but `#player-dock .resume-overlay`
  is `display: none !important`, so an opaque scrim of THIS kind could not black the dock. That already weakens it.
- `#audio-bg-art` (`background-color: #0f171e`, z-index 0, shown only under `.audio-mode`) is inside the wrapper; a stuck
  `.audio-mode` / `.audio-expanded` class on a video item would paint a dark card.
- Ambient (`public/js/ambient.js`): `evaluate()` runs on `play`, `playing`, `pause`, `ended`, `emptied`, `visibilitychange`; it
  calls `start()` or `stop()` (or a bounded hold) every time, toggling `.is-on`, `glow.hidden` and the root attribute
  `data-ambient-on`. The glow is two cross-fading `<div>` gradient layers behind the player in the stage's own stacking context
  (`.watch-player-stage { z-index: 0 }`); it never reads the `<video>`. It is torn down while paused.
- Background-audio sidecar: a foreground pause (the app visible) only ARMS a short-lived candidate (`handlePossibleIOSPrePauseHandoff`,
  `GESTURE_PAUSE_GRACE_MS`; a pause after a recent user gesture is vetoed outright). A real handoff needs a visibility change. So a
  pure foreground pause/unpause/pause does not normally hand off. This weakens the sidecar hypothesis; it does not kill it
  (the swap-back changed in v1.319).
- The v1.336 instrument (`recordLifecycleEvent('video:check', ...)`, `formatVideoStateDetail`) logs `rs ns p wh t f=frames/dropped
  dec pm act bg bgp mu vol fs ah amb lock ld` and a six-second frame series `fser` after each resume. It reads NO DOM facts: it
  cannot say what element is on top, the video's computed display/visibility/opacity, or the wrapper's classes.
- v1.359.0 (merged today) added, on phones only, `overflow-x: clip` on `.watch-player-stage` and a negative-margin stage. Dean's
  report predates his device running it (he is on v1.358 or older), so it cannot be the cause of the 2026-09-26 original, but it
  touches the exact stacking/clipping region around the video layer and MUST be A/B'd once he updates (H6).

Unknown (the plan exists to turn these into measurements):

- Does the picture come back on its own, on a tap, a seek, a rotation, or only a reload? (Not yet reported.)
- At the black moment: is `<video>` still `paused=false` with a climbing frame count (frames reach a layer that is not shown) or a
  flat one (no frames / no layer)?
- Which element is topmost at the centre of the picture? Is `<video>` computed `display`, `visibility`, `opacity` normal?
- Does it happen with Ambient OFF? With only the bar's button (no picture taps)? In Safari tab as well as the home-screen app?
- Does a headless Chromium or Playwright WebKit run reproduce ANY of it? (Nothing has since 2026-09-26; v1.311.3 recorded Playwright
  WebKit painting the picture where the iPhone did not. Absence there is information, not proof.)

## 4. Hypotheses, ranked, each with its cheapest falsifier

Rank = how well it fits ALL the facts (audio on, Ambient on, dock black too, pause/unpause/pause, double-tap suspicion), then cost
to test. A hypothesis is dead only when its falsifier is OBSERVED, never by argument.

| # | Hypothesis | Fits | Falsified by (cheapest first) |
|---|---|---|---|
| H1 | The iOS `<video>` compositing layer is dropped/hidden by the ambient glow's repeated start/stop around each play/pause (the v1.312 signature: audio and glow continue, only the picture's layer drops). Wrapper-level because the dock shows it too: the layer, not the stage, is lost. | audio on, ambient on, "layering", every pause/play re-runs `evaluate()` | **Black with Ambient OFF in the cog** (Dean, 10 attempts, section 7 step A). Or `fser` climbing while `p=0` and black (frames reach a layer that is not shown) AND no cover in the DOM facts (H3). |
| H2 | The `<video>` layer is dropped by a rapid pause -> play -> pause on iOS independent of Ambient (AVPlayerLayer not re-shown; WebKit relays the frame counter as a cached copy, so a pause/play burst can strand it). | dock black, audio on | It happens never with Ambient off in 20 tries AND the same burst through the bar button is clean (then the trigger is not the burst). Cannot be settled headlessly (no iOS media stack). |
| H3 | An opaque or dark element INSIDE `#player-wrapper` covers the video and rides the reparent: a leaked `.audio-mode` / `.audio-expanded` (the `#0f171e` art card), a stuck scrim, `#media-player` left `display:none` / `visibility:hidden` / `opacity:0` by a setup/teardown path that a quick pause/play re-enters, or the glyph animation stranded. | "overlay that doesn't go away", dock black | The DOM facts at the black moment (W1 instrument or a Web Inspector dump): `elementFromPoint` at the picture centre IS the `<video>`, `<video>` computed display/visibility/opacity normal, wrapper classes sane. (Cheap and decisive: this one is readable, not inferred.) |
| H4 | The double-tap / hold-lock gesture layer desyncs: a single-tap timer (`pendingArtTap`) fires after the second tap's skip, or `lock` state / the speed pill / `touchend preventDefault` leaves the toggle in a state where the UI says "paused" while the element plays (or the reverse), and a path flips the video's presentation. | Dean's own "double tap maybe", pause/unpause/pause | Black through the BAR's play button only (no picture taps); or `lock=0` and `act=video` with sane `p` in `video:check` while black. |
| H5 | The background-audio sidecar takes the sound while the video element is paused/hidden: `act=bgAudio`, `bgp=0`, `bg=background_audio|handing_off` at the black moment (the sound is not the video's, so "audio playing" is the sidecar and the picture is the paused/detached video). | audio on, ambient on (it reads `playing`) | `act=video`, `bgp=1`, `mu=0` at the black resume (the v1.336 H2 falsifier, unchanged; remember `bgp=0` also reads during the muted gesture-prime play, tracker #284 (e)). Weakened already: a visible-app pause only arms a candidate. |
| H6 | v1.359.0's mobile stage (`overflow-x: clip`, negative margin) or any stage-level clip near the video layer. | only if Dean is on v1.359+ | Black on v1.358 (Dean's build for the original report) falsifies it as the original cause; a v1.358 vs v1.359 A/B on device decides whether it ADDS a failure. |

Reading the table: H1/H2/H5 are layer or sound-source faults the existing instrument can already separate (`fser`, `act`, `bgp`,
`amb`); H3/H4 need DOM facts it cannot give. That is why the plan has an instrument wave (W1) instead of guessing.

## 5. The reproduction harness (headless, W0)

Goal: either REPRODUCE (mechanism named, fix designed against a real failing run) or produce a defensible "does not reproduce in
Chromium or Playwright WebKit", which routes to the on-device capture. Never a theory fix (LESSONS section 1).

Reuse, do not rebuild (all in the repo at main 4c366600):

- `tools/hold-lock-proof/serve.js`: boots the REAL server against a throwaway DATA_DIR with a playable WebM and a WAV, mints an
  admin session. `tools/edge-to-edge-proof/probe.js`: the Playwright launcher, a real portrait WebM generator, per-era loops.
  `scripts/faux-fullscreen-probe.js`: the faux-fullscreen case. `tools/capture`: Playwright dependency.
- Engines: Playwright Chromium (iPhone 13 emulation, DPR 1, touch on) AND Playwright WebKit (`webkit-2248` is installed under
  `~/.cache/ms-playwright`; the closest engine to Safari available; run both and report both).

New, in W0 only: `tools/black-screen-proof/probe.js` (a proof tool like the two above, not a CI gate). The clip is a colour-cycling
WebM so a black picture is detectable as a pixel fact, not an opinion.

State set up before each run: dark mode, `ft-ambient=1` (localStorage), the glow `<div>` un-hidden is NOT forced (let the real
engine drive it), background audio for video both ON and OFF, custom controls ON and native, `/watch.html?v=<id>` inline, then
the dock (navigate to another route with the video playing so the host reparents into `#player-dock`).

Sequences (each run records every sample below after EVERY toggle, at 0, 150, 500 and 1500 ms):

- S1 bar: `#pp-btn` pause, play, pause (and x4, x6), intervals 0 / 100 / 250 / 400 / 700 ms.
- S2 picture taps: real `touchscreen.tap` single taps on the picture centre, the same intervals; include the 350 ms double-tap
  window boundary (300, 340, 360, 400 ms).
- S3 double-tap then pause: tap-tap (skip), then a third tap (pause), then a fourth (play).
- S4 hold-lock: hold 600 ms, drag down to lock, tap the pill, then pause/play.
- S5 dock: any of S1-S3 once the host is in `#player-dock`; plus pause in the stage, dock, un-dock, play.
- Each with Ambient ON and OFF, background audio ON and OFF.

Samples (all passive; none touches the video's frames):

- pixel: screenshot clip of the picture centre; mean luminance and a hue check against the cycling clip (black = fail).
- the v1.336 line: `paused`, `readyState`, `currentTime` advancing, `getVideoPlaybackQuality().totalVideoFrames` series.
- DOM: `document.elementFromPoint` at the picture centre (tag, id, class path up to the host); `getComputedStyle(video)` display,
  visibility, opacity; `#player-wrapper` class list (`audio-mode`, `audio-expanded`, `css-fullscreen`, `controls-autohidden`);
  `.art-play-glyph` class and computed opacity; `#transcode-overlay` display; the glow's `is-on`, `hidden`,
  `data-ambient-on`; `bgAudioState` via `?debugLifecycle=1`'s log.

Reachability controls (LESSONS: a probe that cannot fail proves nothing): before reading any result, run the SAME probe with an
injected fault and watch it go red by name: (a) `video.style.visibility='hidden'`, (b) an injected opaque `div` in the wrapper,
(c) `.audio-mode` forced on. If any control does not turn the pixel check black and the DOM fact red, the probe is vacuous and its
"no repro" is worthless. Also run it once on main at v1.358 and once at v1.359 (an A/B of H6).

Disclosed limit, stated up front: neither engine is iOS WebKit's GPU-process media path (`MediaPlayerPrivateRemote`), the layer that
H1/H2 are about. A clean headless run does NOT clear H1/H2. It can clear H3 and H4 outright (they are DOM and gesture logic, which
headless does exercise) and it can confirm the instrument's blind spots.

## 6. Waves

Branching: this branch (`plan/black-screen-after-pauses`) holds the plan. W0 onward is built on `feat/v1.360-black-screen-diagnose`
(or the next free number) cut from main; the plan moves to `completed/` with the release that closes it.

### W0 - Diagnose headless (ships NO fix, NO product code)

- Build `tools/black-screen-proof/probe.js` per section 5; run the controls first; run the matrix on Chromium and WebKit, v1.358 and
  v1.359; commit the probe and its JSON results.
- Fold the two ROADMAP entries into one (the 2026-09-26 "HIGHEST PRIORITY (1 of 2)" entry gets the 2026-10-03 facts: pause/unpause/pause,
  dock black, audio and Ambient on; the duplicate near the top of Planned > Bugs goes).
- Decision at the end of W0, written into section 8:
  - REPRODUCED: name the mechanism, which hypothesis it kills and which it confirms, go to W2 with a failing run to fix against.
  - NOT REPRODUCED, H3 and H4 cleared: go to W1 (the DOM facts are then the only thing left to read on a phone).
  - NOT REPRODUCED, a DOM fact is wrong (a leaked class, a stuck display): that is the mechanism after all; W2.
- Exit rule: W0 changes no file under `public/` or `server/`. A diff there is a plan violation, not progress.

### W1 - Instrument v2 (only if W0 does not name the mechanism)

A passive, text-only addition to the `?debugLifecycle=1` log, read from the DOM at the same moments the `video:check` series runs
(and once on each pause/play): a `dom:check` line with the topmost element id/class at the picture centre, `<video>` computed
display/visibility/opacity, the wrapper class list, the glyph's computed opacity, the glow's `is-on`/`hidden`, the host's current
slot (`stage` or `dock`). No `requestVideoFrameCallback`, no canvas read of the video, no filter or layer on the video
(the v1.336 rule, and the whole v1.312 lesson). Also closes the tracker #284 gaps the next touch of the instrument owes: the probe
asserts a climbing `fser` and `mu=1`; add left/right safe-area padding to the panel; log the sidecar's muted flag so `bgp=0` is
readable. Gate: adversary + qa (player core, shared host, LESSONS sections 4, 5, 8). Ships as a patch with the capture request in
DEVICE-CHECKS. This wave exists to hand Dean ONE capture that answers H1 through H5, not to fix anything.

### W2 - The fix (STUB: written only after a finding)

The shape depends on what W0/W1 names. Each fix wave is its own commit and states, BEFORE it is written, the observation that
falsifies it. A fix is accepted into the plan only when the same repro that failed goes green on the real upstream shape (LESSONS:
prove REACHABILITY), and the control from section 5 turns it red again when the fix is reverted.

| If the finding is | The fix is | Binding |
|---|---|---|
| H3 a leaked class / stuck display / stranded overlay | Reset that state at the path that leaks it (the setup/teardown a quick pause/play re-enters); do not add a "force visible" patch over it | probe sequence S1-S5 green; a unit test seeded from the real DOM shape; a mutant that removes the reset goes red |
| H4 the gesture layer desyncs | Fix the timer / state ordering in `wireSkipHoldGestures` (`pendingArtTap`, `lastTapTime`, the lock state) | tap-interval sweep around 350 ms, green on the failing interval; `hold-lock` tests still green |
| H1 ambient vs the video layer | A real change to how the glow starts/stops around the video (for example no layer churn on `play`/`pause`, or no stage-level change at all while the picture is on screen), designed against the measured failing frame series | device only for the final verdict; headless can bind the DOM/class transitions, not the iOS layer |
| H2 pause burst drops the layer (Ambient off still fails) | A documented iOS workaround at the element (a measured nudge, only with a primary-source cite), as a last resort | device only |
| H5 the sidecar holds the sound | Fix the swap-back state ordering; never "force swap back on every pause" | `bgAudioState` transitions in the unit machine, plus a log line on device |
| H6 the v1.359 stage clip adds a failure | Revert/rework that one declaration (its own patch), with the BLD geometry check still green | `node test/geometry/run.js` BLD and the stage lock |

### W3 - Docs

Release commit as usual: `docs/releases.json` in plain language, LESSONS section 6/7/5 entry for whatever class this turns out to be,
ROADMAP Shipped and the bug marked, DEVICE-CHECKS (section 8 below), tracker #284 closed or re-pointed, `node scripts/plan-complete.js`.

## 7. What Dean can do now (zero build cost, in this order)

**Step A (2 minutes, the cheapest observation we have): the Ambient A/B.** In the cog, turn Ambient OFF. Pause/unpause/pause the same
video 10 times (picture taps, then 10 more using only the bar's play button). Does it ever go black?
- Never black with Ambient off, but black with it on: H1 is confirmed to first order; the fix is about the glow.
- Black with Ambient off too: H1 is dead; H2/H3/H4/H5 stay, and the next step matters.
- **RESULT (Dean, 2026-10-03): Ambient OFF, pause/unpause/pause, still goes black. H1 is falsified** (the glow is not the cause; its start/stop is not what drops the layer). Remaining: H2 (video layer dropped by a rapid pause burst), H3 (an opaque element inside the wrapper, which rides the dock), H4 (gesture layer), H5 (background-audio sidecar), H6 (the v1.359 stage clip, only if the bug predates it: Dean's first report was on the pre-v1.359 build, so H6 is unlikely). Next: Step B on device, and the headless W0 for H3/H4.

**EVIDENCE 1 (Dean's ?debugLifecycle=1 capture, 2026-10-03, Ambient off, amb=0 lock=0, inline, 1920x960, pm=inline):** the video is playing (p=0, rs=4 HAVE_ENOUGH_DATA, ns=2) and its clock runs (`t` 1.9 -> 8.0 -> 12.2 -> 25.2) but the frame counter is FROZEN at `f=64/0` from 6 frames after the unpause to the last line, 23 s later; the `video:check` line reads `+f=0 +t=6.4 fser=0,0,0,0,0,0` (flat while `t` runs). The sequence: autostart, `video:pause` at f=58, `video:playing` 1 s later, ~6 more frames, then `video:stalled` repeatedly with no frame progress. Per the code's own reading rule (player.js, formatVideoStateDetail): flat `fser` while `t` runs = no frames reach the AVPlayerLayer, or there is no layer. `bgp=1` (the sidecar is paused) and `act=video`, `mu=0 vol=1.00`: the sound is the VIDEO's own, so H5 (sidecar holds the sound) is out. `pm=inline`: iOS did not move it to a native presentation. What this does and does not settle: it falsifies H1 (amb=0) and points away from H3/H4 (a DOM overlay or gesture layer would leave the frame counter climbing; this one is not climbing), and makes H2 the leader: the video layer stops receiving frames after a pause/unpause. **Dean confirmed (2026-10-03): the capture was taken IN the failed state, the picture black after the pause**, so the frozen frame counter is the failure itself, not a coincidence. Not settled: whether tap/seek/rotate/reload recovered it, and whether the dock was black (still owed from Dean); `dom:check` (W1) would still be the instrument that proves no overlay.

**Step B (the on-device capture, if Step A does not close it, or for any recurrence):**
1. Note: iPhone model and iOS version, Safari tab or home-screen app, Dark mode on or off, Ambient on or off, Background audio for
   video on or off, custom or native controls, which build (the version in the account menu).
2. Open `<app>/?debugLifecycle=1` once (the flag then sticks until `=0`).
3. Play a video INLINE (not fullscreen). Pause/unpause/pause until the picture goes black. Wait 8 seconds.
4. Screenshot the debug panel with the newest lines (it must include the latest `video:check` line and its `fser=`), and say what you
   see: black picture, controls visible? glyph visible?
5. Tap the picture once: does it come back? Seek the bar: does it come back? Rotate the phone: does it come back? Does it come back
   only on a reload?
6. Dock it (go to another page so the mini player shows): screenshot the mini player (black?) and the log again.
7. If W1 has shipped: also screenshot the new `dom:check` line (it names the element on top and the video's computed styles).
8. Say which gesture got it there: bar button only, picture taps only, or a double-tap in the run.

Do not leave fullscreen before screenshotting if you were in fullscreen (the panel ignores touches there, v1.336).

## 8. Device checks owed (tagged to the release that closes the plan)

- [ ] After the fix: 20 pause/unpause/pause cycles inline on a video, by picture taps, by the bar's button, with a double-tap in
  the middle of some, Ambient on and off, in a Safari tab and in the home-screen app: the picture never goes black.
- [ ] The same in the mini player (dock the player after a few cycles, then pause/play there).
- [ ] The same with Background audio for video on, then lock the screen mid-run and return: the picture is back.
- [ ] iOS was not measurable headless (section 5): every claim about the iOS video layer is a DEVICE claim until Dean confirms it.

## 9. Stop rules

0. No code on this branch. The fix lands on a `feat/` branch, and only after a finding.
1. **Never theory-fix.** The bug has been unreproducible for a week; the pull to guess is the hazard. A change whose falsifier has not
   been observed is a violation, whatever it looks like in the diff (LESSONS section 1).
2. **A fix that fails on device = the diagnosis was wrong.** Return to section 4 and re-rank; never re-patch the same spot
   (memory: "A shipped fix that fails on device = the diagnosis was WRONG").
3. A headless run that does not reproduce is a RESULT. It routes to W1 and Dean's capture. It does not license a theory fix, and it
   does not clear H1/H2.
4. No new instrument may touch the video frames (no `requestVideoFrameCallback`, no canvas read, no filter/mask/transform/
   will-change/contain/isolation on or near the player). The v1.312 lesson is the reason the glow was rebuilt.
5. Do not delete the v1.336 `video:check` instrument or change its format without keeping every field Dean's old screenshots use.
6. Gate for any build wave: adversary + qa (shared player core, the reparented host, ambient). Destructive/data-losing: not applicable
   (no storage change). Two rounds, then ask Dean before a third.
7. Never self-merge: ask Dean (AskUserQuestion) before `gh pr merge --merge`. Stage files by name; no `--no-verify`; no force-push.
8. Ask Dean on any look or behavior choice the plan did not settle (for example whether the glow may lose its start/stop behaviour
   on pause, which is a visible change to Ambient).

## 10. Out of scope

The iPhone SE "only the frame" bug, the music pop-out bug, the v1.350 Transparent turn, the chapter-tap offset (#290), desktop theatre,
anything in the Pocket/iPod skins. They are separate ROADMAP entries.

## 11. Gate record

Plan-only branch: no code to gate. When W0 begins on its `feat/` branch the adversary and qa seats write
`Gate: <verdict> r<n> @<sha> - <seat>` here. Until then `gate: pending`.
