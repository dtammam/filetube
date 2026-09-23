---
plan: ambient-glow-polish
harness: v2 · lean
branch: fix/ambient-glow-polish
anchor: spec
status: Building
next: Step 1-3 build (engine bitmap + vignette, CSS, tests), then the desktop probe sampling band ENDS + corners, then the gate
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

(filled as steps land)
