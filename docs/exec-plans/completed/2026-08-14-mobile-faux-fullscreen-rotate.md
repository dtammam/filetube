# Exec plan: our faux fullscreen supersedes Apple's on mobile rotate (v1.118)

- Owner: main session (lean mode)
- Opened: 2026-08-14
- **CLOSED: 2026-08-14 - shipped as v1.118.0. Slim gate (adversarial) APPROVE
  after a one-round belt (SUGGESTION 2: hoist + reset fauxHandoffAt so a
  button-faux can't inherit a stale handoff stamp; SUGGESTION 1: tightened the
  time-guard test lock `> \d+` -> `> \d{4}`). SUGGESTION 3 (bounce-fail +
  exit-within-1500ms window; whether a ~225ms native fs is "established" enough to
  pause) is a device-runtime residual = tech-debt #146, Dean's device pass. The
  iOS-pause invariant (no programmatic native exit on rotate) is mutation-bound on
  both surfaces. Dual-Node 6843/6843. DEVICE PASS PENDING.**
- Target: v1.118.0
- Device pass: PENDING (Dean) - **THE ARBITER**. This is iOS-runtime behavior no
  dev-env test can reproduce; the pure decisions are unit-locked, the iOS bounce
  reliability is a ship -> verify -> iterate loop Dean explicitly signed up for.
- NOT data-mutating (player UI lifecycle). Slim gate (adversarial), briefed hard
  on the fullscreen STATE MACHINE + the iOS pause invariant.

## The bug + the goal (Dean, on-device, with screenshots)

Mobile iOS PWA, CUSTOM player. Play a video, rotate to landscape while PLAYING ->
iOS auto-enters its NATIVE fullscreen player (image 4: AirPlay/±10/pill scrubber).
Rotating a PAUSED video does nothing (just the sideways viewport) - the trigger is
landscape + playing. Two pains:
1. Exiting the native player drops Dean into our FAUX css-fullscreen (armed
   underneath), forcing an extra tap on our fullscreen button to reach the normal
   player.
2. Rotating BACK to portrait can't auto-exit the native player.

Root cause (code-confirmed): in custom mode the `webkitbeginfullscreen` intercept
(player.js ~5795) does `webkitExitFullscreen(); setCssFullscreen(true);`. On Dean's
device the exit NO-OPS (he stays in native), but faux gets armed anyway -> revealed
on the eventual native exit. And `keeperNativeFsExit` (~1725) treats "native-exit
while faux-on" as the intercept's instantaneous handoff, so Dean's REAL (late) exit
is misclassified and left in faux.

**Dean's decision:** make our FAUX fullscreen supersede Apple's entirely. iOS
native fullscreen CANNOT be exited by code without pausing the video (proven +
reverted 2026-07-10; see player-orientation-fs-resume.test.js) - but FAUX is pure
CSS, so it opens AND closes freely. The dream: play -> rotate sideways -> OUR
fullscreen -> rotate back -> auto-drops to the normal player, still playing, ZERO
taps.

## Scope guard
CUSTOM-mode mobile video ONLY (`isMobileFormFactor() && !inNativeControlsMode() &&
type!=='audio'`). Native-controls mode (the v1.25.2 default, setting OFF) and
desktop keep their EXISTING native-fullscreen behavior byte-for-byte. Audio
untouched.

## Tasks (each green before the next)
1. **T1 - pure decisions (exported, unit-tested).**
   - `shouldEnterFauxOnRotate({landscape, playing, fauxOn})` = landscape && playing
     && !fauxOn.
   - `shouldExitFauxOnRotate({landscape, fauxOn})` = !landscape && fauxOn.
   - Keep `shouldAutoFullscreenOnRotate` for the native-controls/desktop branch.
2. **T2 - onOrientationChange rewrite.** In custom-video: `shouldEnterFauxOnRotate`
   -> `setCssFullscreen(true)`; `shouldExitFauxOnRotate` -> `setCssFullscreen(false,
   {restoreScroll:true})` (CSS exit, NO webkitExitFullscreen -> no pause -> the
   invariant the 2026-07-10 test locks STAYS true). Native-controls/desktop branch
   unchanged (still `enterFullscreen()`).
3. **T3 - reliable bounce.** Strengthen the `webkitbeginfullscreen` intercept: arm
   faux immediately, then retry `webkitExitFullscreen()` briefly (short,
   enter-window-only, so it never becomes the established-fullscreen exit that iOS
   pauses) until `webkitDisplayingFullscreen` is false. This is the on-device
   uncertain piece.
4. **T4 - Fix A (safety net).** On a GENUINE native-fullscreen exit (not the
   intercept's own handoff), clear any armed faux so the user always lands in the
   normal inline player. Distinguish handoff (intercept just armed faux, within a
   short window) from a real user exit (much later) via a timestamp/flag.
5. **T5 - tests.** Update player-orientation-fs-resume.test.js (the wiring now
   routes custom-video through the faux helpers; the no-`webkitExitFullscreen`-on-
   rotate invariant is PRESERVED and re-asserted; enterFullscreen() survives on the
   native branch). New pure-helper tests + wiring locks for the faux enter/exit +
   the Fix A clear.

## Named attack surfaces (adversarial, slim gate)
- **The iOS pause invariant:** the rotate-back exit must NEVER call
  webkitExitFullscreen/exitFullscreen (only setCssFullscreen(false)). Mutation:
  prove the no-native-exit-on-rotate lock still binds.
- **Native-controls / desktop regression:** those branches must be byte-unchanged
  (still native fullscreen, still enterFullscreen()). Prove the faux branch is
  gated OFF for them.
- **Fix A handoff vs user-exit:** clearing faux on a native exit must NOT clear the
  intercept's own just-armed faux (would break the bounce on devices where exit
  works). Prove the time/flag disambiguation.
- **Audio untouched; docked (non-FULL) untouched** (state !== STATE_FULL early
  return stays).

## Stop condition
Adversarial APPROVE (slim); dual-Node green; released with device pass PENDING.
Dean's iOS pass is the arbiter: play -> rotate sideways (OUR fullscreen, still
playing) -> rotate back (auto-drops to normal player, still playing, zero taps);
and a manual fullscreen-button exit still lands clean. Move to completed/ at
release (or iterate if the bounce needs on-device tuning).
```
