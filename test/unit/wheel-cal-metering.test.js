'use strict';

// [UNIT] Click wheel test — the pure metering core (setup.js).
//
// The tool reproduces the iPod wheel's native "ghost switch" haptic and lets
// the wheel be metered by ANGLE (the shipping behaviour) or ARC-LENGTH (the
// candidate fix), so the tick-density falloff toward the rim can be measured
// on-device. These tests bind the metering BEHAVIOUR (not source text): the
// band boundaries, the mode selection, the density metric, and — critically —
// that the tool's constants still match skin-surface.js's real wheel (a
// drifted copy would make the diagnostic lie).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  WHEEL_CAL, wheelCalShortAngle, wheelCalBandOf, wheelCalMeterQuantum,
  wheelCalStepFor, wheelCalDensity,
} = require('../../public/js/setup.js');

const SKIN_SURFACE_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
const SETUP_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');

// ---- the constants still match the real wheel (the anti-drift lock) --------

test('the wheel constants come from ONE shared source (wheel-config.js) — drift is impossible by construction, not by a hand-synced copy', () => {
  // v1.303: skin-surface.js (the real wheel) now SOURCES its haptic constants from
  // FileTubeWheelConfig.CONST instead of hard-coding them, so a drifted copy can no longer
  // exist - the tool (WHEEL_CAL) and the wheel read the SAME module. This replaces the old
  // "the two literals happen to be equal" lock with a structural one. Source-lock the refs:
  const WC = require('../../public/js/wheel-config.js');
  assert.match(SKIN_SURFACE_JS, /HAPTIC_STEP_DEG = \(WHEEL_CFG && WHEEL_CFG\.CONST\.STEP_DEFAULT\)/, 'skin-surface sources the tick step from the shared module');
  assert.match(SKIN_SURFACE_JS, /HAPTIC_MIN_MS = \(WHEEL_CFG && WHEEL_CFG\.CONST\.MIN_MS\)/, 'skin-surface sources the throttle floor from the shared module');
  assert.match(SKIN_SURFACE_JS, /HAPTIC_BIAS = \(WHEEL_CFG && WHEEL_CFG\.CONST\.BIAS_DEFAULT\)/, 'skin-surface sources the bias amplitude from the shared module');
  assert.match(SKIN_SURFACE_JS, /DEAD_FRAC = \(WHEEL_CFG && WHEEL_CFG\.CONST\.DEAD_FRAC\)/, 'skin-surface sources the centre dead-zone from the shared module');
  // the ghost placement now uses the config's Dither (default HAPTIC_BIAS), never a magic 18.
  assert.match(SKIN_SURFACE_JS, /st\.hapBias \* \(st\.dither \|\| HAPTIC_BIAS\)/, 'the ghost bias is the config Dither, not a hard-coded literal');
  // v1.303 (gate WARNING 1): the SWEEP feel math is genuinely shared - BOTH the real wheel's
  // hapticPlaceSweep AND the tool's placeSweep call FileTubeWheelConfig.sweepOffset, so neither
  // keeps a hand-copy of the sine that could drift from the other.
  assert.match(SKIN_SURFACE_JS, /WC\.sweepOffset\(st\.sweepAngle, st\.dither, st\.detentDeg\)/, 'the real wheel routes the sweep through the shared sweepOffset');
  assert.match(SETUP_JS, /wc\.sweepOffset\(st\.sweepAngle, cfg\.sweepDither, cfg\.sweepStep\)/, 'the Click wheel test routes the sweep through the shared sweepOffset (no hand-copy)');
  // and the tool's WHEEL_CAL equals that same shared CONST, so the meter still matches the wheel.
  assert.strictEqual(WHEEL_CAL.HAPTIC_STEP_DEG, WC.CONST.STEP_DEFAULT);
  assert.strictEqual(WHEEL_CAL.HAPTIC_MIN_MS, WC.CONST.MIN_MS);
  assert.strictEqual(WHEEL_CAL.BIAS_PX, WC.CONST.BIAS_DEFAULT);
  assert.strictEqual(WHEEL_CAL.DEAD_FRAC, WC.CONST.DEAD_FRAC);
});

test('the centre dead-zone comes from the shared CONST and equals the tool\'s (no drift, by construction)', () => {
  // v1.303: the real wheel's Select guard now applies the SOURCED `DEAD_FRAC` (= CONST.DEAD_FRAC),
  // not a magic 0.2 - so the tool + wheel share one value structurally. Bind that it is applied
  // as the dead-zone multiplier (a widened Select guard would have to change the shared CONST,
  // which reds the first cross-lock too), and that the tool's WHEEL_CAL equals the same CONST.
  const WC = require('../../public/js/wheel-config.js');
  assert.match(SKIN_SURFACE_JS, /Math\.hypot\([^)]*\) < r\.width \* DEAD_FRAC\)/, 'the Select guard applies the sourced DEAD_FRAC');
  assert.strictEqual(WHEEL_CAL.DEAD_FRAC, WC.CONST.DEAD_FRAC, 'the tool dead-zone equals the shared CONST exactly');
});

// ---- wheelCalShortAngle: the wrap boundaries ------------------------------

test('wheelCalShortAngle takes the short way around the ±180° seam', () => {
  assert.strictEqual(wheelCalShortAngle(10), 10);
  assert.strictEqual(wheelCalShortAngle(-10), -10);
  assert.strictEqual(wheelCalShortAngle(340), -20);   // +170 → −170 crossing
  assert.strictEqual(wheelCalShortAngle(-340), 20);
  assert.strictEqual(wheelCalShortAngle(179), 179);
  assert.strictEqual(wheelCalShortAngle(181), -179);  // just past the seam flips sign
});

// ---- wheelCalBandOf: the exact band edges (feel BOUNDARY pins) -------------

test('wheelCalBandOf pins the inner/mid/outer edges exactly (edge value belongs to the OUTER band of the pair)', () => {
  assert.strictEqual(wheelCalBandOf(0.30), 'inner');
  assert.strictEqual(wheelCalBandOf(0.4699), 'inner');
  assert.strictEqual(wheelCalBandOf(0.47), 'mid');    // BAND_INNER_MAX belongs to mid
  assert.strictEqual(wheelCalBandOf(0.72), 'mid');
  assert.strictEqual(wheelCalBandOf(0.73), 'outer');  // BAND_MID_MAX belongs to outer
  assert.strictEqual(wheelCalBandOf(1.30), 'outer');  // beyond the rim is still outer
});

test('a sub-dead-zone radius clamps to inner rather than skewing a band (a drag can cross inward past the Select guard)', () => {
  assert.strictEqual(wheelCalBandOf(0.05), 'inner');
  assert.strictEqual(wheelCalBandOf(0), 'inner');
});

// ---- mode selection: angle vs arc -----------------------------------------

test('wheelCalMeterQuantum picks |Δθ| in angle mode and arc-length px in arc mode', () => {
  assert.strictEqual(wheelCalMeterQuantum('angle', 4.2, 99), 4.2);
  assert.strictEqual(wheelCalMeterQuantum('arc', 4.2, 99), 99);
  // anything that is not exactly 'arc' is the shipping (angle) behaviour
  assert.strictEqual(wheelCalMeterQuantum(undefined, 4.2, 99), 4.2);
});

test('wheelCalStepFor returns the matching threshold for the active mode', () => {
  assert.strictEqual(wheelCalStepFor('angle', 3.75, 6), 3.75);
  assert.strictEqual(wheelCalStepFor('arc', 3.75, 6), 6);
});

// ---- density: the headline metric + its /0 floor --------------------------

test('wheelCalDensity is ticks per 100px of travel, and null before any travel (never divides by zero)', () => {
  assert.strictEqual(wheelCalDensity(0, 0), null);
  assert.strictEqual(wheelCalDensity(5, 0), null);
  assert.strictEqual(wheelCalDensity(0, 200), 0);
  assert.strictEqual(wheelCalDensity(10, 200), 5);   // 10 ticks / 200px * 100
  assert.strictEqual(wheelCalDensity(3, 100), 3);
});

// ---- the PROPERTY the whole tool exists to show ---------------------------
// In angle mode, ticks accrue per DEGREE, but density is per FINGER TRAVEL, so
// for a fixed rotation the density falls as radius grows (arc = r·θ). In arc
// mode, ticks accrue per arc-length, so density is radius-INDEPENDENT. This is
// the deterministic signal Dean reads off the three band bars.
// DISCLOSURE (adversarial SUGGESTION 1): these bind the density ARITHMETIC with
// hand-fed tick/travel numbers; the integrated per-move accumulator that PRODUCES
// those counts (arc = dist·|Δθ| → wheelCalMeterQuantum/StepFor) lives in the DOM
// shell and is device-validated, not exercised here.

test('angle mode: equal rotation at a larger radius yields LOWER tick density (the falloff the bug is)', () => {
  var rotationDeg = 90;
  var stepDeg = WHEEL_CAL.HAPTIC_STEP_DEG;
  var ticks = rotationDeg / stepDeg;                 // radius-independent tick count
  // finger travel for that rotation = arc length = r · θ(rad)
  function densityAt(radiusPx) {
    var travel = radiusPx * rotationDeg * Math.PI / 180;
    return wheelCalDensity(ticks, travel);
  }
  var inner = densityAt(40), outer = densityAt(120);
  assert.ok(inner > outer, 'inner-radius density must exceed outer-radius density in angle mode');
  // 3× radius ⇒ ~1/3 the density
  assert.ok(Math.abs(inner / outer - 3) < 0.01, 'density scales inversely with radius (≈3× here)');
});

test('arc mode: equal FINGER TRAVEL yields the SAME tick density at any radius (the candidate fix is uniform)', () => {
  var travel = 240; // px of finger travel, same everywhere
  var stepArc = WHEEL_CAL.DEFAULT_STEP_ARC_PX;
  var ticks = travel / stepArc; // arc mode meters travel directly
  var d = wheelCalDensity(ticks, travel);
  // density = (travel/step)/travel*100 = 100/step, independent of radius
  assert.ok(Math.abs(d - 100 / stepArc) < 1e-9, 'arc-mode density is 100/step regardless of radius');
});
