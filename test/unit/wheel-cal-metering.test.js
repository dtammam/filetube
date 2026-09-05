'use strict';

// [UNIT] Pocket Classic wheel test — the pure metering core (setup.js).
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

// ---- the constants still match the real wheel (the anti-drift lock) --------

test('WHEEL_CAL constants are the SAME values skin-surface.js ships — a drifted copy would make the tool lie about the real wheel', () => {
  // skin-surface.js: `var HAPTIC_STEP_DEG = 3.75;` and `var HAPTIC_MIN_MS = 8;`
  const stepMatch = /var HAPTIC_STEP_DEG = ([\d.]+);/.exec(SKIN_SURFACE_JS);
  const minMatch = /var HAPTIC_MIN_MS = (\d+);/.exec(SKIN_SURFACE_JS);
  assert.ok(stepMatch, 'skin-surface.js must declare HAPTIC_STEP_DEG');
  assert.ok(minMatch, 'skin-surface.js must declare HAPTIC_MIN_MS');
  assert.strictEqual(WHEEL_CAL.HAPTIC_STEP_DEG, Number(stepMatch[1]));
  assert.strictEqual(WHEEL_CAL.HAPTIC_MIN_MS, Number(minMatch[1]));
  // the ±18px probe-C bias the ghost placement uses
  assert.match(SKIN_SURFACE_JS, new RegExp('hapBias \\* ' + WHEEL_CAL.BIAS_PX + '\\b'));
});

test('the centre dead-zone fraction is NUMERICALLY equal to skin-surface.js pointerdown Select guard (a 0.20-0.29 drift must not slip a substring match)', () => {
  // Extract the REAL multiplier, don't substring-match it: `r.width * 0.25`
  // still contains `r.width * 0.2`, so a plausible Select-guard widening would
  // slip past a bare /r\.width \* 0\.2/ while the tool kept metering against a
  // stale 0.20 (adversarial WARNING 2).
  const m = /Math\.hypot\([^)]*\) < r\.width \* ([\d.]+)\)/.exec(SKIN_SURFACE_JS);
  assert.ok(m, 'skin-surface.js must guard the centre with a `r.width * <frac>` dead-zone');
  assert.strictEqual(Number(m[1]), WHEEL_CAL.DEAD_FRAC, 'the tool dead-zone must equal the real wheel\'s exactly');
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
