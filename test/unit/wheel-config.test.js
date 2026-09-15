'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const WC = require('../../public/js/wheel-config.js');

// A minimal localStorage-like store for the read/write round-trip tests.
function fakeStore(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    _map: m,
  };
}

test('DEFAULT is exactly today\'s shipping feel (a silent-feel-change guard)', () => {
  // If any of these drifts, the wheel silently changes for everyone who never
  // opened the test menu - the whole point of "default == today" is this lock.
  assert.deepEqual(WC.DEFAULT, { engine: 'ghost', dither: 18, detent: 3.75, capture: '8px', buzz: true });
  // The Classic's own numbers, carried on CONST (the ex-duplicated constants).
  assert.equal(WC.CONST.STEP_DEFAULT, 3.75);
  assert.equal(WC.CONST.MIN_MS, 8);
  assert.equal(WC.CONST.BIAS_DEFAULT, 18);
  assert.equal(WC.CONST.DEAD_FRAC, 0.20);
});

test('normalize clamps every field to a legal value; garbage -> default', () => {
  // Empty / null -> the full default.
  assert.deepEqual(WC.normalize(null), WC.DEFAULT);
  assert.deepEqual(WC.normalize(undefined), WC.DEFAULT);
  assert.deepEqual(WC.normalize({}), WC.DEFAULT);
  // Each field independently clamped; unknown values fall to the default.
  assert.equal(WC.normalize({ engine: 'sweep' }).engine, 'sweep');
  assert.equal(WC.normalize({ engine: 'nope' }).engine, 'ghost');
  assert.equal(WC.normalize({ dither: 24 }).dither, 24);
  assert.equal(WC.normalize({ dither: '14' }).dither, 14, 'numeric string coerces');
  assert.equal(WC.normalize({ dither: 17 }).dither, 18, 'off-list number -> default');
  assert.equal(WC.normalize({ detent: 8 }).detent, 8);
  assert.equal(WC.normalize({ detent: 9 }).detent, 3.75, 'off-list detent -> default');
  assert.equal(WC.normalize({ capture: 'press' }).capture, 'press');
  assert.equal(WC.normalize({ capture: 'weird' }).capture, '8px');
  // buzz is ON unless EXPLICITLY false.
  assert.equal(WC.normalize({ buzz: false }).buzz, false);
  assert.equal(WC.normalize({ buzz: true }).buzz, true);
  assert.equal(WC.normalize({}).buzz, true, 'absent buzz stays on');
  assert.equal(WC.normalize({ buzz: 0 }).buzz, true, 'only literal false turns it off');
});

test('read/write round-trip through a store; a bad read -> default, never a throw', () => {
  const store = fakeStore();
  const written = WC.write({ engine: 'sweep', dither: 24, detent: 5.5, capture: 'press', buzz: false }, store);
  assert.deepEqual(written, { engine: 'sweep', dither: 24, detent: 5.5, capture: 'press', buzz: false });
  assert.deepEqual(WC.read(store), written, 'what was written reads back identically');
  // A corrupt payload falls to the default rather than throwing.
  const bad = fakeStore({ [WC.KEY]: '{not json' });
  assert.deepEqual(WC.read(bad), WC.DEFAULT);
  // A partial payload is filled with defaults for the missing fields.
  const partial = fakeStore({ [WC.KEY]: JSON.stringify({ engine: 'sweep' }) });
  assert.deepEqual(WC.read(partial), { engine: 'sweep', dither: 18, detent: 3.75, capture: '8px', buzz: true });
  // write persists a NORMALIZED value even from garbage input.
  const s2 = fakeStore();
  WC.write({ engine: 'grid', dither: 999, capture: 'x' }, s2);
  assert.deepEqual(JSON.parse(s2._map.get(WC.KEY)), { engine: 'grid', dither: 18, detent: 3.75, capture: '8px', buzz: true });
});

test('effectiveEngine: Grid is test-only -> Ghost on the real wheel; others pass through', () => {
  assert.equal(WC.effectiveEngine({ engine: 'grid' }), 'ghost', 'grid never runs on the real wheel');
  assert.equal(WC.effectiveEngine({ engine: 'ghost' }), 'ghost');
  assert.equal(WC.effectiveEngine({ engine: 'sweep' }), 'sweep');
  assert.equal(WC.effectiveEngine({}), 'ghost', 'default is ghost');
  assert.equal(WC.effectiveEngine({ engine: 'bogus' }), 'ghost');
});

test('sweepOffset: the shared FEEL math crosses the midline once per detent', () => {
  // 0 at the notch centres, +-dither at the quarter points; both files call THIS.
  assert.equal(WC.sweepOffset(0, 18, 3.75), 0);
  assert.ok(Math.abs(WC.sweepOffset(3.75, 18, 3.75)) < 1e-9, 'a full detent returns to 0 (sin(pi))');
  assert.ok(Math.abs(WC.sweepOffset(3.75 / 2, 18, 3.75) - 18) < 1e-9, 'peak = +dither at the half-detent');
  assert.equal(WC.sweepOffset(0, 24, 5.5), 0, 'amplitude + detent are both tunable');
  // A zero/negative detent guards against /0 (falls to the default step).
  assert.equal(WC.sweepOffset(0, 18, 0), 0);
  assert.ok(Number.isFinite(WC.sweepOffset(2, 18, 0)));
});
