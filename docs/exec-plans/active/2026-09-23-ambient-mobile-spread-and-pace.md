---
plan: ambient-mobile-spread-and-pace
harness: v2 · lean
branch: fix/ambient-mobile-spread-and-pace
anchor: spec
status: Gate:APPROVED r2 @383f24ce
next: dual-Node full suites on the tip, then release v1.315.0 per docs/RELEASING.md
design: Approved 2026-09-23 @92d48874 (the Architect brief carrying Dean's ask, against the v1.313.0 base; both diagnoses measured before any edit)
gate: APPROVED r2 @383f24ce — adversary, qa
---

# Ambient glow on mobile - spread to the screen edge, drift instead of churn

## The request (restated)

Dean, 2026-09-23, two iPhone screenshots of the watch page (dark, ambient ON, video
playing inline, v1.313.0): "Look at left and right of ambient on mobile. Make it
spread. Also ambient changes too much and is slow. It's not great." The v1.313.0
falsifier did NOT fire (the picture stays), so the bitmap `background-image` approach
is safe and is kept. What he sees: a soft band above and below the player, essentially
nothing to the left/right; and the glow's colour visibly churns on every storyboard
tile change with a slow crossfade.

Constraints carried (v1.312 R0, his iPhone went black before): never read the `<video>`
for pixels; no filter / transform / mask / backdrop-filter / will-change /
mix-blend-mode / animation / contain / isolation / perspective on any rule reaching
`.ambient-glow*` or `.watch-player-stage`, in any vendor spelling; the glow paints only
via the engine's inline PNG data URL; no requestAnimationFrame residency; never
reintroduce the iOS sideways page scroll (v1.194.3); the faux-fullscreen overlay
(`#player-wrapper.css-fullscreen`, position:fixed) must still escape the stage. Every
one of these is a lock in `test/unit/ambient-glow-engine.test.js`; none was weakened.

## Diagnosis 1 - horizontal spread

- **Hypothesis:** the v1.194.3 mobile `.watch-player-stage { overflow-x: clip }` clips
  the glow's negative x insets at the stage box, and on a phone the stage box IS the
  player box, so the side reach (12% of the player width) is clipped to nothing.
- **Falsifier:** remove the clip on a phone-width probe; if the side glow still does not
  appear, the reach/vignette is the cause, not the clip.
- **Evidence (headless Chromium 390x844, `mobile: true`, dark, `ft-ambient=1`, playing,
  a VP9 testsrc2 clip with a hue drift + a real sprite built with `lib/storyboard`'s own
  ffmpeg args; script `ambient-phone-probe.js` + JSON + PNGs in the session scratchpad):**
  - As shipped: `.main-content` pads 16px; the stage rect is x 16, w 358 - exactly the
    player's box (x 16, w 358, h 202.25, radius 12px); computed `overflow-x: clip`; the
    glow rect is x -27.0, w 443.9 (left -42.95px = 12% of 358). Gutter pixels at 2 / 5 /
    8 / 11 / 14px left AND right of the player: `[18,18,18]` every one = the page.
    Above: 5px `[39,39,24]`, 15px `[32,30,29]` (then the fixed header). Below: 5px
    `[42,39,39]` · 15 `[33,30,30]` · 25 `[25,24,24]` · 35 `[20,20,20]` · 45 `[18,18,18]`.
    **Zero side glow; the vertical bands show. Dean's screenshot, reproduced.**
  - Falsifier run (`.watch-player-stage { overflow-x: visible !important }` injected):
    left gutter 2px `[47,27,14]` · 5 `[42,27,15]` · 8 `[35,31,15]` · 11 `[32,30,15]` ·
    14 `[30,29,16]`; right gutter 2px `[38,28,72]` · 14 `[30,24,51]`; beside the
    corners `[31,37,15]` / `[30,36,15]`. **The side glow appears - the clip is the
    cause. AND `document.documentElement.scrollWidth` grows 390 -> 417:** the glow's
    box overflows the viewport, the v1.194.3 sideways scroll is back. So the clip cannot
    simply go; its EDGE has to move from the player's edge to the viewport's edge.
- **Root cause:** the clip box and the glow's containing block were the same element
  whose box equals the player's box on mobile. The side reach (43px) had 0px of room.

## Diagnosis 2 - pace / churn

- **Hypothesis:** the engine ticks on a 1s clock and repaints on every storyboard tile
  change; each repaint is a WHOLE new vignetted picture cross-faded in over 1.2s
  linear, so on a real clip the colour field visibly morphs every few seconds.
- **Falsifier:** if the tile cadence were long (tens of seconds) and each tile nearly
  identical, the churn could not come from the tile change; measure the real cadence and
  the pixel variation.
- **Evidence:** `lib/storyboard.planStoryboard`: interval = d/40 clamped to [2, 10]s,
  then re-derived from the 100-frame cap - measured 30s clip 1.88s · 60s 1.94s · 2min
  2.93s · 5min 7.32s · 10min 9.84s · 15min 9.89s · 20min 12.0s · 60min 36.0s. So a
  typical 5-15 min clip swaps a whole new picture every 7-10s (six morphs a minute),
  a short clip every 2s. Probe (24s, the hue-drifting clip, its 1.88s tiles quantised to
  the 1s clock): **16 layer swaps in 24s (gaps 2.0s), a pixel 12px below the player
  stepped >= 3/255 13 times, max single step 13/255, total variation 113** - one
  cross-fade per tile, each a full-amplitude picture change. The hypothesis stands.
- **Root cause:** no temporal smoothing and no change threshold - every tile is painted
  whole; and the fade (1.2s) is short enough that each morph reads as motion.

## Decision register (spec anchor)

| ID | Decision | Choice | Why |
|----|----------|--------|-----|
| D1 | Mobile clip box | On `max-width: 768px` the stage grows by the page gutter on each side (`margin-left/right: calc(-1 * var(--ambient-gutter))`, `padding-left/right: var(--ambient-gutter)`, `--ambient-gutter: var(--space-8)` = `.main-content`'s mobile padding token) and keeps `overflow-x: clip`. The clip edge is now the viewport edge. | The gutter is the only room a phone has left/right of the player; margin + padding create no containing block (the fixed overlay still escapes - probed) and no new overflow (scrollWidth stays 390 - probed). |
| D2 | Glow insets on mobile | `.ambient-glow { left/right: calc(var(--ambient-gutter) - (100% - 2 * var(--ambient-gutter)) * 0.12) }` - the containing block is now the padding box, one gutter wider than the player each side, so the x insets are re-anchored on the player. `top/bottom` untouched (the padding is horizontal, the height is still the player's). | The glow's box is byte-identical to before (x -27.0, w 443.9 at 390px; the test derives it); only what CLIPS it changed. The 0.12 literal is test-bound to `AMBIENT_REACH_X`. |
| D3 | Reach on mobile | Unchanged (12% / 22%). The 43px side reach exceeds the 16px gutter, so the gutter is lit all the way to the screen edge (alpha ~0.5 at the edge, times the 0.3 opacity). | A reach shrunk to fit the gutter would fade to nothing AT the screen edge - a dimmer sliver, the opposite of "spread". The cut at the viewport edge is the physical screen edge, invisible. |
| D4 | Pace: smoothing | The engine keeps a running RGB field (pre-lift, Float32, 64x36x3). A new tile is blended in with weight `1 - exp(-dt / tau)`, `dt` = MEDIA seconds since the last integrated tile, `AMBIENT_SMOOTH_TAU_S = 15`: a 2s cadence moves ~12% per tile, 10s ~49%, 36s ~91%; a seek a minute away snaps (0.98). A RUNG change (sprite -> poster) snaps (weight 1). | The drift per second of media is the same on every clip regardless of sprite density; long-tile clips are not made lazier than they already are; a seek still lands. |
| D5 | Pace: threshold | `AMBIENT_MIN_DELTA = 4`: a step whose mean change per channel (0-255, pre-lift) is under 4 is ABSORBED into the field - the tile is marked (never re-sampled) but no vignette/encode/swap happens. The next tile keeps integrating; a paint fires when the field has drifted >= 4 from what is shown. | A static scene never churns; a slow drift is painted in a few larger, slower steps instead of many tiny cross-fades (the always-transitioning layer pair was also a battery cost). |
| D6 | Pace: fade + gap | `--ambient-fade: 2.4s` (was 1.2s) = `AMBIENT_FADE_MS`, test-bound; the engine never paints within `fadeMs` of the previous paint (the back layer is the one still fading out); a deferred tile is re-checked on the next 1s clock and paints the tile of NOW. | A layer repainted mid-fade pops at its residual opacity; with a 2s tile cadence and a 2.4s fade that happened every tile. The gap makes "one swap = one complete cross-fade" a guarantee. |
| D7 | Knobs | `AMBIENT_SMOOTH_TAU_S` (lazier = larger), `AMBIENT_MIN_DELTA`, `--ambient-fade`/`AMBIENT_FADE_MS`; `--ambient-opacity` unchanged. | Dean's phone judges the pace; these are the three numbers to move. |
| D8 | Not done | No spatial blur, no reach change, no `.main-content`-level clip (every view shares that element), no player shrink on mobile. | Blast radius: the stage + glow rules and the engine only. |

## Acceptance (measurable)

1. **Phone probe, spread (Diagnosis 1's instrument, re-run on the fix):** the stage rect
   is x 0, w 390 (the viewport) with the player still at x 16, w 358; the glow rect is
   unchanged (x -27.0, w 443.9); gutter pixels left and right carry the tint at every
   distance out to 14px; `scrollWidth` stays 390; the faux-fullscreen check still paints
   the viewport edge from the fixed overlay. Test: `v1.314 CSS MOBILE SPREAD` (the
   margin/padding/clip/gutter-token/insets locks + the derived-geometry identity), and
   the v1.194.3 lock in `watch-chrome-ambient.test.js` stays green.
2. **Phone probe, pace:** fewer layer swaps and smaller pixel steps over the same 24s on
   the same clip than the "before" numbers above. Tests: `v1.312 engine: a tile change
   ...` (rewritten: deferred inside the fade, blended by `ambientSmoothing`, a
   sub-threshold step absorbed with the tile marked, the accumulated drift painted),
   `v1.314 pure: ambientSmoothing / ambientBlend / ambientMeanDelta`, `v1.314 engine:
   a RUNG change ... SNAPS`, `v1.314 engine: the fade gap is bound to the CSS
   cross-fade ...`.
3. Every existing constraint lock green: the CSS constraint sweep (now also over the
   mobile stage/glow rules - `stageAndGlowRules()` reads the whole sheet), the JS source
   lock (extended: the blend/threshold/gap lines are in the engine's real path; wall time
   only through the injected `now()`), the vignette maths, the video-never-drawn
   constraint, no rAF.
4. `npm run lint:css` at ZERO, `npm run lint:overlay` at zero; full `npm test` on Node
   22.23.1 green (critter-mode "gate W closure" is a known CPU-load flake - re-run alone
   if it is the only red).
5. **Dean's iPhone (the only proof for the look):** in PORTRAIT (<= 768px wide) the
   gutter left and right of the player is lit to the screen edge with ambient ON and the
   page does not scroll sideways; rotate-to-fullscreen still covers the chrome; the glow
   drifts instead of morphing; the picture stays. LANDSCAPE on an iPhone (844px) is ABOVE
   the 768px breakpoint: none of this diff's mobile rules apply there, it is the desktop
   path unchanged from v1.313, and it still scrolls sideways with ambient ON - measured
   IDENTICAL at the base sha (gate r1 adversary W1, qa S3), so a landscape observation is
   not a regression of this change. Disclosed: tracker #234 (Dean's call: widen the
   breakpoint for the phone-landscape case, or keep the v1.188 wide bleed).

## Design

CSS (`public/css/style.css`, the mobile block right after the stage base rule): D1 + D2
as written above, comment carries the measurement. `--ambient-fade` 1.2s -> 2.4s.

Engine (`public/js/watch.js`): three pure exported helpers - `ambientSmoothing(dt, tau)`,
`ambientBlend(acc, data, k, n)` (in place), `ambientMeanDelta(a, b)` - and inside
`createAmbientEngine`: state `acc` / `shown` / `lastT` / `lastPaintAt`; injectable
`now`, `fadeMs`, `smoothTauS`, `minDelta` (defaults = the constants); `sample()` draws
the tile, blends it into `acc` (weight from the media-time delta, 1 on a rung change),
returns `{ skip: true }` under the threshold, else writes `acc` into the bitmap,
vignettes, encodes and returns `{ url }` (null = failed source, as before); `check()`
returns early inside the fade gap (nothing marked, the clock re-checks), marks an
absorbed tile without a swap; `paint()` records `lastPaintAt`.

Tests (`test/unit/ambient-glow-engine.test.js`): the harness gains an injected wall
clock (`tick()` advances 1s, as the real clock does), a `centre()` reader of the last
bitmap's under-player pixel (= the lifted field), higher tile contrast (so the fake tiles
straddle the threshold), and `pastFade()`; `glowRules()` / `stageAndGlowRules()` tag
each rule `mobile` by brace-balanced `@media (max-width: 768px)` ranges (the base glow
rule is no longer the first `.ambient-glow` match).

### Steps
- Step 1: measure (both probes) before any edit. Done - the numbers above.
- Step 2: CSS (D1, D2, D6's fade) + engine (D4-D6) + tests. Demo: the two ambient files
  green, lint:css 0, overlay 0.
- Step 3: the after-probe; numbers here.
- Step 4: full `npm test` on Node 22.23.1; this record; hand to the gate.

## Build record

- **Step 1 (measure first, no edits):** the two "before" probes above (`ambient-phone-before.json`,
  `ambient-phone-nofix.json`, the PNGs `ambient-phone-before.png` / `-leftedge.png` - the
  left-edge crop shows a flat page strip beside the player with glow only above/below) and
  the storyboard cadence table (`sb-intervals.js`). All in the session scratchpad
  `/tmp/claude-1000/-home-coder-projects-filetube/fc45e02d-3e91-4a7d-b3f4-0563cd0a0db4/scratchpad/`.
- **Commit 7745f7e4 (Steps 2 + 3):** `style.css` - the mobile stage rule grows by the
  gutter (D1), a mobile `.ambient-glow` x-inset override AFTER the base rule (D2),
  `--ambient-fade` 2.4s (D6), comments carry the measurements. `watch.js` -
  `AMBIENT_FADE_MS` / `AMBIENT_SMOOTH_TAU_S` / `AMBIENT_MIN_DELTA`, the pure
  `ambientSmoothing` / `ambientBlend` / `ambientMeanDelta`, the engine's running field,
  threshold and fade gap (D4-D6), injectable `now` / `fadeMs` / `smoothTauS` / `minDelta`;
  exports. `ambient-glow-engine.test.js` - as described under Design; 38/38 across the
  two ambient files on Node 22.23.1 (was 34). The pre-commit hook: eslint clean, token
  ratchet 0, unit suite **6921 tests, 6921 pass, 0 fail**. `npm run lint:css` TOTAL 0;
  `npm run lint:overlay` 0 violations.
  - **The probe caught my own first cut (the inert-sibling class):** the mobile
    `.ambient-glow` override was first placed inside the stage's media block, which
    sits BEFORE the base `.ambient-glow` rule; same specificity, so the base insets won
    and the glow measured x -46.8 / w 483.6 (-12% of the VIEWPORT) - the gutter was lit
    (bright, alpha-255 plateau overshooting the player by 16px) but the vignette was off
    the player. Moved after the base rule; the test now binds the source order
    (`glowM.index > glowBase.index`) as well as the declarations.
  - **After-probe @7745f7e4 (`ambient-phone-after2.json`, same clip, same viewport):**
    stage rect x 0, w 390, `padding 0 16px`, `margin 0 -16px`, computed `overflow-x:
    clip` / `overflow-y: visible`, `filter/transform none`, `contain none`; player still
    x 16, w 358; **glow rect x -27.0, w 443.9, y 27.5, h 291.2 - identical to before**
    (computed `left -26.95px`); `scrollWidth 390` (= the viewport; the nofix run was
    417); zero page errors. **Left gutter** 2px `[66,16,14]` · 5 `[61,17,14]` · 8
    `[54,18,15]` · 11 `[49,18,15]` · 14 `[45,18,16]`; **right gutter** 2px `[42,37,56]`
    · 5 `[42,31,50]` · 8 `[41,29,45]` · 11 `[40,26,40]` · 14 `[38,25,36]`; beside the
    corners `[51,22,15]` / `[51,22,15]`; far page `[18,18,18]`. Above/below unchanged
    in shape (5px `[35,35,38]` / `[37,36,40]`, gone by 45px). The gutter is lit to the
    screen edge with the same colour family as the adjacent picture edge (blue-ish on
    the right, red on the left - the hue-drift clip); the left-edge crop
    `ambient-phone-after2-leftedge.png` shows it continuous with the top/bottom bloom.
    **Faux fullscreen:** with `body.ft-css-fullscreen` + `#player-wrapper.css-fullscreen`
    the wrapper is `position: fixed`, rect 0,0 390x844, and the viewport's left edge at
    mid height paints the overlay's black (`[0,0,0]`) - the stage's new margin/padding
    made no containing block.
  - **Pace, 24s windows on the same hue-drifting clip (1.88s tiles):** BEFORE 16 layer
    swaps (gaps 2.0s), 13 pixel steps >= 3/255, max step 13, total variation 113, fade
    1.2s. AFTER (run 1, the inert-cascade build - the engine was already final) 11 swaps
    (gaps 3.0s = the 2.4s fade quantised to the 1s clock), **0 steps >= 3, max step 2,
    total variation 59**; AFTER (run 2 @7745f7e4) 10 swaps, 1 step >= 3 (a single 14 at
    23.5s into the window = media ~29-30s, where the 30s clip ends and restarts at tile
    0: dt ~29s gives weight 0.85 - the designed snap for a far jump), total variation 68.
    So on a clip whose every tile is a maximal colour change, each visible step fell
    from ~13/255 to <= 2/255 and the swap count by a third; on a static or slowly
    changing scene the threshold makes the swap count zero (unit-driven).
  - `check-markers.sh` on this doc: one flag, "stale approval @92d48874 - reviewed code
    changed since; re-gate" on the `design:` line - inherent while Building (the design
    sha is the branch base, and the build changed code by construction; the shipped
    ambient-glow-polish plan carried the identical shape at `@cf3e65d3` during its build).
    It clears when the gate binds its own `APPROVED @<sha>`.
  - **Step 4, full `npm test` @7745f7e4 on Node 22.23.1 (one run):** **8972 tests, 8969
    pass, 0 fail, 3 skipped, exit 0** (338s). critter-mode "gate W closure" did not
    flake. Node 24.20.0 not run here (the gate / release ceremony runs dual-Node).
  - **Honest notes:** the probe's pixel series is ONE pixel 12px below the player,
    sampled every 250ms, under the 0.3 opacity - a churn proxy, not a perceptual score.
    The synthetic clip rotates hue 36 deg/s, far harsher than any real video; real
    5-15 min clips swap every 7-10s with ~40-49% steps under D4 - Dean's phone is the
    judge of the pace knobs (D7). The front layer's computed opacity in the state read
    is mid-fade (0.19-0.20), as expected with a 2.4s fade.

## Gate r1 -> r2 fix record (2026-09-23)

r1 @5589ffbe: adversary APPROVED (43 mutants, headless probe re-run, one PRE-EXISTING landscape
warning disclosed); qa CHANGES (W1 + S1-S3). One fix commit (the r2 sha in the Gate lines below):
- qa W1: `await pastFade(h)` before the poster re-sample assertion, so the v1.312 "a static poster
  is never re-sampled" claim is bound by the poster's fixed index again, not by the fade deferral.
- qa S1: `check()` clamps `lastPaintAt` to `now()` (a backward wall step no longer defers paints
  for the step's length); locked by a source assertion.
- adversary S2: the source lock now requires exactly ONE `Date.now()`, sitting in the `now` default.
- qa S2: the v1.194.3 CSS comment states the real reason `clip` is required (overflow-x: hidden
  would force overflow-y to auto), not a containing-block claim.
- qa S3 + adversary W1: acceptance 5 and the device list now say landscape is the desktop path
  (> 768px), unchanged and still scrolling sideways at both shas -> tracker #234.
- Not taken: adversary S3 (float boundaries, measure-zero), adversary suspicion (image-load
  paint at fadeMs + epsilon, no visible pop constructed).

**Architect's disclosure (2026-09-23):** while applying the r2 fixes I ran `git checkout -- .` in
this worktree to re-run an edit script and it discarded the two seats' UNCOMMITTED r1 verdict
sections (`## Gate r1 - qa @5589ffbe`, `Gate: CHANGES r1 @5589ffbe — qa`; `## Gate r1 - adversary
@5589ffbe`, `Gate: APPROVED r1 @5589ffbe — adversary`) from this doc. Both reports reached me
verbatim through the seats' hand-backs (the fix record above is built from them); at r2 each seat
re-appends its own r1 section from its own context, then its r2 verdict. Lesson: never revert
the tree while a seat's verdict is uncommitted - commit the verdicts FIRST.

## Gate r1 - adversary @5589ffbe

Measured (Node 22.23.1 and 24.20.0, the two ambient files: 38 tests, 38 pass, 0 fail on both; `lint:css` TOTAL 0; `lint:overlay` 0 violations; 43 mutants in a `git archive 5589ffbe` sandbox: 42 killed, 1 equivalent; the phone probe re-run at 390x844 reproduces every builder number - stage x0/w390, computed `overflow-x: clip` / `overflow-y: visible`, glow rect x -26.95 w 443.9 unchanged, gutter lit both sides to 14px, scrollWidth 390, fixed overlay escapes; a UNIFORM clip gives 1 swap and total variation 0; the REAL 3600s `planStoryboard` geometry (36s tiles) paints on every tile, a far seek snaps, a pause never samples, a 300s hidden-tab catch-up snaps, a restart at 0 paints after the fade gap, two changes inside one fade paint the tile of NOW, a 3/255-per-tile drift paints at t=180 and t=324; blend+meanDelta cost 37 us per sample).

- **WARNING (pre-existing, safe to ship DISCLOSED):** phone LANDSCAPE still scrolls sideways. Probe at 844x390 (`mobile: true`, ambient ON, playing): `scrollWidth 888 > innerWidth 844`, stage `overflow-x: visible` - the clip lives at `max-width: 768px` and an iPhone landscape viewport is 844px. Identical on the BASE sha 92d48874 (888/844), so this diff neither causes nor fixes it; but Acceptance 5 promises "portrait and landscape ... the page does not scroll sideways", which the tree does not deliver at either sha. Disclose (tracker) or extend the breakpoint; Dean's call since the wide layout's bleed is the intended v1.188 shape.
- **SUGGESTION:** the JS source lock `doesNotMatch(/new Date|performance\.now/)` does not match `Date.now(`, so a direct `Date.now()` in `check()` passes the SOURCE lock (mutants E5/E5b were killed only by the behavioural tests). Tighten to "exactly one `Date.now()` and it sits in the `now` default".
- **SUGGESTION:** the `<` vs `<=` boundaries on the threshold and the fade gap (E12/E13) are held only by the source-lock regexes, not by a behavioural assertion. Acceptable (measure-zero on floats); noted.
- **Suspicion, not a finding:** `check()` also runs from the image-load promise (off the 1s clock), so a paint can land at `fadeMs + epsilon` while the back layer's CSS transition has up to one frame's residual opacity (<= ~0.7% of 0.3). Only on a rung change to a freshly loaded URL; no visible pop constructed.

Gate: APPROVED r1 @5589ffbe — adversary

## Gate r1 - qa @5589ffbe

(Re-appended verbatim at r2 from the seat's own context after the Architect's `git checkout -- .` discarded the uncommitted original; see the disclosure above.)

Instruments (Node 22.23.1, run in the worktree; full `npm test` NOT run per the brief -
the adversary shares the worktree; Node 24 not run):
- `npm run lint:css`: `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`.
- `npm run lint:overlay`: `overlay-containment: clean (0 violations)`.
- `npx eslint public/js/watch.js test/unit/ambient-glow-engine.test.js`: exit 0, no output.
- `node --test test/unit/ambient-glow-engine.test.js test/unit/watch-chrome-ambient.test.js`:
  `# tests 38 / # pass 38 / # fail 0 / # skipped 0` (the v1.194.3 lock and the new
  `v1.314 CSS MOBILE SPREAD` both listed as subtests).
- 12 sibling census/lock files that read the stage/glow/tokens (era-typography,
  home-mobile-scale, ipad-header-safe-area, oneoff-modal-mobile-polish,
  overlay-containment, player-audio-expand, player-chapters-parity,
  player-responsive-controls, settings-mobile-polish, sticky-filter-bar,
  watch-action-bar-nowrap, watch-instant-paint) + token-scale-lock:
  `# tests 196 / # pass 196 / # fail 0`.
- `bash .harness/lib/check-markers.sh`: `1 issue(s) found` - the known `stale approval
  @92d48874` flag on this doc's `design:` line, as the build record discloses.
- Em dashes on added diff lines: `git diff 92d48874..5589ffbe | grep "^+" | grep -c "—"` = 0.
- Sandbox (a `git archive HEAD` copy under the session scratchpad, deleted after; the
  worktree was never mutated): mutant `if (sameSource(src, painted) && src.kind !==
  'image') return;` (the poster re-samples every clock) -> engine file `26 tests, 25
  pass, 1 fail`: only `gate F4 (M14)` reds; test 13 `a sprite that fails to load FALLS
  to the poster ... a static poster is never re-sampled` stays GREEN. See W1.

Verified by reading (re-derived, not from the prose):
- Focus 2, teardown: the fade deferral adds NO timer - it is one number
  (`lastPaintAt`) re-checked by the existing 1s clock; `stop()`/`fail()` clear the only
  timer as before; `evaluate()` -> `stop()` on visibilitychange/pause with a deferred tile
  just drops it and `start()`'s own `check()` paints it (or defers to the next clock)
  on resume. No leak on abort. First paint: `lastPaintAt = -Infinity` never defers.
- Focus 2, the rewritten tile-change test: every v1.312 assertion survives (same tile ->
  no sample, new index -> one sample, row/col draw args, layer alternation, different
  bitmap, `is-front` handoff, painted index); the numbers re-derive: k(27s) 0.8347,
  acc1 68.17, step at tile 11 2.73/channel < 4 (absorbed), tile 12 7.6 >= 4 (painted).
  The harness advances the wall BEFORE running the tick, as setTimeout does.
- Focus 4, CSS: the mobile `.ambient-glow` override is inside its own `@media (max-width:
  768px)` at specificity 0-1-0, source-AFTER the base rule (style.css ~9113 vs 9091);
  the test binds ORDER via the `{` character index (`glowM.index > glowBase.index`), not
  presence. `.main-content { padding: var(--space-8) }` sits inside the 768px block that
  opens at 5207 and closes at 6028 (brace-balanced) - the same token the stage's
  `--ambient-gutter` consumes; no era/skin rule overrides `.main-content` padding
  (grep empty), `#view-root` and `.watch-main` carry no padding, and
  `.watch-player-stage` exists only in watch.html (tv/podcasts route through it), so the
  negative margin lands exactly on the 16px gutter for every skin. The fullscreen rule
  (`z-index: auto`) is untouched.
- Focus 5: the memory claim holds against `.harness/scrutiny.toml` - the four paths match
  only `docs-and-content` (`**/*.md`, slim); nothing matches `*token*`/`*secret*`/
  `*credential*`/`auth/`/`.env*`/`package*.json`/`*fetch*`/`*client*`, so no
  security-brief seat is forced; qa is Dean's escalation, which the table permits.
  Build-record numbers (38/38, lint 0/0, the check-markers flag) match what I measured.
- Comment references: "one swap every ~3.5s" is the rebuild plan's measurement (line
  136); v1.194.3 is the real sideways-scroll release (releases.json:2235); the
  "~12% / ~49%" weights are exact (1-exp(-2/15), 1-exp(-10/15)); 43px = 0.12 x 358.

Security surface: NONE new - no network, no storage, no server route, no user input; the
engine still reads only same-origin images into an off-DOM canvas and writes a base64
PNG into a quoted `url()`. Wall time enters through `Date.now()` only. No shell surface.

Findings:
- **W1 (WARNING, test binding loosened)** `test/unit/ambient-glow-engine.test.js:~397`
  (test `a sprite that fails to load FALLS to the poster ...`): `h.video.currentTime =
  50; h.tick()` now runs at wall 1000ms with `lastPaintAt = 0`, so `check()` returns at
  the fade gap BEFORE `sameSource`; the assertion `a static poster is never re-sampled`
  is satisfied by the deferral, not by the poster's fixed index. At the base sha this
  test killed the mutant above; on the branch it passes it (sandbox, verbatim above).
  M14 still catches it, so the suite's net holds, but the assertion's message now
  lies about what it proves. Fix: `await pastFade(h);` before `h.video.currentTime =
  50;` (the same edit the branch made to M13 and THE CONSTRAINT). One line; blocks
  because it is a v1.312 assertion silently unbound, which focus 2 asked for explicitly.
- **S1 (SUGGESTION, suspicion)** `public/js/watch.js:277` default `now = Date.now`: not
  monotonic. A backward wall-clock step (iOS NTP correction) of N seconds makes
  `now() - lastPaintAt` negative and defers every paint for N seconds. `performance.now`
  is barred by the source lock; a clamp (`if (lastPaintAt > n) lastPaintAt = n`) in
  `check()` would close it. No scenario I can drive here, so a suspicion.
- **S2 (SUGGESTION, comment mechanism)** `style.css:9057` (line touched by this diff:
  the `*/` moved): "`clip` (not hidden) creates no containing block" - neither
  `overflow: hidden` nor `clip` establishes a containing block for a `position: fixed`
  descendant; the real reason `clip` is required is that `overflow-x: hidden` forces
  `overflow-y` to `auto`, which would clip the vertical bloom. Legacy v1.194.3 prose;
  worth correcting while the block is open.
- **S3 (SUGGESTION, honest device list)** Acceptance 5 says "portrait and landscape":
  an iPhone in landscape (844px) is ABOVE the 768px breakpoint, so none of this diff's
  mobile rules apply there - the landscape look and any sideways scroll are the desktop
  path, unchanged from v1.313. Say so in the device list so a landscape observation is
  not read as a regression of this change.

Tree proof: `git status --short` = `?? node_modules` (the shared symlink the coordinator
removes) plus this doc; `git diff` = this section only. Scratch sandbox deleted.

Gate: CHANGES r1 @5589ffbe — qa

## Gate r2 - qa @383f24ce (delta re-confirmation)

Scope: 64c80679 (merge of main v1.314.0, the bell wave - not re-reviewed here beyond
running the instruments over the merged tree) + 383f24ce (the fix commit: 5 files,
+52/-9; its own code delta is 3 CSS comment lines, 3 engine lines, 10 test lines).

Instruments at 383f24ce (Node 22.23.1; full `npm test` and Node 24 still not run here):
- `npm run lint:css`: `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`.
- `npm run lint:overlay`: `overlay-containment: clean (0 violations)`.
- `npm run ledger:check`: `ledger-check: CLEAN - every linter site has exactly one current ledger row`.
- `npx eslint public/js/watch.js test/unit/ambient-glow-engine.test.js`: exit 0.
- ambient-glow-engine + watch-chrome-ambient: `# tests 38 / # pass 38 / # fail 0 / # skipped 0`.
- the 12 sibling census files + token-scale-lock: `# tests 196 / # pass 196 / # fail 0`.
- ledger-check + release-ledger + release-date + player-lifecycle-release:
  `# tests 73 / # pass 73 / # fail 0`.
- `bash .harness/lib/check-markers.sh`: `2 issue(s) found` - the known `@92d48874`
  design flag plus a new `stale approval @5589ffbe` raised by the r1 markers this doc
  now carries by design (line 223's "r1 @5589ffbe: adversary APPROVED" and the
  re-appended r1 Gate lines). Same shape the completed polish plan carried between its
  r1 and r2 lines; it is the history, not a live approval.
- Em dashes on lines added by 383f24ce: 2, both inside the Architect's disclosure
  quoting the two r1 `Gate:` lines in the harness's own verdict format. Not a finding.
- Sandbox (`git archive 383f24ce`, deleted after): mutant A (the r1 W1 mutant, poster
  re-samples every clock) -> `26 tests, 24 pass, 2 fail`: `not ok 13 - a sprite that
  fails to load FALLS to the poster ...` AND `not ok 17 - M14`. Test 13 now reds on
  its own, as prescribed. Mutant B (the S1 clamp line removed) -> `25 pass, 1 fail`:
  only `not ok 21 - SOURCE LOCK`.

Finding-by-finding:
- W1: fixed-as-prescribed (`await pastFade(h)` at test line 408, with a comment naming
  the mutant). Verified red under mutant A.
- S1: fixed-as-prescribed (`var n = now(); if (lastPaintAt > n) lastPaintAt = n;` at
  watch.js:396-398, the gate compares against the clamped `n`); the existing source lock
  moved to `n - lastPaintAt`, a regex binds the clamp line, and adversary S2's "exactly
  one `Date.now(`, in the `now` default" lock is present. The clamp is bound by
  SPELLING only (mutant B is caught by the source lock alone, no behavioural test drives
  a backward wall step); acceptable for a suggestion-grade fix, noted below as residual.
- S2: fixed-as-prescribed. The new prose (style.css:9064-9068) states the real
  mechanism: `overflow-x: hidden` would compute the other axis to `auto` (CSS Overflow 3)
  and clip the vertical bloom; neither `hidden` nor `clip` creates a containing block
  for the fixed overlay. Accurate.
- S3: fixed-as-prescribed. Acceptance 5 now separates portrait (<= 768px, this diff) from
  landscape (844px, the desktop path, sideways scroll measured IDENTICAL at the base
  sha); tracker #234 exists (tech-debt-tracker.md:366) with the measurement (scrollWidth
  888 > 844) and two fix shapes for Dean's call.
- New in the fix commit: nothing else. The engine delta is the two clamp lines; the
  test delta is the pastFade line + four lock assertions; no CSS declaration changed.

Residual (non-blocking):
- **S4 (SUGGESTION)** S1 is a presence lock, not a binding: a one-arm behavioural test
  (paint at wall 60000, step the injected `now` back to 1000, advance one tick, assert
  the next tile still paints on the following clock) would bind the clamp's semantics
  rather than its spelling. Safe to ship as is; the clamp is three tokens and the regex
  pins them.

Security surface: unchanged from r1 - none new in 383f24ce (comment, a wall-clock clamp,
tests). The merged main wave (the bell: PATCH /api/subscriptions/:id, a new fetch in
watch.js) carried its own full gate with a security-brief seat at d7342962 and is out of
this delta's scope.

Tree proof: `git status --short` = ` M docs/exec-plans/active/...spread-and-pace.md` and
`?? node_modules` (the shared symlink, left per the coordinator); `git diff` = this doc
only. Sandbox `scratchpad/qa-ambient/sb-r2` deleted.

Gate: APPROVED r2 @383f24ce — qa

## Gate r2 - adversary @383f24ce

Delta re-review of 64c80679 (merge of main v1.314.0) + 383f24ce (the r1 fixes). Measured: the two ambient files **38 tests, 38 pass, 0 fail** on Node 22.23.1 AND 24.20.0; `lint:css` TOTAL 0; `lint:overlay` 0 violations. Brace-balanced slice of `createAmbientEngine` at 5589ffbe vs 383f24ce differs ONLY by the clamp (three lines replacing the one gap line); `setupAmbientMode` byte-identical; every `.ambient-glow*` / `.watch-player-stage` / `.main-content` rule (comment-stripped) byte-identical - the merge of main touched watch.js and style.css only outside the ambient bodies, and its only change to the ambient test file is the #232 style-write lock refinement (green here).

- **My S2 - fixed as prescribed.** 48 mutants re-run in a `git archive 383f24ce` sandbox: 47 killed, 1 equivalent (E15, unchanged). E5 (`var n = Date.now()`) and E5b (every `now()` -> `Date.now()`) now go red on the SOURCE lock as well as the behavioural tests; a second `Date.now()` anywhere in the engine (K4) reds the "exactly ONE" count.
- **qa S1 clamp - verified behaviourally, not just by regex.** Real engine + real `planStoryboard(3600)` geometry: paint at wall 11000, then a 20s backward wall step (`wall = -10000`) with a new tile -> WITH the clamp the next paint lands after **4** clock ticks (clamp anchors on the first check, then the 2.4s gap); with the clamp line removed (sandbox) it lands after **24** ticks. Injected-clock interaction in the suite: `lastPaintAt = -Infinity` and `wall` starts at 0, so `-Infinity > 0` is never true and the harness paths are untouched (38 green). Mutants: K1 (drop the clamp) and K2 (invert it, 14 red) killed; K3 (`>=`) is equivalent and dies only on the regex.
- **qa W1 (`await pastFade(h)` before the poster re-sample assertion) - verified:** mutant Q1 "re-sample the poster every clock" now reds the fall-to-poster test and the zero-size-image test (it survived that assertion at 5589ffbe per QA).
- **My W1 - disclosed as prescribed:** Acceptance 5 / device list reworded to "landscape is the desktop path (> 768px)", tracker #234 present. Not re-measured (the CSS rules are byte-identical to the sha where I measured 888/844 on both tip and base).
- **SUGGESTION (new, carries over the r1 shape):** the clamp is held only by the source regex (`K1` reds only the SOURCE LOCK). A one-line behavioural binding - after a paint, step the injected wall backwards and assert the next tile paints within `fadeMs` of the NEW wall, not the old - would make the regex redundant. Not blocking.
- Nothing new introduced by the fix commit was found.

Gate: APPROVED r2 @383f24ce — adversary
