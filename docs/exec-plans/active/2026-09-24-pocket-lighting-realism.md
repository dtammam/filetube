---
plan: pocket-lighting-realism
harness: v2 · lean
branch: feat/pocket-lighting-realism
anchor: spec
status: Built, in gate
next: ONE gate round (adversary + qa) at the sha below, release v1.328.0
design: this document, on the v1.327.0 skeleton (docs/exec-plans/completed/2026-09-24-pocket-gyro-lighting.md)
gate: pending
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

**Two profiles, one skeleton.** `.mms-lit` (Subtle) keeps v1.327.0's Pronounced look byte-for-byte.
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
`mms-lit` or reads `--lx/--ly`). Off stays byte-identical (no base rule changes).

## Acceptance

- AC1: Pronounced adds `.mms-lit-strong` (gated like `.mms-lit`: first sample behind a permission
  gate); Subtle never does; Off clears both; a stop/start re-gates both.
- AC2: `--lm` is written with `--lx/--ly` (0 at neutral, 1 at the edge), cleared with them.
- AC3: constants: `TILT_RANGE_DEG` 20; `GAIN` {off 0, subtle .8, pronounced 1}; a tilt of
  `TILT_RANGE_DEG` reaches |1|.
- AC4 (CSS lock): the strong rules exist for the three Click wheels + domes, the band and the glass;
  the base (Subtle) rules are unchanged from v1.327.0 (the lock's existing regexes still hold); no
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
