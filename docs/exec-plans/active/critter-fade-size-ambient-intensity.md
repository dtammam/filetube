# Critter sneak-in + size, Ambient intensity + organic falloff (v1.187.0)

**Status:** IN PROGRESS - FULL gate (4 user-facing features across critters + ambient).

Dean, 4 asks (intake answered inline):
1. Critter arrival is ABRUPT -> a smooth, seamless fade, "almost like they sneak in".
   Dean chose: **~1.2s gentle ease, fade + a subtle rise** (reduced-motion arm required).
2. Ambient is **too intense** -> an intensity dropdown: subtle (way less) / normal
   (slightly less than now) / intense (today) / extreme (more). Dean chose:
   **in the player cog, under the Ambient toggle** (live tuning while watching).
3. Critter **size** option: tiny (way smaller) / normal (today) / large (2x) /
   extra large (3x). "All rules, etc should continue."
4. Ambient has **hard cuts - it stops on lines**; it should fall off organically
   "like normal light".

## Grounding (verified in source)

- Arrival today: `.critter { animation: critter-arrive var(--dur-slow) ease-out both }`
  = 0.25s opacity-only. `.critter-still` kills it for re-glue rebuilds (no replay).
- The `.critter` WRAPPER carries the clip; the `.critter-pose` INSIDE carries
  `transform: rotate(var(--critter-angle)) scaleX(var(--critter-flip))`. The v1.168
  gate lesson: NEVER animate the wrapper's transform (it swings the clip cut).
  => the RISE goes on the POSE (composed with the angle/flip vars), so the critter
  rises INTO place from behind its anchor and the clip stays put. Reactions also
  animate the pose's `animation` property, so they cleanly replace the arrival one.
- Size today (planCritterScatter): `a.h <= 64 ? clamp(26..88, a.h*(1.1..1.5)) :
  44 + rng*44`. Every downstream rule (cross-axis fit, cover/peek, exclusions,
  bounds, screen-edge) consumes `size`, so scaling at that ONE point makes all of
  them apply to the scaled size automatically.
- **Cross-axis fit would UNDO the big sizes**: `crossAllow = anchorExtent * 1.15;
  if (size*spread > crossAllow) size = max(26, crossAllow/spread)`. It caps a
  critter at ~1.15x its anchor. RULING: scale `crossAllow` AND the 26px floor by
  the same factor - the proportion rule keeps its SHAPE, in proportion to the
  user's choice. With scale=1 the arithmetic is byte-identical (no regression).
  The SAFETY invariants (exclusions, bounds W4, screen-edge v1.180, the peek
  invariant) are NOT scaled - they still hard-skip a placement.
- Ambient glow today: a blurred, `scale(1.3)` canvas with NO mask -> its edge
  terminates on a straight line, and `html { overflow-x: clip }` guillotines it at
  the viewport. => item 4 is a MASK problem: a radial-gradient falloff (BOTH
  `-webkit-mask-image` and `mask-image` - the v1.77 prefixed-vs-standard lesson).

## Implementation

- `CRITTER_SIZE_SCALES = { tiny: 0.5, normal: 1, large: 2, xlarge: 3 }`,
  `CRITTER_STORAGE_SIZE = 'ft-critters:size'`; `resolveCritterConfig` returns
  `size` + `sizeScale` (default normal/1, garbage -> normal). `scatterCritters`
  passes `sizeScale` into `planCritterScatter` (`opts.sizeScale`, default 1 so
  every existing direct-call test is unchanged).
- Settings -> Critters: a "Size" select beside "How many" (same markup pattern);
  `applyCritterMode()` on change (re-scatter, like density).
- `AMBIENT_LEVELS = { subtle, normal, intense, extreme }` -> opacity (and a
  matching blur/scale so "extreme" reads as more light, not just more alpha),
  `ft-ambient-intensity`, DEFAULT `normal` (Dean: today is too intense).
  Applied as a `data-ambient` attribute on the canvas + CSS per level (no inline
  style -> the token census stays clean).
- The intensity `<select>` is INJECTED into the cog menu under the Ambient row by
  `ensureCogControlsInjected` (the shared host template is parity-locked across
  nine shells - v1.186's lesson).
- Ambient falloff: `--ambient-mask: radial-gradient(ellipse at center, black 35%,
  transparent 78%)` applied under both mask spellings.

## Predictions the tests re-verify

- `resolveCritterConfig` exposes sizeScale: tiny .5 / normal 1 / large 2 /
  xlarge 3; unset + garbage -> normal(1); the existing keys are unchanged.
- `planCritterScatter` with sizeScale=2 yields ~2x sizes vs scale=1 on the SAME
  seed and anchors, and with scale=1 is byte-identical to today.
- Every invariant still holds at 3x: every placement PEEKS, none intersects an
  exclusion, none exceeds bounds, none crosses the screen edge.
- `resolveAmbientLevel` maps the four names, defaults to normal, tolerates garbage.
- The arrival animation is ~1.2s; the RISE is on `.critter-pose` (never the
  clipped wrapper); a reduced-motion arm drops the movement; `.critter-still`
  suppresses BOTH.
- The ambient glow carries a radial falloff mask under BOTH spellings.

## Attack surfaces for the gate

- A 3x critter escaping an invariant (screen edge / bounds / exclusion / peek).
- The rise moving the CLIP (v1.168) or clobbering the pose's angle/flip vars, or
  fighting a tap reaction's animation.
- `.critter-still` still silent (no fade AND no rise) on a re-glue.
- The intensity select injected twice, or lost on re-navigation (id-guard).
- Mask spelling porosity (one spelling only -> breaks Firefox or iOS).
- Ambient default changing behavior for an existing opted-in user (it does, by
  design: intense -> normal; disclose).
