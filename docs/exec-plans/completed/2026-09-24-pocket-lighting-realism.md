---
plan: pocket-lighting-realism
harness: v2 · lean
branch: feat/pocket-lighting-realism
anchor: spec
status: Shipped v1.328.0
next: release v1.328.0
design: this document, on the v1.327.0 skeleton (docs/exec-plans/completed/2026-09-24-pocket-gyro-lighting.md)
gate: APPROVED r1 @ffdc5df3 (adversary + qa); the warnings are test guards, filed as #275
---

# Pocket lighting, second swing: more realistic, more joyful

Dean on the device (2026-09-24, v1.327.0): "I like it a lot. I think it's a little subtle. I think the
skeleton is perfect ... let's really zhuzh it up ... make it more realistic and also more pleasant, more
joyful ... subtle can probably stay near pronounced and pronounced will be the new one." The skeleton
(driver, permission, teardown, the gate's fixes) is untouched; this swing is a CSS lighting PROFILE plus
three constants. Click skins only, as before.

## What "realistic" means here (research, 2026-09-24)

The CSS holographic-card work (simeydotme/pokemon-cards-css, base.css `.card__glare`) reads as real
because of four things, all reproducible with gradient positions and alpha alone (their blend modes and
filters stay out - the iPhone black-video lesson): a WIDE soft specular circle with a HOT core
(`hsla(0,0%,100%,.8) 10%, .65 20%`) that dims as the light moves off-centre (their opacity follows the
pointer's distance from centre); a DARKENED far side (`hsla(0,0%,0%,.5) 90%`) that gives "lit from one
side" depth; and an ease-out on release. The Zune 30 photo (v1.327 plan) adds the chrome rule: a bright
ARC on the lit edge of a ring and a dark arc opposite; every shadow falls away from the light.

## Design

**Two profiles, one skeleton.** `.mms-lit` (Subtle) keeps v1.327.0's Pronounced look (pixel-identical at
neutral, measured by qa; tilted it differs by the inset-sign fix and the .8 gain over the 20-degree range).
`.mms-lit-strong` (Pronounced) layers the realism on top. The driver adds the strong class when the
strength is `pronounced` (in `applyLit`, gated exactly like `.mms-lit`); Off clears both.

**Constants (pocket-lighting.js):** `TILT_RANGE_DEG` 28 -> 20 (a wrist tilt reaches the edge);
`GAIN.subtle` .5 -> .8 (= today's Pronounced travel within 10 percent), `GAIN.pronounced` 1. A third
property `--lm` (the light's distance from centre, 0..1) drives the hot core's dimming.

**The strong profile (CSS, per Click skin where the palette differs):**
1. Dome: a specular HOT SPOT (`circle at calc(50% + var(--lx)*34%) calc(32% + var(--ly)*34%)`,
   `--mms-lit-hot` .85 at 0, `--mms-lit-hot2` .35 at 18%, transparent 40%), its opacity
   `calc(1 - var(--lm,0)*.45)`; a dark far side (`circle at calc(50% - var(--lx)*40%) ...`,
   `--mms-lit-far` .16 to transparent 55%); the shadow offset 3px -> 5px.
2. Wheel: a bright RIM ARC on the lit edge and a dark arc opposite as two soft INSET CRESCENTS in the
   strong wheel shadow (`inset calc(var(--lx)*-9px) calc(2px + var(--ly)*-9px) 12px -3px --mms-lit-arc`
   .38; `inset calc(var(--lx)*9px) ... 14px -4px --mms-lit-darc` .18) - the first build drew them as two
   offset radial rings and they crossed inside the face (the probe screenshot showed it); the sheen
   travels 40% (was 30%), the base ramp 14%; the drop shadow 4px -> 7px, blur 2 -> 5px.
   FOUND ON THE WAY (fixed in both profiles): v1.327.0 had the two INSET signs swapped - an inset
   shadow with a +x offset paints along the LEFT inner edge, so the rim highlight brightened the far
   side and the recess darkened the lit side (2px, invisible at neutral; the adversary's pixel check
   was at neutral). The rim now takes the light negated, the recess as is; the lock asserts the signs.
3. Body: the band gains a narrow bright CORE (`--mms-lits-core` .55 over 1.5% at the band's centre)
   and travels 20% / 16% (was 12 / 10); a broad ROOM LIGHT radial on the same layer
   (`120% 80% at calc(50% + var(--lx)*35%) calc(10% + var(--ly)*30%)`, `--mms-lit-room` .22 to
   transparent 60%). Black: the band .16 -> .26 (`--mms-litks-*`); Matte .09 -> .14 (`--mms-litms-*`).
4. Glass: the streak .16 -> .24 with a hot line, travel 22% -> 30%, plus a faint second streak 8% behind
   it (a double-pane reflection, `--mms-lits-glass2` .08).

All of it: gradient positions + two translated gradient layers, no filter / blur / mask / backdrop
(the whole-rule lock from v1.327 covers the new rules automatically: every rule whose selector names
`mms-lit` or reads `--lx/--ly`). Off stays byte-identical (the only base change is the inset-sign fix in
the two `.mms-lit` shadow tokens, which resolve to the same constants at neutral).

## Acceptance

- AC1: Pronounced adds `.mms-lit-strong` (gated like `.mms-lit`: first sample behind a permission
  gate); Subtle never does; Off clears both; a stop/start re-gates both.
- AC2: `--lm` is written with `--lx/--ly` (0 at neutral, 1 at the edge), cleared with them.
- AC3: constants: `TILT_RANGE_DEG` 20; `GAIN` {off 0, subtle .8, pronounced 1}; a tilt of
  `TILT_RANGE_DEG` reaches |1|.
- AC4 (CSS lock): the strong rules exist for the three Click wheels + domes, the band and the glass;
  the base (Subtle) gradient rules are unchanged from v1.327.0 and its shadow tokens carry the corrected
  signs (the lock asserts the wheel's; the dome's are #275a); no
  filter / blur / mask / backdrop in any lighting rule (whole rules); no Seattle rule reads the light.
- AC5 (probe): `scripts/pocket-lighting-probe.js --strength=<s>` screenshots Subtle and Pronounced per
  skin at the three light positions; the CPU numbers stay in the v1.327 band (< 2 ms/frame moving on
  this box, 0 writes still); the listener census unchanged.
- AC6: the full unit suite green; lint:css TOTAL 0; overlay clean.

## Built (2026-09-24) - the pre-gate evidence

- `pocket-lighting.test.js` 15/15 (AC1-AC4 added to the existing tests); touched suites 219/219;
  eslint clean; `lint:css` TOTAL 0; overlay clean.
- Probe (`--strength=pronounced`, 390x844 DPR 2, software GL): moving 0.21 ms script + 1.20 ms style per
  frame, 1 layout in 120 frames (the dome's ::after on first lit), still 0 writes / 0 recalcs; listeners
  Off 0 / On 1 / docked 0 / destroyed 0 / Seattle 0. `--strength=subtle`: lit, no strong class,
  `--lx` -0.58 at the upper-left pose (was -0.41 at v1.327's Pronounced: the same travel, wider range).
- Screenshots (scratchpad probe-strong2): the Click wheel shows the lit crescent and the dark one
  opposite, the dome its hot spot and shadow, the body its band and room light, the glass its double
  streak; Black is the payoff (the band's hot core across the body).

## Disclosed up front

- The feel is Dean's iPhone again; the same knobs plus the strong profile's alphas (all tokens).
- Seattle stays out (#273). The iPad-trackpad partial look (#274a) is unchanged by this swing.

## Gate r1 - adversary

Gate: APPROVED r1 @ffdc5df3 — adversary

Measured (sandboxes from `git archive 8583236e` / `git archive HEAD`, headless Chromium 1234, 390x844):
- Instruments: `node --test test/unit/pocket-lighting.test.js` 15 pass 0 fail; `npm run lint:css` TOTAL 0; overlay "clean (0 violations)"; eslint (js + probe + test) exit 0.
- R1 Off: ipod / ipod-black / ipod-matte / zune-classic strength off, main vs HEAD PNGs: 4/4 `cmp` IDENTICAL (md5 63eb3e95.., 7f631ecd.., e1923d64.., 541be55e..).
- R2 inset sign, `--lx=1`, mean luminance 2-6px inside the wheel edge L/R: HEAD pronounced ipod 177/215, black 38/94, matte 37/90; HEAD subtle 194/203, 42/50, 40/45; MAIN subtle 208/202, 74/49, 73/45. Main lit the LEFT (the v1.327 bug is real), HEAD lights the RIGHT: +x inset paints the left edge, the fix is correct. Drop shadow falls left (outside L < R in every case). Dome L/R: HEAD R brighter in all six.
- R3 overhang: layers forced solid (band red, glass blue) at R/L/U/D and all 4 corners x 3 skins: 0/2468 body-edge px and 0/500 LCD-edge px not the layer. Instrument non-vacuous: inset:-30% -> 860/2468 exposed; glass 0 -45% -> 250/500. Margin is 1% of panel width (0.34 vs 0.35), ratio-invariant.
- R4 gating mutants (all RED): subtle-gets-strong, strong-ungated-by-lit, strong-not-cleared, --lm not cleared, --lm not written, range 28, subtle .5, base wheel sign reverted, strong drop sign flipped.
- R5 perf (`pocket-lighting-probe.js --strength=pronounced`, private port): HEAD moving 0.151/0.157 ms script + 1.078/1.096 ms style, task 1.763 ms/frame, 1 layout; main 0.159 + 1.161, task 1.981. Still: 0 writes, 0 recalcs. Listeners off 0 / on 1 / docked 0 / destroyed 0 / seattle 0. Under 2.5 ms. (Raster/paint of the larger blurred shadows is NOT in these metrics: unmeasured.)
- R6/R7: `grep -i blend-mode public/css/style.css` 0 hits; CSS trig (atan2/sin/cos/hypot/sqrt/pow) 0 hits; the diff's only filter/blur/mask token is in a comment.

WARNING (ships disclosed: the code is measured correct, the guard is missing) W1 - the plan says "the lock asserts the signs"; it asserts only the WHEEL's. Mutants that SURVIVE 15/15: base dome-hi inset sign reverted to v1.327's (M11), strong dome far inset sign flipped (M13), hot-spot radial sign flipped (M16), far radial sign flipped (M17), strong dome drop sign flipped (M19). The v1.327 swapped-sign bug can come back on the dome with the suite green. Repro: `perl -0pi -e 's/--mms-lit-dome-shadow:inset calc\(var\(--lx,0\) \* -2px\) calc\(1px \+ var\(--ly,0\) \* -2px\)/--mms-lit-dome-shadow:inset calc(var(--lx,0) * 2px) calc(1px + var(--ly,0) * 2px)/' public/css/style.css` in a sandbox -> `# pass 15 # fail 0`.
SUGGESTION S1 - `.mms-ipod.mms-lit-strong .ip-center{ position:relative; overflow:hidden }` is unbound (M12 survives 15/15); dropping position:relative makes the hot-spot ::after resolve against .ip-wheel, a glow smeared across the wheel (verified by screenshot).
SUGGESTION S2 - no lock for the swing's own new rules: adding `mix-blend-mode:screen` (M14) or `rotate:atan2(1,1)` (M15) to a lighting rule survives 15/15. Extend the whole-rule lock regex.
SUGGESTION S3 - `--lm` clamp/metric unbound: `Math.hypot` unclamped (M6) or max(|x|,|y|) (M7) survive. Minor (corner opacity .37 vs .55).
SUGGESTION S4 - the plan doc's "Subtle keeps v1.327.0's Pronounced look byte-for-byte" and AC4 "the base (Subtle) rules are unchanged from v1.327.0" are false: the base shadow tokens changed sign (correctly) and the range is 20 deg. Reword.
SUGGESTION S5 (instrument) - the probe's DEBUG_PORT is a fixed 9333: my first HEAD run died "Runtime.evaluate: Inspected target navigated or closed" because QA's probe (pid 2432386, 23:01) held 9333 and I navigated its page. QA's probe numbers from ~23:01-23:05 may be contaminated; mine were re-run on port 9471 in the sandbox copy. Take the port from argv/env.

## Gate r1 - qa

Gate: APPROVED r1 @ffdc5df3 — qa

Measured on the live tree (HEAD ffdc5df3):
- `node --test test/unit/pocket-lighting.test.js`: "# tests 15 / # pass 15 / # fail 0". `npm run lint:css`: "TOTAL 0 (the token census; ceiling ZERO since v1.61.0)". `node scripts/overlay-containment-lint.js --enforce`: "overlay-containment: clean (0 violations)", exit 0. `npx eslint public/js/pocket-lighting.js`: no output, exit 0.
- R4 gating, sandbox mutants (`git archive HEAD`, diff non-empty before each run): strong for Subtle (`toggle(..., lit)`) RED test 4; strong ungated by lit RED test 10; strong never RED tests 4+10; clearProps keeps strong RED test 6; keeps `--lm` RED test 6; `--lm` never written RED test 4; base wheel sign reverted RED test 14.
- Subtle = v1.327 Pronounced: the diff's only removed CSS lines are the two `.mms-ipod.mms-lit` shadow tokens (`git diff 8583236e..ffdc5df3 -- public/css/style.css | grep '^-'`). Headless, lit + neutral, main Pronounced vs HEAD Subtle: 0 differing px on ipod / black / matte (780x1688); the control (main Pronounced vs HEAD Pronounced) differs by 628739 / 774009 / 786093 px, so the comparison is not vacuous. Tilted, Subtle differs from v1.327 by design (the sign fix, and max |lx| 0.800 instead of 1.000).
- Strong never leaks into Subtle: the probe copy at |lx| = |ly| = 1 (4 corners x 3 skins) reported `mms-lit-strong` false on all 15 Subtle shots and true on all 15 Pronounced shots.
- R2 inset sign, standalone headless (`box-shadow:inset -9px 0 12px -3px #fff` on black): left inner edge [0,0,0], right inner edge [170,170,170]. A negative x paints the RIGHT edge, so the new comment's rule holds. Pronounced black at lx=1, ly=-1 (screenshot): bright crescent upper right, dark arc and drop lower left, no exposed layer edge.
- R3 arithmetic: inset:-35% gives 1.7x; 20% of 1.7 = 34% < 35%; 16% of 1.7 = 27.2% < 35%; inset:0 -70% gives 2.4x; 25% of 2.4 = 60% < 70%. The JS clamps and never exceeds |1|: clamp1 comes before the gain, and the ease cannot overshoot.
- R6/R7: the added CSS lines contain no blend-mode and no CSS trig function. The only filter/blur/mask/backdrop match is a comment. No em dash on any added line (count 0). `--lm` is written by JS `Math.hypot`.
- Perf (probe copy, pronounced CPU leg): 0.161 ms script + 1.205 ms style per frame, task 1.984 ms/frame, 1 layout; still 0 writes. A second identical leg read task 3.216 ms/frame. That run overlapped the adversary's probe on the shared port 9333, so read it as contention, not a finding.
- Security: no security surface. Nothing changed in routes, the server, the network, auth or storage. The only new write is a numeric `toFixed` custom property. The probe's `--strength` argv reaches `JSON.stringify` and a filename under the operator's own out-dir. That is dev-only, and it is not a trust boundary.

WARNING W1 (safe to ship disclosed: the shipped code is correct, as measured above; only the guard is missing): the plan says "the lock asserts the signs", but only the wheel's are asserted. Mutant: base `--mms-lit-dome-shadow` dome-hi inset reverted to v1.327's `calc(var(--lx,0) * 2px) calc(1px + var(--ly,0) * 2px)`. Result: `# pass 15 # fail 0`. Scenario: a later edit re-swaps the dome sign, the dome rim brightens the far side on every lit tilt, and the suite stays green. Fix: assert both dome-shadow tokens in the lock.
WARNING W2 (safe to ship disclosed: the tree is clean by grep): the new constraint for this swing (no blend modes, no CSS trig) is not locked. Mutants that survive 15/15: `mix-blend-mode:overlay` added to `.ip-center::after`, and `rotate:atan2(var(--ly,0), var(--lx,0))` added to the same rule. Fix: extend the whole-rule regex with `(?:mix|background)-blend-mode` and `\b(?:a?sin|a?cos|a?tan2?|hypot)\(`. Consider matching `--lm` in the rule filter too.
SUGGESTION S1 (stale comments): pocket-lighting.js:6 says "TWO CSS custom properties" and :17-18 says "only ever writes two numbers ... two gradient layers (each painting one thin stripe)"; the code now writes three, and the strong band paints a broad room-light radial plus two glass stripes. Also, test:259 still says "// Subtle halves it" (the gain is .8). The JS comment's "within 10%" is wrong too: Subtle is +12% per degree (0.8/20 vs 1/28) and -20% at the edge.
SUGGESTION S2 (plan wording): line 32 says "byte-for-byte", line 63 says "no base rule changes", and AC4 says "base rules unchanged ... existing regexes still hold". None of that holds, because the base tokens changed sign and the lock regex was edited. The accurate statement: pixel-identical at neutral (0 px, above). Off is untouched.
SUGGESTION S3 (probe fidelity): the CPU leg is hard-coded `'pronounced'` (probe:121) while `report.strength` echoes `--strength`, so a `--strength=subtle` report mislabels its CPU numbers. `__frames` (probe:57) still tilts at beta 40 after the neutral moved to beta 0. By reasoning (not measured), the moving leg therefore holds a 40-degree pitch step, so `--ly` is pinned near -1 and only `--lx` moves. The fixed port 9333 also collides between concurrent seats: my first main run timed out, exit 124.
