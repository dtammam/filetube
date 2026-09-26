---
plan: fullscreen-black-and-border
harness: v2 · lean
branch: feat/v1.336-fullscreen-black-border
anchor: outcome
status: Building
next: commit the build, then the gate (adversary + qa, fresh, max two rounds).
gate: pending
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
| D1 | NOT fixed this wave. Headless Chromium cannot show an iPhone video layer going black, and no device A/B exists yet, so a fix would be a theory-fix (LESSONS 1). This wave ships the INSTRUMENT: the video's own state in the `?debugLifecycle=1` log at every event that can start, stop or starve its picture, plus a check 2s after each `playing` with what moved. Dean captures one failing run; v1.337 fixes the mechanism it names. |
| D2 | Fixed: every fullscreen (the iPhone faux overlay, the Fullscreen API host, the staged desktop twin) drops the inline player's 1px `--border-color` border and its era radius. The inline player is unchanged. |
| B1 | (builder, disclosed) D2 covers DESKTOP fullscreen too: the probe measured the same border there in 8 of 8 themes, plus a 2px (2009/2014) or 12px (2021) rounded corner on the black stage. Dean's "in full screen, in all modes" does not exclude it; the rule is the same bug. |
| B2 | (builder) The instrument never calls `requestVideoFrameCallback` and never reads the video into a canvas: in WebKit both attach a video output to the player (the v1.312 ambient blackout's shape), so the instrument could cause the black it measures. Plain property reads only; a test bans both calls in player.js. |

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
- Why Dean's screenshots miss it: our headless screenshot DOES contain it (above), so the edge is
  painted, not compositor-only. On his phone it is 3 device pixels of near-white at the very edge of
  the image; a screenshot viewed on a white or light background (Photos, a chat) shows no visible
  edge. Not a contradiction of his report: it changes no decision (the border goes either way).
  His device check confirms it.

### D1 - hypotheses and what would falsify each

The bisect (a read-only subagent over v1.311.2..v1.335.0, every player/CSS/shell change): player.js
changed in v1.322 (Chapter Snap) and v1.334 (the autostart flag, whose cue renders only on a music
skin panel) only; no release in the window adds a `play()` retry, a `load()`, a `src` reset or a
poster toggle on a user pause/resume, and nothing adds a filter/mask/transform on or over the video.

| Hypothesis | Where | Falsified by |
|---|---|---|
| H1 Ambient (ON on Dean's phone). It re-evaluates on every play/pause (ambient.js:668-672), keeps running in faux fullscreen (no fullscreen exclusion), and repaints/cross-fades its two layers. v1.312's blackout had this exact signature (picture black, audio and glow continuing). | ambient.js, style.css `.ambient-glow` | It still goes black with Ambient OFF in the cog. |
| H2 The background-audio sidecar (ON on his phone): the sound after the black comes from the hidden audio element, not the video. | player.js handoff / priming | The log's `act=video` with `bg=inline_video` at the black resume. |
| H3 The tap glyph: every tap on the picture flashes `.art-play-glyph` (a `filter: drop-shadow` + an opacity/scale animation) over the video. Old (2026-08-16), so "recent" fits only an iOS change. | style.css `.art-play-glyph` | It still goes black using only the bar's play button. |
| H4 v1.311.2 (2026-09-23): faux fullscreen pins `<body>` with `position:fixed` (a stacking context around the fixed overlay). | body-scroll-lock.js | Weakened already: the picture stays black INLINE after leaving fullscreen (the lock is released there). |

The instrument's `video:check` line separates the layer from the frames: `+f` climbing while black =
frames reach a layer that is not shown (H1/H3); `f` back to 0 or restarting = the video layer was
rebuilt; `+f=0` with `+t` running = frames stopped; `act=bgAudio` = H2; `pm` other than `inline` = iOS moved the video to a native presentation.
What the counters mean ON THE IPHONE (WebKit main, primary source, fetched 2026-09-26):
`HTMLMediaElement::getVideoPlaybackQuality` (Source/WebCore/html/HTMLMediaElement.cpp) adds
`player->videoPlaybackQualityMetrics()`, which for the AVFoundation player
(Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateAVFoundationObjC.mm) is
`[m_videoLayer videoPerformanceMetrics]`: the AVPlayerLayer's own `totalNumberOfVideoFrames` /
`numberOfDroppedVideoFrames`, and `std::nullopt` with no layer. So `f` is the LAYER's count: climbing
while black = frames reach a layer that is not shown; dropping to 0 or restarting = the layer was torn
down and rebuilt. `webkitDecodedFrameCount` (HTMLVideoElement.cpp) calls `player->decodedFrameCount()`,
which the AVFoundation player does not implement: `dec` reads 0 on the iPhone (disclosed; Chromium
fills it). `displayCompositedVideoFrames` is exposed only behind
`videoQualityIncludesDisplayCompositingEnabled` (VideoPlaybackQuality.idl), so `dc` is printed only
when present.

Reachability (the probe, real Chromium media events, `?debugLifecycle=1`, faux fullscreen, pause /
resume x2 by `#pp-btn`): `INSTRUMENT pause=2 playing=2 check=1 fs-at-pause=2`; base: all 0. A
healthy check reads `+f=50 +dec=50 +t=2.0`.

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

## Dean's device check (after v1.336)

- D2: fullscreen, any theme: no light edge.
- D1: open `<app>/?debugLifecycle=1` once; play a video, fullscreen, pause/resume until it goes black;
  wait 3 seconds; leave fullscreen and screenshot the log panel at the bottom. Also, if he can: the same
  with Ambient OFF, and once using only the bar's play button.
