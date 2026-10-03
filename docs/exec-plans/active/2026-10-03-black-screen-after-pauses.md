---
plan: black-screen-after-pauses
harness: v2 · lean
branch: feat/v1.360-black-picture (plan carried from plan/black-screen-after-pauses)
anchor: outcome
status: Building (v1.360.0)
next: section 12 - build done, then the gate (adversary + qa + security-brief, same HEAD), then the release
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

**EVIDENCE 1 (Dean's ?debugLifecycle=1 capture, 2026-10-03, Ambient off, amb=0 lock=0, inline, 1920x960, pm=inline).** Dean's account: he was in a GOOD state, triggered the bad state, and the log should hold both. It does, from the video's load (27 s before the paste; the oldest line is cut off at the panel's edge) to the failure, with ONE pause/unpause cycle, not several. Timeline, oldest first: `loadstart`, `autostart:ok`, `video:playing` at t=0.0 f=1 (GOOD: frames climb, f=58 by t=1.9, about 30 per second); `video:pause` (t=1.9, f=58, gestureAge=3ms: a tap); `video:playing` again 1 s later at f=64; then BAD: `video:stalled` at t=8.0, 12.2 and 25.2 with p=0, rs=4, and f frozen at 64/0 while `t` runs 8.0 -> 25.2; the `video:check` line reads `+f=0 +t=6.4 fser=0,0,0,0,0,0`. Per the code's own reading rule (player.js formatVideoStateDetail): flat `fser` while `t` runs = no frames reach the AVPlayerLayer, or there is no layer. `bgp=1` (sidecar paused), `act=video`, `mu=0 vol=1.00`: the sound is the VIDEO's own, so H5 is out. `pm=inline`: not moved to a native presentation. This falsifies H1 (amb=0), points away from H3/H4 (an overlay or gesture layer would leave the counter climbing), and makes H2 the leader: after the first pause/unpause the video layer stops receiving frames. LIMITS, stated plainly: (1) `f` is a cached copy that refreshes about every 2 s, so the f=64 at the resume is NOT proof that 6 frames really arrived; the real stop is somewhere between the pause (f=58) and the first flat `fser`; (2) no event marks the moment the picture went black (it simply stops), so the boundary is inferred from the counter, and the `fser` series only starts at a `playing` event; (3) this failed after one cycle, not the several Dean first described; (4) the log cannot say whether the picture was black on screen (that is Dean's eye, he has said it was), whether tap/seek/rotate/reload recovers it, or whether the dock was black. `dom:check` (W1) would still be the instrument that proves no element sits on top.

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

The v1.360 seats write `Gate: <verdict> r<n> @<sha> - <seat>` here (section 12 is what they review).

Gate: CHANGES r1 @b6b8bb34 - qa

- WARNING W1 (tests do not bind the per-load semantics): three one-line mutants of player.js stay 20/20 green in
  `test/unit/black-picture-watchdog.test.js`: drop `frozenHeals = 0` in `syncFrozenGen` (after two heals on one video the watchdog
  never runs again for the page's life), drop `frozenClimbed = false` there (a one-frame still loaded after a climbing video gets
  healed twice, breaking 12.3 item 3), and `if(0)` the `gave up` `recordLifecycleEvent` (12.3 item 4 unbound). The test titled
  "a new load stops it and starts its counters fresh" only asserts the stop. Fix: a second-load test (heal twice on v1, load v2,
  freeze: heals again; and a v2 one-frame still: no heal) and assert the `video:heal gave up` line.
- WARNING W2 (12.3 item 3 "a healthy count never triggers it" is not true for variable-frame-rate video): a screen recording (VFR)
  that has moved, then holds a static screen for 6 s+, decodes no new frames while the clock runs, so the watchdog seeks it in
  place up to twice (each seek also fires `seeking`/`seeked`: closes an open chapters menu, re-runs presync, remote.js posts state).
  Bounded and cheap, safe to ship IF disclosed in the ROADMAP v1.360.0 Disclosed line and 12.3.
- WARNING W3 (the prime moves, it is not removed, for Dean's exact sequence): after the guard, autostart -> pause tap (no prime) ->
  unpause tap primes, so the sidecar's muted play() now runs in the SAME gesture as the video's own play(). 12.1 names the unknown
  as "whether WebKit drops the video's layer when a second media element starts in the same gesture"; that applies to the play tap
  too. Safe to ship disclosed (the play-tap prime is the years-old path for non-autostarted videos, and the watchdog backstops), but
  12.2/ROADMAP must say it, and the falsifier "black with Background audio OFF = H8 dead" needs its twin: black with it ON after
  v1.360 does not clear H8.
- WARNING W4 (heal-ok can claim a heal that did not happen): `video:heal-ok` logs on ANY count increase after the heal
  (`n.frames > frozenSince.frames`), so one frame presented by the seek itself, then frozen again, reads as success, which is the
  H2b falsifier's exact case ("video:heal and NO video:heal-ok"). Fix: gate heal-ok on `framesClimbed(...)` from the post-heal
  reading, or put the frame delta in the line and in the falsifier text.
- WARNING W5: ROADMAP v1.360.0 Shipped entry carries a literal unfilled `SUITES_LINE` placeholder.
- SUGGESTION S1: 12.4 "Deviation (none of the acceptance changed)" contradicts itself: 12.3 item 2 still lists "the active element
  (not the sidecar) and not in audio mode"; amend 12.3. (The removal itself checks out: `audio-mode` is only added in the audio
  branch, and a handoff runs only hidden with the video paused.)
- SUGGESTION S2: docs say "phone-only"; the gate is `isMobileFormFactor()`, which includes iPads (coarse, no hover). Say "mobile".
- SUGGESTION S3: the prime comment ("Dean's capture logged that sidecar play/pause") and ROADMAP ("his log shows its sidecar
  play/pause") go beyond 12.1, which cites only `media:pause el=bgAudio`; a prime would also log `media:play el=bgAudio` and
  `bgAudio:prime ok`. Confirm those against the capture or say "pause".
- SUGGESTION S4: after two SUCCESSFUL heals the watch stops (and `startFrozenPictureWatch` returns early on later `playing`), so a
  third freeze is silent with no `gave up` line; the docs say "then it stops (gave up line)".
- SUGGESTION S5: `endFrozenPictureSession`'s comment names 'pause' / 'ended' but it is also the 'emptied' listener; one line of the
  watchdog block comment overruns the block's wrap width.
- SUGGESTION S6: the LESSONS 5 bullet records H8 as an established cause ("for months it ran ...", x1) before any device result;
  phrase it as the suspected trigger until Dean's checks pass.
- Security: client-only, no network, no storage change; log details are numbers built with `toFixed`; no surface.

Gate: CHANGES r1 @b6b8bb34 - adversary

Measured: `npm test` in a fresh clone at b6b8bb34, Node 22.23.1 and 24.20.0 each: 10855 tests, 10843 pass, 0 fail, 12 skipped.
Mutants of the guards 12.4 names, re-run in a `git archive` sandbox: 14 of 15 red; the 15th (`minFrames`, A4) survives.

- WARNING A1 (measured; sharper than qa W3): the bar's play button still runs the sidecar play/pause UNDER A PLAYING VIDEO. In the
  jsdom harness (video paused, Background audio ON, one `#pp-btn` click) the call order is `bg-audio-sidecar.play()`,
  `media-player.play()`, then `bg-audio-sidecar.pause()` with the video's `paused === false`: the prime runs first (the video is
  still paused, so the guard lets it through), `togglePlayPause()` starts the video in the same task, and the prime's `.then`
  pauses the sidecar after that. So `media:pause el=bgAudio` under a playing video, the signature 12.1 reads as H8, still fires on
  the first bar play of every load. The ROADMAP wording "no longer plays a second media element under the video" is true only for
  the picture's pause tap. Fix (cheap, keeps 12.3.1): in the `ppBtn` handler, when the video is playing, call `togglePlayPause()`
  FIRST and prime after it (the sidecar cycle then runs under a paused video, still inside the click gesture, and the bar's pause
  primes the autostarted case, which shrinks the disclosed lock cost); when the video is paused, do not prime from the bar, or
  disclose it. Suspicion only (not reproduced): the picture-tap path primes at `touchstart` and plays the video 350 ms later from
  a timer, so the sidecar's pause lands before the video plays only if its `play()` resolves within 350 ms; a v1.35 pre-armed real
  `/audio/:id` sidecar that still has to buffer can take longer.
- WARNING A2 (concur qa W2, now measured): a healthy variable-frame-rate video IS healed. A VP9 webm (3 s moving at 30 fps, an 8 s
  still held as one frame, 3 s moving) in Playwright Chromium reads `t=3.9 f=94` ... `t=10.9 f=94` (flat 7 s while the clock
  runs); those exact readings fed to the exported `framesClimbed` / `frozenPictureDecision` give `heal` at t=9.9. 12.3.3 is false as
  written; disclose or tighten.
- WARNING A3 (concur qa W4, measured): heal, one tick still, then one frame (+1), then frozen again logs `video:heal ... n=1`,
  `video:heal-ok f=61 ... n=1`, `video:heal ... n=2`, `video:heal gave up`: one frame reads as success. Whether heal-ok appears
  depends on which tick the +1 lands on (on the very next tick it is NOT logged, because `frozenSince` is null there), so the
  falsifier "heal with no heal-ok" is timing-dependent.
- WARNING A4 (test binding, extends qa W1): unclaimed one-line mutants of player.js, each 20/20 green: drop `frozenHeals = 0` and
  drop `frozenClimbed = false` in `syncFrozenGen` (qa W1; at the committed code a second load does heal again, measured, the test
  just does not say so); drop the in-tick climb read in `tickFrozenPictureWatch` (a freeze in the FIRST play session, before any
  pause, then never heals: unbound); drop `r.right > 0`, `r.left < vw` or `r.top < vh` from the on-screen test (only the bottom
  edge is bound); and the builder's own `df >= minFrames &&` mutant SURVIVES: the "9 frames is under the floor" assertion
  (`R(1,0) -> R(10,1.9)`) is rejected by the 5 fps clause alone (4.7 fps), so the 10-frame floor is unbound and that assertion is
  vacuous. 12.4's "every mutant red" is true of the list it tried, not of the guards it names.
- WARNING A5 (concur qa W5): `SUITES_LINE` is a literal placeholder in the ROADMAP v1.360.0 entry.
- SUGGESTION A6: `!mediaPlayer.ended` (prime) and `!v.ended` (readPictureProgress) are dead clauses: per the media spec reaching
  the end without `loop` sets `paused` first, and with `loop` `ended` never reads true. Both mutants survive. Drop or comment.
- SUGGESTION A7 (suspicion): `readPictureProgress` does not look at `webkitPresentationMode`; in iOS native fullscreen or PiP the
  inline element keeps its page rect, so "on screen" is the inline box, and whether WebKit's counter keeps climbing there is a
  device fact. Dean's capture was `pm=inline`; refusing `pm !== 'inline'` loses nothing the bug showed.
- SUGGESTION A8 (should-work, not measured on device): `liveMode` is chosen by `!isMobileViewport()` (width > 768) while the
  watchdog gates on `isMobileFormFactor()` (pointer), so an iPad or a landscape Pro Max opening a needs-transcode video runs the
  watchdog on a live-transcode stream; a native seek there should be a no-op when `seekable` is empty, but excluding `liveMode`
  is one clause.
- Harmless survivors (no behaviour change found): the `startFrozenPictureWatch` cap guard, the heal-ok cap stop, the gave-up
  `frozenHealPending = false`, the `frozenSince = null` after a heal, the `frozenTimer`/generation clauses in
  `endFrozenPictureSession`.
- Claims checked true: the panel is newest first (`renderLifecycleOverlay`, player.js 4766 `log.slice().reverse()`); the only
  sidecar `play()` sites are the prime (3858), the handoff (3581) and `playActiveMedia` (3151, lock-screen); DEVICE-CHECKS has 4
  v1.360 lines as the ROADMAP says; the v1.336 line moved into them. Concur qa S1-S6.
- Security: client-only; the log sink is `textContent` (player.js 4780) and every new detail is numbers via `toFixed`; no
  injection surface.

Gate: CHANGES r2 @68abb354 - qa

Measured at 68abb354 (Node 22.23.1): eslint on player.js and the two touched tests, exit 0, no output; `node --test` on
black-picture-watchdog, player-background-audio and hold-lock: tests 171, pass 171, fail 0. My r1 mutants re-run in a `git archive`
sandbox (watchdog + background-audio tests): `frozenHeals = 0` dropped, `frozenClimbed = false` dropped and the gave-up line
disabled each go red (fail 1). Also red: the heal-ok strictness (`n.frames >` instead of `climbedFrom`), the session-climb branch,
`pm === 'inline'`, `frozenSince = n` after a heal, the three `frozenGaveUp` lines, the prime guard (fail 3).

r1 findings: W1 fixed as prescribed (the second- and third-load test, the gave-up line asserted). W2 fixed differently and better
(only a session whose count has not climbed is judged; the residual, a VFR video resumed on a still, is disclosed in 12.3 and the
ROADMAP). W3 disclosed as prescribed (12.3 falsifiers, both ROADMAP entries), and the bar's play press no longer primes at all.
W4 fixed as prescribed (heal-ok needs `climbedFrom` on the heal reading, every tick). W5 fixed. S1-S6 fixed as written. The ppBtn
order is right: `play()` sets `paused` false synchronously, so the prime's guard refuses a play press; a pause press primes under
the paused video. Comments in the rewritten block, the prime and ppBtn are true against the code. No em dashes in added lines.

- WARNING W6 (two new guards unbound; the r1 class again): two one-line mutants stay green (30/30 watchdog, 149/149 with the
  background-audio file). (a) Drop `frozenHealFrom = null` after heal-ok: a probe test (heal, then 10 healthy seconds) logs
  `video:heal-ok` 10 times, not once, and the watch keeps ticking. (b) Replace `if (!frozenHealFrom) stopFrozenPictureWatch();`
  with nothing: the VFR test passes because its 10 s still keeps the session average above 5 fps (90 frames / 13 s); with a 40 s
  still after 3 s of motion the mutant heals (my probe: red under the mutant, green on the real code). The production code is
  right in both; the tests do not hold it. Fix: assert exactly one heal-ok line in the heal-ok test, and lengthen the VFR still
  (40 s). It blocks only because of the next item.
- WARNING W7 (lying docs, again): 12.5 says "Mutants after the fix ... all red" and the ROADMAP v1.360.0 entry says "every mutant
  red after the gate r1 fix round", which W6 makes false; the ROADMAP also says "all fixed in r2" before r2 has a verdict.
  Fix: bind W6 (then the claims hold), and write the gate line after the verdicts.
- SUGGESTION S7: 12.3 item 1 says the prime "never plays or pauses the sidecar while the video is playing", but the falsifier
  paragraph below it (rightly) says the picture's play tap can overlap if the sidecar's `play()` resolves later than the 350 ms
  tap debounce. Add "except" to item 1 so the acceptance does not contradict its own disclosure.
- SUGGESTION S8: the bar's PAUSE press now primes (new): the muted sidecar play is the last media play on the page after a pause
  (LESSONS 5 "TWO parallel media elements": any play on a second element affects iOS now-playing). The same thing happened before
  v1.360 on the picture's first touch of a paused video, so it is not a new class, but the DEVICE-CHECKS lock check is worth doing
  after a BAR pause as well as after a picture pause.
- SUGGESTION S9: the ROADMAP Shipped "Tests:" bullet has one line far past the wrap width ("... kept untested). Suites at
  bfc7843a: Node 22.23.1 and").
- Security: unchanged from r1; client-only, numeric log details; no surface.

Gate: CHANGES r2 @68abb354 - adversary

Measured: `npm test` in a fresh clone at 68abb354, Node 22.23.1 and 24.20.0 each: 10865 tests, 10853 pass, 0 fail, 12 skipped.
My r1 survivors re-run in a clone at 68abb354 (watchdog + background-audio tests): `frozenHeals = 0` and `frozenClimbed = false`
dropped, `r.right > 0`, `r.left < vw`, `r.top < vh` dropped, and `df >= minFrames` dropped: all six red. New-branch mutants red:
`pm === 'inline'`, the three `frozenGaveUp` lines, the session-climb branch, `frozenSince = n` after a heal, the climb read at the
pause, the heal-ok and gave-up log lines, the prime guard, and the ppBtn order (prime-then-toggle) and ppBtn no-prime (fail 2 each).
Survivors: drop `frozenHealFrom = null` after heal-ok, and drop the session stop (both = qa W6, concur); drop `n.ok` from the heal-ok
test and drop `frozenHealFrom = null` on gave-up (no behaviour change found).

r1 findings: A1 fixed as prescribed (toggle then prime; my r1 probe now records every sidecar play/pause with the video paused,
and a play press does not prime). A2 fixed differently: the r1 webm readings run through the real runtime now give 0 seeks in one
session; the residual (resumed on a still: my readings give 1 seek) is disclosed. A3 fixed (one frame after a heal: no heal-ok,
second heal, gave-up). A4 fixed (all six survivors red). A5 fixed. A6 fixed. A7 fixed and bound. A8 not changed, argued; accepted.

- WARNING A9 (NEW in the fix, measured): the session-climb stop gives up on a freeze too early. It ends judging for the session
  once the count climbs 10 frames at 5 fps from the `playing` reading, and that can happen on the first ~2 s cached refresh. Repro
  (jsdom, the committed harness): first play climbs, pause, `playing`, then one tick +0, one tick +12 frames, then 20 s flat with
  the clock running: r2 = 0 seeks and the watch stopped; the same input on b6b8bb34 = 2 heals. So if the layer takes about 0.4 s of
  frames after the resume and then freezes, it is never healed, and it is not disclosed. (Dean's capture showed 6 frames after the
  resume, so his run would still heal, by 4 frames.) Fix, verified in the clone: the session is healthy only after a SUSTAINED climb,
  `if (frozenSession && n.t - frozenSession.t >= FROZEN_MIN_ADVANCE_S && climbedFrom(frozenSession, n))`. With it, all 30 tests
  pass; the 12-frame repro heals (2); the r1 webm in one session still gets 0 seeks; the resumed-on-a-still residual is unchanged (1).
  Add the 12-frame repro as a test.
- Concur qa W6 (the two unbound guards; I found the same two), W7 (the "every mutant red" and "all fixed in r2" claims) and S7-S9.
- SUGGESTION A10 (measured in jsdom; the device timing is a suspicion): a bar pause press, then a play press before the prime's
  `play()` resolves, runs the sidecar's `pause()` under the playing video (recorded: sidecar play with the video paused, then
  sidecar pause with the video playing). Synchronous in jsdom; on a phone it needs a second press inside the sidecar's play
  latency. Rare, and the prime must still pause its own play, so there is no cheap guard: disclose it next to the 350 ms
  overlap.
- Security: unchanged; client-only, numeric details, `textContent` sink.

## 12. v1.360: the static review (H8) and Dean's ruling - the fix ships without a device repro

### 12.1 The static review (Opus reviewer, 2026-10-03, read-only at main 4c366600)

- **H7 (our code mutates the `<video>` or `#player-wrapper` around a pause/play) is dead.** Every write to the video's
  `currentTime` / `src` / `load()` / `playbackRate` / display, and every reparent or class change of the wrapper, sits behind a
  user seek, a double-tap, a 500 ms hold on a playing video, a load, a teardown, a swap-back from BACKGROUND_AUDIO, or the
  `css-fullscreen` autohide (CSS that only styles `.player-controls`). None of them runs on a single pause/play tap inline.
- **The "clock went backward" (`video:check t=8.3` above `video:stalled t=8.0`) is a reading artifact:** the panel lists newest
  first (`renderLifecycleOverlay`, `log.slice().reverse()`), and `t=` is the video's currentTime, not a stamp. The resume was at
  about t=1.9 and the check carries `+t=6.4`, so the check is at 8.3, AFTER the stall at 8.0. No seek.
- **New, H8: the background-audio gesture prime.** `primeBackgroundAudioElement` runs on the video's capture-phase `touchstart`
  (and the bar's play button), once per load, with Background audio for video ON. It plays the hidden sidecar `<audio>` (muted;
  pre-armed with the REAL `/audio/:id` since v1.35) under the video and pauses it when that play resolves. On an autostarted
  video the first touch is the PAUSE tap, so the prime runs under a playing video at exactly the tap after which Dean's frame
  count froze, and his log's `media:pause el=bgAudio` at that pause can only be the prime's own pause (a `pause()` on an
  already-paused element fires no event; the only inline path that plays the sidecar is the prime). One cycle to fail fits a
  one-shot. Against it: the prime is old (v1.27.1 / v1.35), and the report says "a recent regression" (an iOS update would fit
  both). What no static read settles: whether WebKit on iOS drops the video's layer when a second media element starts in the
  same gesture.

### 12.2 Dean's ruling (2026-10-03, AskUserQuestion)

Dean cannot test on device now and asked for a coded fix. Options put to him: the prime fix only, a self-heal only, or both.
**Ruling: both.** Stop rule 1 ("never theory-fix") is overruled for this release by Dean, on these terms (LESSONS 1: ship a fix
that also reports whether it worked): (a) the change that removes the suspected trigger; (b) a bounded self-heal for the observed
failed state that writes every attempt and its outcome into the `?debugLifecycle=1` log. Disclosed cost of (a), accepted: if
every touch of a load lands while the video plays (it autostarted and was never paused before a lock), the first lock is not
primed and may fall back to a plain pause instead of background audio.

### 12.3 Acceptance (what the gate measures; amended in the r1 fix round, see 12.5)

1. The prime never STARTS while the video is playing (`paused === false`): the video touch primes only on a paused video (the
   play tap); the bar's button primes AFTER its toggle, so a pause press primes under the now-paused video and a play press does
   not prime. The guard does not consume the one-shot. Except (disclosed, timing): the prime's own pause runs when its play()
   resolves, so it can land under a playing video if the video starts first: the picture's play tap starts the video about 350 ms
   after the prime (the single-tap debounce), and a bar pause press followed quickly by a play press (gate r2 A10).
2. The watchdog: on a mobile form factor (`isMobileFormFactor()`: phones and iPads), for a video item, from each `playing` to the
   next `pause` / `ended` / `emptied` / load, it reads `getVideoPlaybackQuality().totalVideoFrames` once a second. It judges only a
   play session whose count has NOT climbed for a sustained stretch since its `playing` (at least 4 s of media time AND at least 10
   frames at 5 fps or more ends the judging for that session; a single cached refresh of a few frames does not), and only once
   this load has seen the count climb (including first-play-to-pause). If the count then stands
   still for 6 s of wall time while `currentTime` advances by at least 4 s, the video is playing, not seeking, `readyState >= 2`,
   `videoWidth > 0`, inline (`webkitPresentationMode` absent or `inline`), the page is visible and the video is on screen, it sets
   `currentTime = currentTime` once. At most 2 heals per load; a third freeze logs gave-up and the load is not watched again.
3. Never: on desktop, for audio items, while hidden, off screen, in a native presentation, on a video whose count never climbed
   (a one-frame still), on a freeze in the first play before any pause, later in a session whose picture moved (a variable-frame-
   rate still), or after its load ended. A healthy count (including iOS's ~2 s cached refresh) never triggers it. Disclosed false
   positive: a variable-frame-rate video PAUSED and resumed on a still scene that holds 6 s or more (at most 2 in-place seeks).
4. Log lines (only with `?debugLifecycle=1`): `video:heal f=<n> t=<a>-><b> n=<k>`; `video:heal-ok f=<a>-><b> t=<t> n=<k>` only when
   the count climbs from the heal reading (10 frames at 5 fps); `video:heal-gave-up f=<n> t=<t> n=2`.
5. Nothing else changes: the v1.336 instrument's format, the handoff, the swap-back, presync, desktop.

Falsifiers on device (the device checks of section 8 plus): black again with `video:heal` and NO `video:heal-ok` after it = the
seek does not restore the layer (H2b, the layer is gone: re-root-cause); black with NO `video:heal` line at all = the watchdog's
gates missed the state (read the `video:check` line); black with Background audio OFF = H8 is dead. Black with Background audio ON
does NOT clear H8: on Dean's sequence the prime moves from the pause tap to the picture's PLAY tap, where the sidecar's muted play
starts about 350 ms before the video's own play (the single-tap debounce); if its play() resolves slower than that, the two
overlap (gate r1, qa W3 / adversary A1, reasoned).

### 12.4 Build log

- `public/js/player.js`: the guard in `primeBackgroundAudioElement`; the pure `frozenPictureDecision` + `framesClimbed`
  (exported); the runtime watchdog after `recordVideoState`; its listeners in `wireHostListeners`; its stop in
  `teardownMediaState`.
- `test/unit/black-picture-watchdog.test.js`: the pure decisions by invocation; the real player.js in jsdom (the hold-lock harness)
  through its real touch / click / media events with a hand-driven clock and interval.
- Mutants (a scratchpad copy of the committed tree, one at a time, `node --test test/unit/black-picture-watchdog.test.js`):
  25 tried. First pass 1041fb4f: 18 tried, 14 killed; survivors M9 (no climb read at the pause), M16 (the active-element
  test), M17 (the audio-mode test), M18 (the paused test). Second pass: M9 and M18 bound by two new tests (Dean's f 1 -> 58 in
  1.9 s first play; a paused read with no pause event). M16 and M17 REMOVED, not bound: a handoff pauses the video and runs only
  hidden (both already gated), and audio-mode is only set on an audio item (already refused). M19-M25 (seeking, readyState,
  videoWidth, the audio-item gate, the ended / emptied listeners, the generation check after close) survived until bound by six
  new tests, then all killed. The prime guard (M1, M2 = the guard consuming the one-shot) and the climb, advance, window, cap,
  visibility, on-screen, desktop, listeners, teardown stop, the heal write and the heal-ok line are each red when mutated.
  Final: 20 tests, every mutant red.
- Deviation: the ok-gate lost its sidecar and audio-mode clauses (above), with a comment; 12.3 item 2 amended to match (r1 fix).
- CORRECTION (gate r1): "Final: 20 tests, every mutant red" was false. Both seats found survivors the build's mutant list never
  tried (the per-load resets in syncFrozenGen, the gave-up line, three on-screen edges, the 10-frame floor). See 12.5.

### 12.5 Fix round r1 -> r2 (both seats CHANGES @b6b8bb34, no CRITICAL)

| Finding | Fix |
|---|---|
| adv A1: the bar's play press primed, then played the video in the same task; the prime's pause landed under the playing video | `ppBtn` toggles FIRST, then primes: a pause press primes under the paused video, the prime's own guard refuses a play press. Bound by behaviour (every sidecar play/pause recorded with the video's paused state). |
| qa W2 / adv A2: a variable-frame-rate still gets healed | The watchdog judges only a play session whose count has not climbed since its `playing` (Dean's freeze started at the resume); a session whose picture moved is healthy for good. Residual (disclosed): a VFR video resumed on a still scene. |
| qa W4 / adv A3: one frame after a heal logged heal-ok; timing-dependent | heal-ok needs a real climb (10 frames at 5 fps) from the heal reading, checked every tick (no null window after a heal). Bound: a one-frame-then-freeze run logs no heal-ok, a second heal, then gave-up. |
| qa W1 / adv A4: per-load resets, gave-up line, on-screen edges, the 10-frame floor unbound | Tests: a second load heals again and a third load's one-frame still is never healed; the gave-up line; left / right / below / zero-size; the floor at 18 fps (9 frames false, 10 true). |
| qa W3: on Dean's sequence the prime moves to the play tap | Disclosed in 12.3 falsifiers, the ROADMAP Planned entry and the Shipped entry. |
| qa W5 / adv A5: `SUITES_LINE` placeholder | Filled with the r2 suite line. |
| qa S1 | 12.3 amended. |
| qa S2 | "mobile form factor (phones and iPads)" in the docs. |
| qa S3 | Comments and docs say the capture shows the sidecar's PAUSE. |
| qa S4 | `video:heal-gave-up` on the freeze after the cap; the load is not watched again. |
| qa S5 | The block comment rewritten (widths, `emptied` named). |
| qa S6 | LESSONS bullet: "suspected trigger", not an established cause. |
| adv A6 | The `ended` tests dropped from the prime and the ok-gate, with a comment (an element at its end reads paused). |
| adv A7 | The ok-gate requires `webkitPresentationMode` absent or `inline`; bound by a test. |
| adv A8 | Not changed, reasoned: live transcode is chosen above 768 px wide; the in-place seek there is to the same position in the live stream (qa found it harmless). |
| (new in the fix) | A freeze in the first play before any pause is not healed (no proof yet the counter is live); bound by a test, disclosed. |

Mutants after the fix (scratchpad copy of the working tree, `node --test test/unit/black-picture-watchdog.test.js`, 30 + 3 re-runs):
all red. Two equivalents found and removed rather than kept: a `wasPlaying` gate on the bar's prime (the prime's own guard decides
it) and, in the first draft of the VFR test, a fixture that passed for the wrong reason (no load climb), rewritten on
`frozenAfterResume`. 30 tests in the file.

### 12.6 Fix round r2 -> r3 (both seats CHANGES @68abb354, no CRITICAL; Dean, AskUserQuestion: "Fix all, short round 3")

| Finding | Fix |
|---|---|
| adv A9 (new in r1 fix, measured): the session-climb stop fired on the first cached refresh, so a freeze ~0.4 s after a resume never healed | The session counts as healthy only after 4 s of media time AND a real climb (the adversary's verified line). Bound by the A9 repro (+0, +12, then flat: 2 heals). |
| qa W6 / adv: `frozenHealFrom = null` after heal-ok and the session stop unbound | The heal-ok test runs 10 healthy seconds and asserts exactly one heal-ok and a stopped watch; the VFR test holds its still 40 s. |
| adv: `n.ok` in the heal-ok test and `frozenHealFrom = null` on gave-up (no behaviour change found) | Removed (equivalent code), so no untested guard remains. |
| qa W7: "all red" / "every mutant red" / "all fixed in r2" overclaimed | Docs rewritten with the r3 mutant count; the ROADMAP gate line is written only from the recorded verdicts. |
| qa S7 / adv A10 | 12.3 item 1 says "never STARTS" and discloses both timing overlaps; ROADMAP Disclosed too. |
| qa S8 | DEVICE-CHECKS: the lock check after a bar pause as well as a picture pause. |
| qa S9 | The ROADMAP Tests bullet re-wrapped. |

Mutants at the r3 fix (scratchpad copy, `node --test` on black-picture-watchdog + player-background-audio; the sandbox has no
server.js, so one unrelated source-lock test fails in every run including the pristine copy, 1 fail): 41 tried (the r1/r2 set plus
R1 heal-ok reset, R2 session stop, R3 the sustained-stretch clause, W5b gave-up start, W31 since-after-heal, W32/W33 listeners),
each at 2 or more fails, i.e. every one red on at least one real test. 32 tests in the watchdog file.

