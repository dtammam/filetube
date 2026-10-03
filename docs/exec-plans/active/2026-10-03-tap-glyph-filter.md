---
plan: tap-glyph-filter
harness: v2 · lean
branch: fix/v1.361-tap-glyph
anchor: outcome
status: Building (v1.361.0)
next: build done; the gate (adversary + qa, same HEAD), then the release
gate: pending
---

# v1.361: the tap glyph loses its shadow, and v1.360 is undone

Planned 2026-10-03 by the Architect at main d9cbe71d (v1.360.0 shipped). The bug's history and its first two diagnoses are in
`docs/exec-plans/completed/2026-10-03-black-screen-after-pauses.md` (H1 to H8, the v1.360 fix and its gate rounds). This plan is
the third diagnosis, made from Dean's device A/B, and its fix.

## 1. What the device said (Dean, 2026-10-03, iPhone on iOS 27)

1. v1.360.0 FAILED. Capture 2: the background-audio prime ran under the PAUSED video as designed and the picture kept working for
   ~10 s, then froze anyway. Capture 3: the watchdog fired twice (`video:heal n=1`, `n=2`), the layer frame count stayed at 304,
   no `video:heal-ok`: an in-place seek does not revive it. Capture 4: Background audio for video OFF (`bgAudio:arm setting-off`),
   Ambient OFF: still froze, on the FIRST pause/resume after an app restart. H8 (the prime) is dead.
2. Recovery: a far seek into unbuffered time does NOT bring the picture back (the sound carries on from the new spot, so the
   network and the decoder's audio side are fine); docking and returning does not; switching to another video and back DOES (a
   new src); an app restart does.
3. **The A/B that names the trigger: 20 pause/play cycles with ONLY the bar's button never went black. Picture taps did.**
4. "This is a somewhat new thing", and the phone is on iOS 27. The server and connection audit (an Explore pass, 2026-10-03)
   found nothing that can hold a video range request (`lib/media/streams.js` `sendRangeable`: a fresh stat and stream per
   request, `pipeline` destroys it on an abort, no locks or limiters; no long-lived connection on the watch page unless Remote
   is on).

## 2. The diagnosis

A picture tap differs from the bar's button in what it PAINTS: `toggleArtPlayPause` -> `flashArtGlyph` flashes `.art-play-glyph`
over the playing video for 650 ms (an opacity + scale animation), and its `::before` carried `filter: drop-shadow(0 2px 6px
rgba(0,0,0,.6))`. That is the v1.312 class exactly (LESSONS 7 / LESSONS-rules: a filter, mask or backdrop on or over a playing
iPhone video blacks out its picture while the sound and the glow run on), and it fits every fact: the video's own layer stops
(the frame count is the layer's metric), a seek cannot rebuild it, a new src can, the bar's button never paints the glyph, and the
glyph is old (v1.134 put it on video taps) so "new" is the OS (iOS 27). The double-tap skip ripple has no filter (an opacity
animation of a translucent wash) and stays.

Not proven: whether it is the FILTER or the flash itself (a composited opacity / transform animation over the video). The fix
removes the filter only (Dean's ruling: "Keep it, drop the shadow"); if picture taps still black it out, the next step is no glyph
over the video. Dean ruled against a recovery mechanism ("I don't know if we want to build in a weird recovery mechanism for a glyph
graphic problem") and for removing what v1.360 added ("I don't want to keep something we added that didn't work").

## 3. Acceptance

1. `.art-play-glyph::before` has no `filter`; the glyph's legibility backing is a painted disc (`.art-play-glyph` background:
   a radial gradient of `var(--scrim)` with radius `var(--size-control)`). It flashes exactly as before (same element, class,
   animation and timing).
2. No stylesheet rule whose selector names the player host, the video or an overlay in it carries `filter`, `backdrop-filter`,
   `mask`, `mask-image` or `mix-blend-mode` (locked by `test/unit/player-overlay-no-filter.test.js`, red on v1.360's stylesheet).
3. `public/js/player.js` and `test/unit/player-background-audio.test.js` are byte-identical to v1.359.0 (4c366600);
   `test/unit/black-picture-watchdog.test.js` is deleted.
4. `npm run lint:ui` OK (the ratchet shrank by one paid annotation).
5. Docs: ROADMAP (the bug entry, the v1.361.0 Shipped entry), DEVICE-CHECKS (the v1.360 lines replaced), LESSONS 7 (the v1.360
   section-5 bullet removed as wrong; a section-7 bullet for the class, x2).

Falsifier on device: black again after picture taps = the filter was not (all of) it; next = no glyph over the video.

## 4. Build log

- `git checkout 4c366600 -- public/js/player.js test/unit/player-background-audio.test.js`; `git rm test/unit/black-picture-watchdog.test.js`.
- `public/css/style.css`: the filter line removed from `.art-play-glyph::before`; a new `.art-play-glyph` rule with the disc.
  A first draft used an `::after` disc with four `token-exempt` sizes (ui-lint: NEW debt 203 > 200); redone with tokens, then
  `node scripts/ui-lint.js --shrink` (199).
- `test/unit/player-overlay-no-filter.test.js`: 2 tests; green here, both red against main's (v1.360) stylesheet.
- Look: headless Chromium crop, before vs after, frozen mid-flash over a real thumbnail, sent to Dean.

## 5. Gate record

Seats: adversary + qa (the shared player overlay CSS and a revert of the player core; security-brief applied as a section by both).
