# Wheel config: the Click wheel test becomes the real wheel's source of truth

Status: SHIPPED v1.303.0 (2026-09-15, DEVICE-PENDING). Owner: main session. Gate: FULL
(both seats APPROVE after 1 fix round - the gate caught the sweep math NOT actually shared
[a lying comment on the headline scar] + a vacuous re-anchored source-lock; both fixed +
mutation-verified). Device pass: Dean's (the haptic feel; default == today, so safe pending).

## Intent (Dean, agreed all 4 intake points)
The "Click wheel test" (Settings > Experimental) is a dead-end diagnostic. Make its
selections WRITE a persisted wheel config that the REAL iPod wheel READS on every skin
mount, so the test bench becomes the source of truth. It stays useful for testing and
now drives the actual wheel; some combos feel better, so this makes the wheel flexible.

Intake rulings (ALL AGREE):
1. The menu drives: **Engine, Dither, Detent, Capture, Buzz**. "Meter by" + "Step" stay
   diagnostic-only (they measure; they never touch the persisted config).
2. **Port the Sweep engine into the real wheel**, SHARED with the test tool (no drift).
3. **Default when unset (or Grid picked) = today's exact feel**: Ghost, Fine-96 (3.75deg),
   capture-after-8px, buzz on. Grid stays test-only; on the real wheel Grid -> Ghost.
4. **One wave**: plumbing + Sweep port together, default Ghost, safe to ship without a
   device pass; Dean tunes Sweep live afterward and the combo sticks.
5. Config is **device-local** (localStorage), matching the test tool's device-local nature
   and the fact haptic capability/feel varies per phone. (Dean offered no objection.)

## Machine-derived facts (re-verify at each commit; never hand-enumerated)
- Shells loading skin-surface.js: **10** (`grep -l skin-surface.js public/*.html`): index,
  books, history, stats, read, music, setup, podcasts, tv, watch. wheel-config.js must load
  on ALL 10, BEFORE skin-surface.js and setup.js.
- The DUPLICATED constants today (the drift surface):
  - `HAPTIC_STEP_DEG = 3.75` (skin-surface.js:1030 `var`; setup.js:3751 WHEEL_CAL)
  - `HAPTIC_MIN_MS = 8` (skin-surface.js:1048 `var`; setup.js:3752 WHEEL_CAL)
  - bias `18` (skin-surface.js:1187 MAGIC `st.hapBias * 18`; setup.js:3753 WHEEL_CAL.BIAS_PX)
  - dead-zone `0.20` (skin-surface.js dead-center guard `* 0.2` MAGIC; setup.js:3754 DEAD_FRAC)
- Config fields: **5** (engine, dither, detent, capture, buzz).
- Test-menu knobs today (setup.js wheelCalTemplate): engine[ghost|grid|sweep], grid density
  [12|18|24], dither[14|18|24], detent[3.75|5.5|8], meter-by[angle|arc], step(slider),
  capture[8px|press|off], ghost-buzz[on|off]. Of these, 5 become the wheel config; meter-by +
  step + grid-density stay diagnostic (grid-density only matters to the test's Grid engine).

## Named scars -> FULL gate brief
- **Constant/feel DRIFT** (setup.js WHEEL_CAL vs skin-surface.js). The shared module makes it
  STRUCTURALLY impossible (both read one source). The cross-lock test flips from "values match"
  to "both source from FileTubeWheelConfig".
- **Ghost-switch SCROLL-LOCK / capture LEAK** (the v1.227 leak class, re-struck many times): a
  gesture must never strand the body scroll-lock, the pointer capture, or the ghost. Buzz-off,
  engine switching, and capture-mode changes must all tear down cleanly on every end arm.
- **SHELL PARITY** (v1.250 class): wheel-config.js is a NEW global that skin-surface.js depends
  on; it must ship on every shell that can host the skin, BEFORE it. Dynamic parity test over
  public/*.html.
- **INERT-FEATURE reachability** (v1.185 class): prove the REAL wheel reads and HONORS the config
  on the haptic path, not just a green unit test of a function that never runs. Brief the gate to
  prove reachability (drive the real onDown/onMove with a mocked config, assert the branch taken).

## Architecture: one shared module `public/js/wheel-config.js`
IIFE -> `window.FileTubeWheelConfig` + `module.exports` (the music-skins.js pattern). Owns:
- `KEY = 'ft-wheel-config'`.
- Choice lists + defaults: ENGINES ['ghost','grid','sweep'], DITHERS [14,18,24], DETENTS
  [3.75,5.5,8], CAPTURES ['8px','press','off']; DEFAULT = {engine:'ghost', dither:18,
  detent:3.75, capture:'8px', buzz:true} (== today's shipping feel).
- The shared CONSTANTS both files used: `STEP_DEFAULT 3.75, MIN_MS 8, BIAS_DEFAULT 18,
  DEAD_FRAC 0.20, BAND_INNER_MAX 0.47, BAND_MID_MAX 0.73, DEFAULT_STEP_ARC_PX 6`. ONE source.
- `normalize(cfg)` (clamp each field to its list; buzz !== false), `read(store)`, `write(cfg,store)`
  (validate + persist; return normalized) - all try/catch (private mode / no localStorage).
- `effectiveEngine(cfg)` -> the engine the REAL wheel runs: 'grid' -> 'ghost'; else pass-through.
- `sweepOffset(sweepAngleDeg, dither, detentDeg)` = `dither * Math.sin((sweepAngle/detent)*PI)` -
  the shared FEEL math both the test's placeSweep AND the real wheel call, so Sweep feels identical.

## Implementation (small task commits, each green before the next)
- **T1 wheel-config.js + unit tests.** Module + tests: normalize clamps each field, unknown ->
  default; read/write round-trip; effectiveEngine grid->ghost + pass-through; sweepOffset ==
  dither*sin(...); DEFAULT === today's shipping values (a silent-feel-change guard).
- **T2 shell inclusion + parity.** Add `<script src="/js/wheel-config.js">` to all 10 shells
  BEFORE skin-surface.js (and setup.js). A dynamic test enumerating public/*.html: every shell
  that loads skin-surface.js also loads wheel-config.js earlier in source order.
- **T3 skin-surface.js reads config (the real wheel).** Source HAPTIC_STEP_DEG/HAPTIC_MIN_MS/bias/
  dead-frac from FileTubeWheelConfig.CONST (kills the magic numbers). At gesture start read the
  live config once: engine=effectiveEngine, detentDeg=detent, dither, capture, buzz.
  - hapticOnMove branches: buzz false -> no ghost placement (rotation still scrubs/cursors);
    'sweep' -> accumulate st.sweepAngle + place via sweepOffset (no bias flip); else 'ghost' ->
    bias-flip with amplitude = dither, threshold = detentDeg.
  - Capture: 'press' -> capture on down; '8px' -> capture after 8px (current); 'off' -> never.
  - Grid never runs on the real wheel (effectiveEngine already mapped it to ghost).
  - Reachability + leak tests: mocked config drives the real onDown/onMove; buzz:false mounts no
    ghost; 'sweep' takes the sweep branch; every end arm restores the ghost + releases capture.
- **T4 setup.js wires the menu as the source of truth + cross-lock refactor.** WHEEL_CAL sources
  from FileTubeWheelConfig.CONST. The test's cfg SEEDS from FileTubeWheelConfig.read() (menu opens
  on the saved combo); each engine/dither/detent/capture/buzz selection calls
  FileTubeWheelConfig.write() (persist). meter-by/step/grid-density stay local. Cross-lock test:
  assert setup.js AND skin-surface.js both source the constants from FileTubeWheelConfig (drift
  impossible), replacing the value-match assertion.

## Ship
FULL gate (both seats), briefed on the 4 scars. Fix round. Dual-Node (main checkout, 0 skips).
Ceremony v1.303.0 (ledger in user language: "the wheel test now sets how the real click wheel
feels"). Default Ghost = zero feel-regression, so safe to ship with Dean's device pass PENDING;
he tunes Sweep on-device afterward.
