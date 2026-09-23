---
plan: ambient-glow-polish
harness: v2 · lean
branch: fix/ambient-glow-polish
anchor: spec
status: Shipped v1.313.0
next: Dean's iPhone check on v1.313.0 (ambient ON, dark: the picture stays inline + faux fullscreen; corners + band ends look right; R2 drag page move); if black returns, re-root-cause (never patch the theory). Lock-quality follow-ups = tracker #232
design: Approved 2026-09-23 @cf3e65d3 (Dean: "go" on the plan as presented)
gate: APPROVED r2 @cfa22480 — adversary, qa
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

## Gate

Seats per `.harness/scrutiny.toml` against `git diff --name-only cf3e65d3`: the diff touches
only `public/**`, `test/**` and this doc, so the table's baseline is the floor (adversary
only; no `lib/**`, no `**/*client*` / `**/*token*` path). ESCALATED by the builder to
adversary + qa per Dean's standing "full gate" rule for this repo; the dedicated
security seat is not forced and was not added (QA applies the security brief as a
standing section).

### QA r1 @9ff7e151

Verified (ran, saw): lint:css TOTAL 0; overlay-containment 0 violations; `node --test` on
ambient-glow-engine + watch-chrome-ambient = 33/33 pass, 0 fail on Node 22.23.1 AND
24.20.0. Not run by QA (disclosed): the full suite and the mutation rounds (the plan's
6916/8967 and 18/18 figures are the builder's). Spot-checked against the tree: 64x36
(watch.js:104-105, test:114), lift floor 0.12 (watch.js:193, test:139), CSS reach bound to
JS (test:432-433), PNG-only guard (watch.js:285, lock test:358), image-rendering sweep
(test:459) - all supported.

1. WARNING - comment accuracy - public/js/watch.js:2366-2371 (setupAmbientMode header,
   untouched by the diff): "sampled on an OFF-DOM canvas and painted as CSS gradients on
   two cross-fading divs" describes v1.312 as CURRENT. Scenario: the next tuner reads the
   wiring block, hunts for the gradient stack / `--ag-*` and finds none. Prescription:
   one-line edit to "vignetted onto a tiny bitmap set as the layer's background-image".
   Safe to ship disclosed if Dean prefers to fold it into the release commit.
2. SUGGESTION - test binding - the non-PNG `toDataURL` branch (watch.js:285 ->
   `images[url]='failed'` -> ladder) is bound by a SOURCE-text lock only (test:358), never
   driven. Prescription: a harness with `toDataURL: () => 'data:,'` asserting the sprite
   falls to the poster and a failing poster paints nothing.

Security surface: same-origin image -> off-DOM canvas -> base64 PNG data URL -> inline
`url("...")`. No CSP header exists (grep server.js/lib/public/js empty) so `data:` is not
blocked; base64 cannot escape the quoted url(); every server `artUrl` writer is a relative
path (lib/tv/routes.js:338 etc.) so taint is unreachable, and a taint/encode throw is caught
-> hard-fail -> stop() (tested, test:292). No new server route, no user input into a
command. No shell surface in this diff.

Gate: CHANGES r1 @9ff7e151 — qa


### Adversary r1 @9ff7e151

Instruments (all run by the seat, verbatim): `node --test test/unit/ambient-glow-engine.test.js
test/unit/watch-chrome-ambient.test.js` 33 pass / 0 fail on Node 22.23.1 AND 33/0 on Node
24.20.0; `npm run lint:css` TOTAL 0; `overlay-containment-lint.js --enforce` clean (0).
Mutants ran in a git-archive sandbox of 9ff7e151 (17 JS + 16 CSS, each `diff` non-empty
before crediting); the working tree was never edited. Primary source for the Safari
spellings: WebKit main `Source/WebCore/css/CSSProperties.json` (fetched): `filter` aliases
`-webkit-filter`, `transform` aliases `-webkit-transform`, `mask-image` aliases
`-webkit-mask-image`, `-webkit-backdrop-filter` is its own property, `-webkit-mask` is a
shorthand over `mask-image`, `scale` / `translate` / `rotate` are real properties.

VERIFIED (ran, saw): (2) real shapes through `createAmbientEngine` with fakes - sprite,
poster (no sprite), tv (`mediaId` null + artUrl), audio - all four paint a
`url("data:image/png;base64,...")` on the front layer; a non-PNG `toDataURL` marks the
source failed and falls sprite -> poster with NO re-sample loop (2 draws total across 5
ticks); a null `getContext` hard-fails once. (4) 50 same-tile ticks = 1 draw / 1
getImageData / 1 putImageData / 1 toDataURL / 1 setProperty; a tile change = +1 each.
(3) exhaustive pixel check: 0 pixels with u<=ux, v<=uy below 255; 0 non-zero pixels on the
outermost ring; all four corners 0; mid row + mid column monotone. (7) reduced-motion,
the light belt, the sidebar bleed, the toggle-row belts are re-bound in the PAINT test.
(6) the fake `toDataURL` on a paint with no putImageData throws (`last` undefined) ->
hard-fail -> `front()` null, so J15/J16 die on the front assertion, not the `puts` count -
killed either way. Killed as claimed: J3 ux drift, J4 y-normalisation, J5 floor 0.30,
J6/J7 gamma, J11 null-never-failed, J12 sameSource index, J13 max-not-hypot, J14
pixel-centre, J15/J16 vignette skipped, J17 JPEG, C9 CSS reach drift, C10 background-size,
C11 `filter`, C12 `@supports`-wrapped `#ambient-glow > div { filter }`.

**F1 WARNING - the iOS CSS constraint lock (test/unit/ambient-glow-engine.test.js:411-419)
does not see Safari's own spellings.** The sweep matches `(^|[\s;])<prop>\s*:` on a fixed
list, so every prefixed alias and every non-`transform` transform property slips.
Survivors, each appended to style.css, each 33/33 green: C1 `.ambient-glow {
-webkit-filter: blur(20px); }` · C4 `.watch-player-stage { -webkit-backdrop-filter:
blur(4px); }` (the only spelling Safari < 18 honours) · C7 `.ambient-glow { -webkit-mask:
linear-gradient(#000, transparent); }` · C13 `.ambient-glow { mask-border: url(x.png)
10; }` · C2 `.ambient-glow { scale: 1.1; }` · C8 `.ambient-glow { translate: 0 10px; }` ·
C3 `.ambient-glow { FILTER: blur(20px); }` (CSS property names are case-insensitive) · C16
`@keyframes agspin { to { transform: rotate(1deg); } } .ambient-glow { animation: agspin 1s
infinite; }`. The origin plan (ambient-glow-rebuild, lines 159/191) listed
`-webkit-mask-image` explicitly, so prefixed forms were in the constraint's scope from the
start; the regex cannot match them by construction. Also (b): acceptance 3's "never
`-webkit-canvas()` / `element()` ... (a new lock)" exists JS-side only - C5
`.ambient-glow-layer.is-front { background-image: -webkit-canvas(glow); }`, C15 `...
-moz-element(#media-player)` and C6 `... linear-gradient(red, transparent)` (a gradient
back on a sibling rule) all 33/33 green. Prescription (one sweep, both parts): in the CSS
LOCK loop replace the per-prop regex with a case-insensitive
`/(^|[\s;])(?:-webkit-|-moz-)?(?:filter|backdrop-filter|transform|mask(?:-[a-z-]+)?|mask-border|will-change|mix-blend-mode|scale|translate|rotate|offset-path|animation(?:-name)?)\s*:/i`
over every `stageAndGlowRules()` body, and add
`assert.doesNotMatch(r.body, /-webkit-canvas\(|element\(|gradient\(|image-set\(|cross-fade\(|paint\(/)`
to the same loop; re-run C1-C8, C13, C15, C16 and confirm red.

**F2 WARNING - the vignette's VERTICAL inner rectangle is unbound (watch.js:154, test
:110-136).** Mutant J1 `uy = 1 / (1 + 3 * ry)` and J2 `uy = 1 / (1 + ry)` both 33/33
green; the x-axis twin J3 dies only because the "mid alpha" range assertion at (outX, cy)
happens to move, not because the inner-rect edge is asserted. The GEOMETRY lock binds the
CSS reach to the JS constant (D4), but the constant's USE in the maths is where the peak
lands: with J2 the alpha-255 plateau runs ~1.4 bitmap px (~30 desktop px) past the
player's top/bottom edge before any falloff; with J1 the falloff starts inside the
player. The test's "just inside the corner" probe sits at `cy - iy + 1` = y 7, one pixel
further in than the true edge pixel (y 6), so it never touches the boundary. Measured
plateau on the committed tree: mid row 255 from x=7..56, mid column from y=6..29 (the
player's edge is at 6.19 px / 5.50 px - the `(half - 0.5)` normalisation pushes the
plateau ~0.8 / ~0.5 px outward, which is the design, not a finding). Prescription:
derive the expected plateau bounds from the constants (first index whose centre satisfies
`|c - half| / (half - 0.5) <= 1/(1+2*reach)`) and assert, on BOTH the mid row and the
mid column, 255 at that index and < 255 at the index one further out; re-run J1/J2/J3.

**F3 SUGGESTION - the JS source lock (test :360) is case-sensitive and lists only
`filter|transform`.** J8 `back.style.webkitFilter = 'blur(8px)'` and J10 `back.style.scale
= '1.3'` in `paint()` are 33/33 green. Prescription: `doesNotMatch(ENGINE_SRC +
WIRING_SRC, /filter|transform|(?:^|[^a-z])(?:scale|translate|rotate)\b/i)` plus a separate
case-sensitive `/-webkit-canvas|element\(/` (a `/i` there would trip on
`document.createElement(`).

**F4 SUGGESTION (suspicion, inherent to name-based locks) - C14 `#player-slot ~
div[aria-hidden] { filter: blur(20px); }` reaches the glow without naming it and is 33/33
green;** the v1.312 gate already recorded this as inherent (rebuild plan line 433). The
Step 4 desktop probe's computed-style check is the behavioural net but is a one-off, not
a test. No prescription required this round.

Surface 5 (data URL size): no primary source located for any Safari length limit that a
5.7 KB `background-image` data URL could approach; the per-paint cost is one tiny PNG
decode on a 2-10 s cadence. Suspicion, unmeasured: WebKit's memory cache keys decoded
images by URL, so a long session accrues one small entry per distinct tile until pressure
eviction - not a finding. J18 (`>` -> `>=` at the inner edge) survived but is equivalent
at these floats (no pixel centre lands exactly on `ux`/`uy`).

Tree: the only write is this section; `git status --short` shows only this file.

Gate: CHANGES r1 @9ff7e151 — adversary

### Gate r1 findings -> the r2 fix (@9ff7e151 -> c5e5ff03 + 11b1644e)
- Adversary F1 (WARNING, the iOS CSS constraint lock blind to Safari's spellings): the
  sweep is now ONE case-insensitive regex over every rule naming `ambient-glow` or
  `watch-player-stage` covering the `-webkit-`/`-moz-`/`-ms-` prefixes, every
  `mask*`/`transform*`/`animation*`/`offset*` property, `scale`/`translate`/
  `rotate`, `perspective`, `contain`, `isolation`; a second regex forbids any paint
  function in those rule bodies (`-webkit-canvas(`, `element(`, `gradient(`,
  `image-set(`, `cross-fade(`, `paint(`, `url(`) - the sheet never paints the glow,
  only the engine's inline PNG does; and no `@keyframes` names the glow/stage.
  Re-run at c5e5ff03: C1 -webkit-filter, C2 scale, C3 FILTER:, C4 -webkit-backdrop-filter,
  C5 -webkit-canvas(), C6 a sibling gradient, C7 -webkit-mask, C8 translate, C13
  mask-border, C15 -moz-element(), C16 @keyframes+animation - **11/11 killed**.
- Adversary F2 (WARNING, the vertical plateau unbound): the vignette test derives the
  plateau EDGE pixel from the constants on BOTH axes (the last pixel whose centre,
  normalised to the outermost pixel, is inside `1/(1+2*reach)`), asserts 255 at that
  pixel on all four sides and at the player's own corner pixels, and <255 one pixel
  further out on each side. Re-run: J1 `uy = 1/(1+3ry)`, J2 `uy = 1/(1+ry)`, J3
  `ux = 1/(1+3rx)` - **3/3 killed**.
- Adversary F3 (SUGGESTION, the JS lock case-sensitive): now case-insensitive, guarded on
  a word start OR a vendor camelCase prefix (`webkit|moz|ms`), covering filter /
  transform / backdrop / will-change / scale / translate / rotate / offset-path /
  animation; a separate string-scoped lock forbids `-webkit-canvas`, `-moz-element`
  and any quoted `element(` / `image-set(` / `cross-fade(` / `paint(`. First cut
  tripped on the wiring's own `attributeFilter:` and the engine's own `paint()` -
  hence the word-start guard and the string scoping. Re-run: J8 `style.webkitFilter`
  (11b1644e), J8b `style.WebkitTransform`, J10 `style.scale` - **3/3 killed**.
- Adversary F4 (suspicion, inherent): a rule reaching the glow without naming it
  (`#player-slot ~ div[aria-hidden]`) - accepted as inherent to name-based locks, as
  the v1.312 gate recorded; not chased.
- QA-1 (WARNING, stale wiring comment): the `setupAmbientMode` header now describes the
  bitmap + background-image pipeline.
- QA-2 (SUGGESTION, the non-PNG branch source-locked only): a driven test - the fake
  `toDataURL` returns WebKit's `data:,`; the sprite falls to the poster, nothing is
  ever painted, no hard-fail, no re-sample loop, the clock stays armed. Re-run: the
  guard removed -> 2 tests red.
- Round totals across r1 + the fix: 18 (builder) + 33 (adversary) + 18 (fix re-runs)
  mutants; every non-equivalent mutant killed at 11b1644e. Ambient files 34/34 on Node
  22.23.1. lint:css 0.

### QA r2 @cfa22480 (delta)

Verified: ambient-glow-engine + watch-chrome-ambient = 34/34 pass, 0 fail on Node 22.23.1
AND 24.20.0; lint:css TOTAL 0; overlay-containment 0 violations; no em dash in the delta.
QA-1: FIXED as prescribed (watch.js:2368-2370 now reads as the code is). QA-2: FIXED as
prescribed and REACHED - in a git-archive sandbox, `return url;` in place of the PNG guard
reds `gate QA-2` (behavioural) AND the SOURCE LOCK, 20/22. Adversary F2 (plateau edge on
both axes) re-derived: px=56 / py=29 for 64x36 at 0.12/0.22, strictly inside the ring, both
axes asserted 255 at the edge and <255 one out. F1/F3 locks read over comment-stripped
sources (stripComments / glowRules), so prose cannot false-trip them.

1. WARNING (safe to ship disclosed) - test binding - ambient-glow-engine.test.js:446: the
   new `@keyframes[^{]*\{[^}]*(?:ambient|stage)` assertion does NOT bind a keyframes NAME
   (measured: `@keyframes ambient-pulse { from {opacity:0} }` passes it; `@keyframes foo {
   from { color: stage } }` fails it) - its message "no keyframes named for the glow/stage"
   overstates it. The real guard is FORBIDDEN_PROP's `animation*` on the named rule bodies
   (mutant C16 was killed by that, not by this line). Prescription:
   `/@keyframes\s+[\w-]*(?:ambient|stage)/i`, or drop the line.
2. SUGGESTION - test brittleness - ambient-glow-engine.test.js:381: the JS lock's bare
   `webkit|moz|ms` alternative is unanchored, so an ordinary identifier ending in "ms"
   (`itemsFilter`, `roomsScale`) would falsely fail the lock later. Measured alternative
   `(?:^|[^a-z])(?:webkit|moz|ms)?(?:filter|...)\b/i` still catches `style.webkitFilter`,
   `s.WebkitTransform`, `style.scale` and clears `itemsFilter` / `attributeFilter`.
3. SUGGESTION - comment accuracy - ambient-glow-engine.test.js:436-441: FORBIDDEN_PROP
   also forbids `contain` / `isolation` / `perspective` on the stage/glow rules (a good
   lock: both create a containing block that would re-trap the faux-fullscreen overlay,
   the v1.166 class) but the comment above it and the assertion message name only
   filter/transform/mask/will-change/animation - write the reason down.

Gate: APPROVED r2 @cfa22480 — qa

### Adversary r2 @cfa22480 (delta)

Instruments (run by the seat, fresh git-archive sandbox of cfa22480): the two ambient
files 34 pass / 0 fail on Node 22.23.1 AND 34 / 0 on Node 24.20.0. Every mutant below
`diff`ed non-empty before crediting; the working tree was never edited.

**r1 findings against the fix (my own mutants re-run, counts verbatim):**
- F1 (CSS constraint lock) - FIXED as prescribed and wider. C1 -webkit-filter, C2 scale,
  C3 FILTER:, C4 -webkit-backdrop-filter, C5 -webkit-canvas(), C6 sibling gradient, C7
  -webkit-mask, C8 translate, C13 mask-border, C15 -moz-element(), C16 @keyframes +
  animation: **11/11 killed** (each 33 pass / 1 fail, the CSS LOCK test).
- F2 (vertical plateau) - FIXED as prescribed. J1 `uy = 1/(1+3ry)`, J2 `uy = 1/(1+ry)`,
  J3 `ux = 1/(1+3rx)`: **3/3 killed** (the ambientVignette test). The derived edges
  (x 56 / y 29) match the plateau I measured exhaustively in r1.
- F3 (JS lock) - FIXED differently (word-start-or-vendor guard, string-scoped paint
  lock); evaluated below. J8 `style.webkitFilter`, J8b `style.WebkitTransform`, J10
  `style.scale`: **3/3 killed** (the SOURCE LOCK test).
- F4 - unchanged, inherent, accepted.
- QA-2 driven non-PNG test: the driver reaches the state (my own r1 driver (e) produced
  the same trace - sprite then poster, 2 draws, nothing painted, no hard-fail); the
  `draws.length === 2` assertion is what kills the r1 J11 loop mutant. Nothing new
  introduced by QA-1/QA-2.

**New slips against the widened locks (12 tried): 5 killed** - N7 `animation-name` +
`animation-duration` longhands with an unnamed keyframes, N8 `background: url()` back on
the layer, N11 `-webkit-mask-image: var(--glowmask)`, N12 `-webkit-transform` inside an
`@media` block, V1 `@keyframes ambient-glow-spin { to { transform } }` alone. **7
survived**, none a production defect at cfa22480:

**R2-1 SUGGESTION - the JS lock omits `mask` and `mix-blend-mode`, which the CSS lock
carries** (test :381). N1 `back.style.webkitMaskImage = 'linear-gradient(black,
transparent)'`, N3 `back.style.setProperty('-webkit-mask-image', 'radial-gradient(...)')`
and N2 `back.style.mixBlendMode = 'screen'` in `paint()` are 34/34 green. Mask is one of
the three named iOS suspects. Prescription: add `mask|mix-?blend` to the JS keyword
alternation (and `gradient\(` to the string-scoped paint regex).

**R2-2 SUGGESTION - the JS lock has FALSE POSITIVES that will misfire on legitimate
code** (test :381; also refutes my own r1 prescription, which shared the first flaw):
FP1 `var _fp = [1, 2].filter(Boolean);` in the wiring and FP1b in the engine - an
`Array.prototype.filter` call - both 33/1 RED; FP8 a trailing inline comment `var timerId
= null; // no transform here` - RED, because `stripComments` strips only whole-line `//`
comments. Prescription: scope the keyword lock to style writes (`style\.`,
`setProperty\(`, `cssText`, `animate\(`) rather than the whole source, and strip trailing
`//` comments outside string literals before locking. Verified NO false positive on
`-webkit-overflow-scrolling: touch` (FP3), `transition: opacity 1s` /
`transition-property` (FP4), `text-transform` (FP7); a no-space first declaration
`.ambient-glow{filter:blur(2px)}` is correctly caught (FP2).

**R2-3 SUGGESTION - the `@keyframes` assertion (test :446) does not bind what its message
says.** `/@keyframes[^{]*\{[^}]*(?:ambient|stage)/i` consumes the NAME with `[^{]*`
before `\{`, so it inspects the first keyframe step's body, not the name: FP6
`@keyframes stage-pulse { to { opacity: 1; } }` is 34/34 green, while V2 `@keyframes
unrelated { from { color: var(--stage-x); } }` is blocked. V1 (a glow-named keyframes)
died only because the rule sweep happens to capture the `@keyframes ambient-glow-spin`
header as a "selector". Redundant with the `animation*` ban on every glow/stage rule
anyway. Prescription: `/@keyframes\s+[^\s{]*(?:ambient|stage)/i`, or drop it.

**R2-4 SUGGESTION (scope, disclosed) - the widened CSS lock now exceeds the stated
constraint:** `contain`, `isolation`, `perspective` and any `gradient(` / `url(` are
forbidden on the STAGE too (FP5 `.watch-player-stage { contain: layout; }` is RED). Not a
defect - a future legitimate stage backdrop or containment hint will have to be argued
past this lock; the reason is now written in the test comment as QA asked.

Inherent (F4 class, not chased): N4 `[id^="ambient"] { filter }`, N5 `.ambient-glow {
fil\ter: blur(20px); }` (a CSS ident escape). Outside the stated constraint (suspicion
only, no primary source that it breaks iOS video): N6 `clip-path` on the glow, N10
`style.clipPath`. Legitimate by the constraint: N9 `back.animate([{ opacity }])`.

All four r2 items are lock-quality suggestions with no runtime effect at cfa22480; none
blocks. If the builder takes any of them, the tree moves and this approval is void -
re-engage for r3 (gate pacing: at round 3, ask Dean).

Tree: the only write is this section; `git status --short` shows only this file.

Gate: APPROVED r2 @cfa22480 — adversary

Gate r2 close: both seats APPROVED @cfa22480. Dual-Node full suites at that sha: Node
22.23.1 **8968 tests, 8968 pass, 0 fail (exit 0)**; Node 24.20.0 **8968 / 8968 / 0 (exit
0)**. Sequential, after the seats finished. DISCLOSED r2 suggestions (lock quality, no
runtime effect at cfa22480; taking any voids the bound approval -> round 3, and the
pacing norm says ask Dean at round 3): the `@keyframes` assertion binds a step body, not
the name (redundant with the `animation*` ban that really guards); the JS lock's bare
`ms` prefix and unscoped keyword can false-trip a future `Array.prototype.filter` call
or a trailing `// no transform` comment in the ambient code; the JS lock omits
`mask`/`mix-blend-mode` that the CSS lock carries; `contain`/`isolation`/
`perspective`/`url(` are forbidden on the STAGE rules too (a good containing-block
guard, but undocumented in the test's comment).
