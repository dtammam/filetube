# Exec plan: audio expanded-now-playing parity with video fullscreen (v1.120)

- Owner: main session (lean mode)
- Opened: 2026-08-14
- **CLOSED: 2026-08-14 - shipped as v1.120.0. Slim gate (adversarial) APPROVE
  after 2 fix rounds: (1) auto-hide gated to mobile + audio reveal-without-toggle;
  (2) the reveal guard was DEAD on touch (lived in the 'click' handler that a
  touchend preventDefault suppresses on iOS) -> moved into a shared
  artSingleTapOrReveal() wired to the TOUCH single-tap. Dual-Node 6854/6854.
  Device pass PENDING.** LESSON: "it's in the source" != "it runs on the device"
  - a reveal guard on the mouse 'click' path is dead on a phone; bind the reachable
  path, not presence.
- Target: v1.120.0
- Device pass: PENDING (Dean) — iOS runtime arbiter (same as v1.118/v1.119).
- NOT data-mutating (player UI). Slim gate (adversarial).

## Goal (Dean)
Apply the v1.118/v1.119 mobile-fullscreen experience to AUDIO. Audio has no iOS
native fullscreen (no video track); its equivalent is the EXPANDED now-playing
view (`#player-wrapper.audio-mode.audio-expanded`, a `position:fixed; inset:0`
cover-art overlay). Full parity:
1. Rotate to landscape while PLAYING audio -> auto-EXPAND (setAudioExpanded(true)).
2. Rotate back to portrait -> COLLAPSE (setAudioExpanded(false)). Pure class
   toggle (no iOS native, no bounce, no pause -- cleaner than video).
3. Auto-hide the control bar in the expanded view (fades while playing, reveals on
   tap of the cover art / bar, stays up paused, NEVER mid-scrub) -- same machinery
   as v1.119, generalized to cover audio-expanded too.
4. Bleed belt: pin the overlay to 100dvh/100dvw + freeze/black the body (parity
   with the v1.119 iOS-landscape fix).

## Tasks
1. **T1 - rotate branch.** onOrientationChange: an AUDIO branch (mobile, video-
   less, FULL) reusing the EXISTING pure helpers shouldEnterFauxOnRotate /
   shouldExitFauxOnRotate with `fauxOn = audio-expanded`. Enter->setAudioExpanded(
   true), exit->setAudioExpanded(false).
2. **T2 - setAudioExpanded(on).** A setter owning the class + `#fs-btn` aria + a
   body class (freeze/black belt) + the auto-hide cycle (reveal+arm on expand,
   cancel+show on collapse). toggleAudioExpand / exitAudioExpand route through it.
3. **T3 - generalise auto-hide.** Rename inFauxFullscreen -> inImmersiveMode =
   `css-fullscreen || audio-expanded` (the ONE surface both paths share). Add
   `#audio-bg-art` (the audio tap surface -- #media-player is pointer-events:none
   in audio-mode) to the reveal listeners.
4. **T4 - CSS.** audio-expanded overlay: 100dvh/100dvw belt + `body.ft-audio-
   expanded { overflow:hidden; background:#000 }`. Auto-hide: the hidden-state
   (opacity 0 + pointer-events none) + tokenised transition + reduced-motion for
   the audio-expanded bar too; when hidden, extend `#audio-bg-art` to bottom:0
   (reclaim the reserved 52px strip). Census stays 0 (tokens + token-exempt #000).
5. **T5 - tests.** New: audio rotate branch, setAudioExpanded cycle, inImmersiveMode
   covers both, audioBgArt reveal, CSS locks. Update the v1.119 locks for the
   inFauxFullscreen->inImmersiveMode rename.

## Named attack surfaces (adversarial, slim gate)
- Never-hide-paused + never-mid-scrub still hold for the audio path (same
  guards; audio plays via mediaPlayer so `paused`/`isScrubbing` read correctly).
- Stranding: a hidden audio bar reveals on a cover-art tap (audioBgArt listener);
  pause/ended reveal.
- SCOPE: video faux fullscreen UNCHANGED by the generalisation; desktop/docked/
  inline untouched; the audio rotate branch is video-less + FULL + mobile only.
- toggleAudioExpand (the button) still works, and exitAudioExpand still force-
  clears on dock/teardown (+ now clears the auto-hide timer -> no stale hide).
- The rename touches every inFauxFullscreen site -- prove none missed.

## Stop condition
Adversarial APPROVE (slim); dual-Node green; released device-pass PENDING. Dean's
iOS pass: play audio -> rotate sideways (expands, bar fades, tap reveals) -> rotate
back (collapses). Move to completed/ at release.
