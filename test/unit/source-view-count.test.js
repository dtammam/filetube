'use strict';

// v1.48 item 2 (Dean): "Can we have the view counts taken from the content the
// day of. And have it re-heatable if pulled later. We can still have fake
// stars."
//
// Two seams are covered here: the CAPTURE-side validator that decides what is
// storable (store.parseCapturedViewCount) and the RENDER-side resolver that
// decides what the UI says (common.resolveViewCountLabel).
//
// The single most important property tested below is the field NAME. A library
// item already had a `viewCount` -- the legacy pre-v1.42 LOCAL watch counter,
// which `effectiveViewCount` still honors as a floor. The source count lives at
// `sourceViewCount` precisely so a freshly-downloaded video does not report
// twelve million local plays on the stats page.

const { test } = require('node:test');
const assert = require('node:assert');
const store = require('../../lib/ytdlp/store.js');
const { resolveViewCountLabel, getMockViews } = require('../../public/js/common.js');

const { parseCapturedViewCount, MAX_PLAUSIBLE_VIEW_COUNT } = store;

// ---- capture-side validation ----------------------------------------------

test('parseCapturedViewCount: accepts a plain non-negative integer', () => {
  assert.equal(parseCapturedViewCount(0), 0, 'a brand-new upload genuinely has 0 views');
  assert.equal(parseCapturedViewCount(1), 1);
  assert.equal(parseCapturedViewCount(12345678), 12345678);
});

test('parseCapturedViewCount: accepts a NUMERIC STRING', () => {
  // The %(...)j print selector has rendered fields as strings before, so both
  // shapes have to survive or captures silently vanish.
  assert.equal(parseCapturedViewCount('4200'), 4200);
  assert.equal(parseCapturedViewCount(' 4200 '), 4200);
  assert.equal(parseCapturedViewCount('0'), 0);
});

test('parseCapturedViewCount: rejects non-integers, negatives and junk', () => {
  assert.equal(parseCapturedViewCount(12.5), null, 'a fractional view count would render "12.5 views"');
  assert.equal(parseCapturedViewCount('12.5'), null);
  assert.equal(parseCapturedViewCount(-1), null);
  assert.equal(parseCapturedViewCount('-7'), null);
  assert.equal(parseCapturedViewCount('NA'), null, "yt-dlp's own absent-field placeholder");
  assert.equal(parseCapturedViewCount('abc'), null);
  assert.equal(parseCapturedViewCount(''), null);
  assert.equal(parseCapturedViewCount('   '), null);
  assert.equal(parseCapturedViewCount(null), null);
  assert.equal(parseCapturedViewCount(undefined), null);
  assert.equal(parseCapturedViewCount({}), null);
  assert.equal(parseCapturedViewCount([]), null);
  assert.equal(parseCapturedViewCount(true), null);
});

test('parseCapturedViewCount: rejects NaN and Infinity', () => {
  // JSON.parse of a malformed dump can produce these, and Infinity would reach
  // toLocaleString and print "Infinity views".
  assert.equal(parseCapturedViewCount(NaN), null);
  assert.equal(parseCapturedViewCount(Infinity), null);
  assert.equal(parseCapturedViewCount(-Infinity), null);
  assert.equal(parseCapturedViewCount('Infinity'), null);
});

test('parseCapturedViewCount: enforces the plausibility ceiling', () => {
  assert.equal(parseCapturedViewCount(MAX_PLAUSIBLE_VIEW_COUNT), MAX_PLAUSIBLE_VIEW_COUNT);
  assert.equal(parseCapturedViewCount(MAX_PLAUSIBLE_VIEW_COUNT + 1), null);
  // The real world stays comfortably inside it -- the most-viewed video ever is
  // ~1.5e10, five orders of magnitude below the ceiling.
  assert.equal(parseCapturedViewCount(15_000_000_000), 15_000_000_000);
});

// ---- render-side resolution ------------------------------------------------

test('resolveViewCountLabel: renders a captured count, plainly, on a card', () => {
  const label = resolveViewCountLabel({ id: 'abc123', size: 100, sourceViewCount: 1234567 });
  assert.equal(label, (1234567).toLocaleString() + ' views');
  assert.ok(!label.includes('when downloaded'), 'cards have no room for the qualifier');
});

test('resolveViewCountLabel: the watch page dates the number', () => {
  const label = resolveViewCountLabel({ id: 'abc123', size: 100, sourceViewCount: 1234567 }, { detailed: true });
  assert.equal(label, (1234567).toLocaleString() + ' views when downloaded');
});

test('resolveViewCountLabel: 0 captured views is REAL and never falls back to the mock', () => {
  // The regression this pins: `count && ...` or a truthiness check would treat
  // a genuine 0 as absent and substitute a fabricated number.
  const item = { id: 'abc123', size: 100, sourceViewCount: 0 };
  assert.equal(resolveViewCountLabel(item), '0 views');
  assert.notEqual(resolveViewCountLabel(item), getMockViews('abc123', 100));
});

test('resolveViewCountLabel: singular for exactly one view', () => {
  assert.equal(resolveViewCountLabel({ id: 'a1', size: 1, sourceViewCount: 1 }), '1 view');
  assert.equal(resolveViewCountLabel({ id: 'a1', size: 1, sourceViewCount: 2 }), '2 views');
});

test('resolveViewCountLabel: falls back to the mock when nothing was captured', () => {
  // Every pre-v1.48 download and every non-yt-dlp file takes this path.
  const item = { id: 'abcdef', size: 5000 };
  assert.equal(resolveViewCountLabel(item), getMockViews('abcdef', 5000));
  assert.equal(resolveViewCountLabel(item, { detailed: true }), getMockViews('abcdef', 5000));
});

test('resolveViewCountLabel: an invalid stored count falls back rather than rendering junk', () => {
  const base = { id: 'abcdef', size: 5000 };
  const mock = getMockViews('abcdef', 5000);
  for (const bad of [-5, 12.5, NaN, Infinity, '900', null, undefined, {}]) {
    assert.equal(resolveViewCountLabel({ ...base, sourceViewCount: bad }), mock, `bad value: ${String(bad)}`);
  }
});

test('resolveViewCountLabel: the LEGACY item.viewCount is never mistaken for a source count', () => {
  // THE collision guard. `viewCount` is the local watch counter; an item
  // carrying one but no capture must still render the mock, not "7 views".
  const item = { id: 'abcdef', size: 5000, viewCount: 7 };
  assert.equal(resolveViewCountLabel(item), getMockViews('abcdef', 5000));
});

test('resolveViewCountLabel: source and legacy counts coexist without interfering', () => {
  const item = { id: 'abcdef', size: 5000, viewCount: 7, sourceViewCount: 900000 };
  assert.equal(resolveViewCountLabel(item), (900000).toLocaleString() + ' views');
  assert.equal(item.viewCount, 7, 'the local watch counter is untouched');
});

test('resolveViewCountLabel: tolerates a missing/!odd item without throwing', () => {
  assert.doesNotThrow(() => resolveViewCountLabel(null));
  assert.doesNotThrow(() => resolveViewCountLabel(undefined));
  assert.doesNotThrow(() => resolveViewCountLabel({}));
});
