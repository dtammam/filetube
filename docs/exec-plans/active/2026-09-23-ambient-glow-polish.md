---
plan: ambient-glow-polish
harness: v2 · lean
branch: fix/ambient-glow-polish
anchor: spec
status: Building
next: dual-Node full suites, then the gate (adversary + qa; escalated from the table's floor per Dean's standing "full gate"), then Dean's iPhone, then release
design: Approved 2026-09-23 @cf3e65d3 (Dean: "go" on the plan as presented)
gate: pending
---

# Ambient glow visual polish - vignetted bitmap instead of eight gradients

## The request (restated)

v1.312.0 rebuilt ambient mode colour-only and Dean CONFIRMED on his iPhone that the
picture stays (R0 closed). His verdict on the look: "functionally works but isn't
visually complete - looks worse on hard borders/edges, and look at the player corners."
His desktop + iPhone screenshots show three defects of the gradient design:

1. **Hard band ends** - each edge band is a `linear-gradient` fading along ONE axis, so
   its two short ends (where it meets the corner cells) are hard lines.
2. **Corner notches** - the corner `radial-gradient(farthest-side at <corner>)` starts at
   full colour at the player's corner point; the player (`.player-container`) has
   `border-radius: var(--radius-lg)` + `overflow: hidden`, so the bright corner cell shows
   through the rounded gap as a notch, and the band/ellipse seam is visible beside it.
3. **Flat, muddy colour** - one averaged swatch per band and `ambientLift`'s lightness
   floor of 0.30 turn any scene into a uniform grey slab.

Constraint carried from v1.312 (the R0 fix): never read the `<video>`; no `filter`,
`transform`, `mask`, `backdrop-filter`, `will-change`, `mix-blend-mode` on any rule
naming `ambient-glow` or `watch-player-stage`.

## Diagnosis + falsifier

- **Hypothesis:** a `background-image` (a tiny PNG data URL) on the plain glow div is an
  ordinary paint, not a compositor filter, so the iOS video layer stays. The DOM layer's
  paint changes, so **Dean's iPhone re-check is an acceptance criterion before the tag.**
- **Falsifier:** the picture goes black again on his iPhone with the bitmap glow. Then
  the "plain paint is safe" belief is wrong; re-root-cause from that observation.

## Decision register (spec anchor)

| ID | Decision | Choice | Why |
|----|----------|--------|-----|
| D1 | Paint | The sprite tile / poster is drawn STRETCHED over a 64x36 off-DOM canvas that represents the whole glow box (player + reach), per-pixel lifted, then a rounded-rect VIGNETTE is written into the alpha channel (1 at the player's edge, 0 at the box edge, gamma 1.5 - the measured YouTube falloff); the PNG data URL becomes the back layer's `background-image` at `background-size: 100% 100%`. The bilinear upscale IS the blur (YouTube upscales 110x75 by scale(1.5, 2), no CSS filter). | One continuous 2D alpha field: no band ends, no corner seams; the picture's own spatial variation survives (Dean's "flat" complaint); zero filter/transform/mask. |
| D2 | Corners | The vignette is computed on the distance OUTSIDE the inner (player) rectangle, `f = hypot(fx, fy)` clamped to 1, so the falloff is rounded at the corners and the corner reads dimmer than the edge midpoint (YouTube: corner +100/+100 = [18,18,15] vs edge [31,40,28]). The region under the player stays opaque with the frame's own corner colour, so the rounded-corner gap shows a continuous tint. | Matches the measured reference; no separate corner paint to seam against. |
| D3 | Lift | `ambientLift` keeps saturation x1.15 and the 0.62 ceiling; the lightness FLOOR drops 0.30 -> 0.12 (a dark scene glows dimly, not grey). Applied per pixel. | The grey slab was the floor + the averaging; the averaging is gone with D1. |
| D4 | Geometry source of truth | `AMBIENT_REACH_X = 0.12`, `AMBIENT_REACH_Y = 0.22` in watch.js; the CSS `--ambient-reach-x/y` are bound to them by a test (the hand-copy trap). The `--ambient-band-*` vars go (no gradients read them). | Reach must agree between the vignette's inner rect and the CSS insets or the peak lands off the player's edge. |
| D5 | Cost | One 64x36 draw + one per-pixel pass (2304 px) + one `toDataURL('image/png')` (~2-4 KB) per tile change (2-10 s) or poster load; the 1 s clock, two cross-fading layers, sprite->poster ladder, `onHardFail` teardown all unchanged. | Same cadence as v1.312; the work per paint is microseconds. |
| D6 | Knob | `--ambient-opacity` stays the one tuning knob (0.3). | Dean's phone judges; nothing else to tune. |

## Acceptance (measurable)

1. **Desktop probe** (headless Chromium, VP9 clip + the static ffmpeg, the v1.312 probe
   extended): samples along each band's END (near the corners) and on the four corner
   diagonals as well as the edge midpoints. Adjacent samples along a band never step by
   more than the smooth falloff (no hard line); the corner-diagonal sample at a given
   fraction of the reach is at most the edge-midpoint sample at the same fraction; the
   edge peak sits near YouTube's ~+25/255 and is gone by the reach.
2. **Rounded corner gap:** a pixel just inside the player's corner radius (in the gap)
   carries a tint continuous with the band (same hue family, brightness between the
   band's peak and the page).
3. Computed `filter` / `transform` / `mask` / `will-change` are `none`/`auto` on the glow
   and the stage; the engine never hands the video element to `drawImage`; the CSS
   constraint sweep (every rule naming `ambient-glow` or `watch-player-stage`) still
   passes. `background-image` is a `data:image/png` URL, never `-webkit-canvas()` /
   `element()` / a cross-origin URL (a new lock).
4. Unit: `ambientVignette` writes alpha 255 inside the inner rect, 0 on the outermost
   ring, monotonic non-increasing outward along the mid row / mid column, and the corner
   diagonal <= the edge at the same fraction; the engine's paint sets a `data:image/png`
   background on the back layer and a tile change swaps the front with a DIFFERENT URL;
   the same tile paints nothing. The v1.312 "eight gradients" paint lock is replaced.
5. **Dean's iPhone:** picture stays with ambient ON (inline + faux fullscreen), the corners
   and band ends look right; R2 (fullscreen drag page move) re-checked while there.
6. `npm run lint:css` and `node scripts/overlay-containment-lint.js --enforce` at ZERO;
   dual-Node full suites green; full gate.

## Design

`createAmbientEngine` keeps its shape (source ladder, clock, cross-fade, hard-fail). Only
`sample()` and `paint()` change:

```
sample(img, src) -> dataUrl
  c = 64x36 canvas; ctx.drawImage(tile or poster -> 0,0,64,36)   // stretched over the BOX
  id = ctx.getImageData(0,0,64,36); ambientVignette(id.data, 64, 36, {rx:0.12, ry:0.22})
  ctx.putImageData(id, 0, 0); return canvas.toDataURL('image/png')
paint(dataUrl, src)
  back.style.setProperty('background-image', 'url("' + dataUrl + '")'); swap is-front
```

`ambientVignette(data, w, h, reach)` (pure, exported): for each pixel, lift the colour
(D3), then `u = |x+0.5 - w/2| / (w/2)`, `ux = 1/(1+2*rx)`, `fx = max(0, (u-ux)/(1-ux))`,
same for y; `f = min(1, hypot(fx, fy))`; `alpha = round(255 * (1-f)^1.5)`.

CSS: `.ambient-glow-layer` drops the gradient stack for `background-repeat: no-repeat;
background-size: 100% 100%` (the image is set inline). `--ambient-band-*` removed. Every
other rule unchanged.

Tests: `test/unit/ambient-glow-engine.test.js` - the swatch tests (`ambientEdgeColors`,
`ambientGlowVars`) are replaced by `ambientVignette` tests; the harness's fake canvas
gains `putImageData` + `toDataURL`; the CSS PAINT lock becomes the bitmap lock; a
GEOMETRY lock binds the CSS reach to the JS constants.

### Steps
- Step 1: `ambientVignette` + constants + engine `sample`/`paint` rewrite + exports. Demo: unit green.
- Step 2: CSS layer rule + comments. Demo: lint:css + overlay lint at zero; constraint lock green.
- Step 3: tests replaced (unit + locks); mutation round in a git-archive sandbox.
- Step 4: desktop probe with band-end + corner sampling; numbers + screenshot recorded here.
- Step 5: dual-Node suites; gate; Dean's iPhone; release per docs/RELEASING.md.

## Build record

- **Commit 61b95a86 (Steps 1-3):** `watch.js` - `ambientVignette` (pure, exported) +
  `AMBIENT_REACH_X/Y`, `AMBIENT_VIGNETTE_GAMMA`, a 64x36 bitmap (`AMBIENT_SAMPLE_W/H`),
  `ambientLift` floor 0.30 -> 0.12, the engine's `sample()` returns a PNG data URL
  (draw stretched -> getImageData -> vignette in place -> putImageData -> toDataURL; any
  non-PNG result is a failed sample) and `paint()` sets it as the back layer's
  `background-image`; `ambientAvg` / `ambientEdgeColors` / `ambientGlowVars` removed.
  `style.css` - the layer rule is `background-repeat: no-repeat; background-size: 100%
  100%` (no gradients, no `--ag-*`, no `--ambient-band-*`); comments rewritten.
  `ambient-glow-engine.test.js` - vignette + dim-lift tests replace the swatch tests;
  the fake canvas gains `putImageData` + a content-addressed `toDataURL`; the engine
  tests assert a `data:image/png` background and a DIFFERENT URL after a tile change;
  the CSS PAINT lock is the bitmap lock; the GEOMETRY lock binds the CSS reach to the JS
  constants; the SOURCE lock gains the vignette/putImageData/toDataURL/PNG-only lines.
  Unit suite 6916/6916 (Node 22.23.1); lint:css 0; overlay lint 0.
- **Mutation round 1 @61b95a86** (git-archive sandbox, the two ambient files, baseline
  33/0 across the engine + watch-chrome-ambient files): 17 mutants, **15 killed** - no
  vignette alpha, max-not-hypot (square corners), lift floor back to 0.30, JS reach drift,
  CSS reach drift, paint writes a var not the image, any URL accepted, vignette never
  written back, engine skips the vignette, a CSS gradient returns, background-size
  dropped, drawing the VIDEO, gamma ignored, the ring normalisation reverted, bitmap back
  to 16x9. **2 survived:** M16 was mis-aimed (perl replaced the sheet's FIRST
  `background-repeat`, not the layer's) - re-run below; **M17 was a real gap:** a
  SEPARATE `.ambient-glow-layer { image-rendering: pixelated; }` rule slipped the lock,
  which read only the layer's base rule body.
- **Commit d5ee88fc:** the image-rendering lock sweeps every rule naming `ambient-glow`
  or `watch-player-stage` (the same set as the filter/transform constraint).
  **Mutation round 2 @d5ee88fc:** M16 (the layer's no-repeat dropped, aimed right), M17
  (pixelated), M18 (`#ambient-glow > div { image-rendering: crisp-edges; }`) - **3/3
  killed.** Round totals: 18 distinct mutants, 18 killed.
- **Step 4 desktop probe @d5ee88fc** (headless Chromium 1600x1000, the in-process server,
  a VP9 clip + a sprite built with `lib/storyboard`'s own ffmpeg args via the static
  ffmpeg 7.0.2; script `ambient-polish-probe.js` + JSON + PNGs in the session
  scratchpad). Dark, `ft-ambient=1`, playing; the player is `.player-container`
  918x557 at (254,80), `border-radius: 12px`; the glow box 1138x802 (12% / 22% reach).
  - Constraints: `#ambient-glow` `is-on`, computed opacity 0.3, `filter: none`,
    `transform: none`, `mask: none`, `will-change: auto`; the stage the same; the
    front layer `background-image: url("data:image/png;base64,...")` (5.7 KB on the
    testsrc2 clip, 0.8 KB on a uniform clip), `background-size: 100% 100%`,
    `image-rendering: auto`; zero page errors; the front swapped with a different URL
    by ~13 s; the cog toggle off tears it down (`hidden`, no `is-on`, root attribute
    cleared, `ft-ambient` stored `0`).
  - **Band ENDS (the v1.312 defect), testsrc2 clip.** Along the BOTTOM band (30 px
    below the player) from mid width to past the right edge, x relative to the right
    edge: -459 [33,32,33] · -100 [41,30,16] · -40 [42,24,53] · -10 [43,24,53] · 0
    [43,24,52] · +10 [43,24,50] · +25 [40,23,45] · +50 [32,21,34] · +80 [21,19,21] ·
    +120 [18,18,18] (page). Along the RIGHT band (30 px out) from mid height down past
    the bottom edge, y relative to the bottom: -279 [52,25,54] · -100 [53,25,54] · -40
    [55,25,55] · -10 [55,25,55] · 0 [55,25,55] · +10 [52,24,52] · +25 [47,23,47] · +50
    [36,21,36] · +80 [24,19,24] · +120 [18,18,18]. No step anywhere: the band continues
    past the player's corner and tails off over the reach. (The top band and the top-right
    corner sit under the fixed header on desktop and cannot be sampled; the bottom-right is
    the same geometry.)
  - **Pure vignette profile, UNIFORM clip (0x8040c0), the colour-independent measurement.**
    Right of the player at mid height: 5 px [44,27,63] · 25 [37,24,51] · 50 [28,21,36] ·
    75 [22,19,25] · 100 [18,18,18]. Below at mid width: 5 [45,27,65] · 25 [38,24,52] · 50
    [30,22,38] · 75 [23,20,27] · 100 [19,18,21]. Peak +26/+9/+45 over the page's
    [18,18,18] (the dominant channel a little above YouTube's ~+25 on a green meadow; the
    same order as v1.312's recorded +50), gone by 100 px = 11% of the width / 18% of the
    height - YouTube's ~11% / ~20%. **Corner diagonal vs the edges at the same outward
    fraction:** 0.1 corner [39,25,53] vs right [42,26,60] / bottom [42,26,59] · 0.25
    [31,22,39] vs [36,24,49] / [36,24,49] · 0.4 [24,20,28] vs [30,22,39] / [30,22,39] ·
    0.6 [19,18,19] vs [24,20,28] / [23,20,28] · 0.8 [18,18,18] vs [19,19,21] / [20,18,21].
    The corner is dimmer than BOTH edges at every fraction (rounded falloff, acceptance
    1); the two edges are symmetric.
  - **Rounded-corner GAP (acceptance 2), uniform clip:** just inside the player's
    bounding box outside its 12 px radius, top-right [40,25,56]; the band 4 px outside
    [39,25,55]; 4 px further [38,24,52]; the other three corners [40,25,55] / [39,25,55]
    / [40,25,56]. Continuous - no notch. testsrc2 clip: gap [67,33,49] · band [65,34,42]
    · out [62,34,39].
  - Screenshots: `ambient-polish-polish.png` (the glow tracks the picture's own colour
    bands - green on the left, purple/yellow on the right - with soft edges) and the 3x
    corner crop `ambient-polish-polish-corner.png` (the rounded corner shows a
    continuous tint).
  - Honest notes: the front layer's computed opacity read mid-fade (0.81 / 0) at the
    sample instant because the clip's ~2.5 s tile cadence had just swapped; the pixels
    are the composite of both layers and are what the eye sees. The synthetic clips'
    saturated primaries make the peak read higher than YouTube's meadow, exactly as in
    v1.312; the ONE knob stays `--ambient-opacity`.
