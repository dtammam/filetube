'use strict';

// [UNIT] v1.78 device handoff - the card's PURE decisions
// (public/js/common.js).
//
// The runtime around these is a thin fetch/render shell; every rule that can
// actually be WRONG lives in these functions, which is the only reason they
// can be held without a browser. The show/hide decision in particular carries
// three independent suppression rules, and each one of them is a defect the
// user would see: the card offering what this very page is playing, the card
// re-appearing after a dismiss, or the card appearing on the watch page.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldShowHandoffCard, handoffSuppressionToken, formatHandoffHeadline,
  formatHandoffTime, formatHandoffAge, handoffProgressPercent,
  HANDOFF_EXCLUDED_PATHS,
} = require('../../public/js/common.js');

const presence = (over = {}) => ({
  deviceId: 'dev-a', deviceLabel: 'iPhone', kind: 'media', mediaId: 'vid1',
  state: 'playing', position: 754, duration: 2706, ageSeconds: 0,
  title: 'Woodturning a Bowl, Pt. 2', href: '/watch.html?v=vid1', ...over,
});
const ctx = (over = {}) => ({ pathname: '/', localPlayingId: null, dismissedToken: '', ...over });

// ---------------------------------------------------------------------------
// shouldShowHandoffCard
// ---------------------------------------------------------------------------

test('shows for an ordinary presence on a list surface', () => {
  assert.equal(shouldShowHandoffCard(presence(), ctx()), true);
});

test('never shows without a presence', () => {
  assert.equal(shouldShowHandoffCard(null, ctx()), false);
  assert.equal(shouldShowHandoffCard(undefined, ctx()), false);
  assert.equal(shouldShowHandoffCard({}, ctx()), false, 'no mediaId -> nothing to offer');
  assert.equal(shouldShowHandoffCard(presence({ mediaId: '' }), ctx()), false);
});

test('never shows on a dedicated playback/reading surface (ruling 2)', () => {
  for (const pathname of HANDOFF_EXCLUDED_PATHS) {
    assert.equal(shouldShowHandoffCard(presence(), ctx({ pathname })), false, `${pathname} must be excluded`);
  }
  // The list surfaces it IS for.
  for (const pathname of ['/', '/index.html', '/music', '/podcasts', '/history.html', '/books.html']) {
    assert.equal(shouldShowHandoffCard(presence(), ctx({ pathname })), true, `${pathname} must show`);
  }
});

test('never offers what THIS page is already playing (the mid-playback rule)', () => {
  assert.equal(shouldShowHandoffCard(presence({ mediaId: 'vid1' }), ctx({ localPlayingId: 'vid1' })), false);
  // A DIFFERENT item playing locally is not a reason to hide - that is the
  // genuine "you left this on the phone" case.
  assert.equal(shouldShowHandoffCard(presence({ mediaId: 'vid1' }), ctx({ localPlayingId: 'vid2' })), true);
});

test('a dismissal suppresses exactly its own (item, device, state) and nothing else', () => {
  const p = presence();
  const token = handoffSuppressionToken(p);
  assert.equal(shouldShowHandoffCard(p, ctx({ dismissedToken: token })), false, 'dismissed');

  // A different ITEM on the same device is new news.
  assert.equal(shouldShowHandoffCard(presence({ mediaId: 'vid9' }), ctx({ dismissedToken: token })), true);
  // A different DEVICE playing the same item is new news.
  assert.equal(shouldShowHandoffCard(presence({ deviceId: 'dev-z' }), ctx({ dismissedToken: token })), true);
  // A STATE FLIP is new news - dismissing "Playing on iPhone" must not also
  // swallow the "Paused on iPhone" that follows (ruling 2: "until the state
  // changes").
  assert.equal(shouldShowHandoffCard(presence({ state: 'paused' }), ctx({ dismissedToken: token })), true);
});

test('handoffSuppressionToken: distinct on every axis, stable across irrelevant fields', () => {
  const base = handoffSuppressionToken(presence());
  assert.notEqual(base, handoffSuppressionToken(presence({ mediaId: 'other' })));
  assert.notEqual(base, handoffSuppressionToken(presence({ deviceId: 'other' })));
  assert.notEqual(base, handoffSuppressionToken(presence({ state: 'paused' })));
  // Position/age move on every poll; if they were in the token, a dismissal
  // would last exactly one poll cycle.
  assert.equal(base, handoffSuppressionToken(presence({ position: 999, ageSeconds: 42, title: 'x' })));
  assert.equal(handoffSuppressionToken(null), '');
});

// ---------------------------------------------------------------------------
// The rendered strings
// ---------------------------------------------------------------------------

test('headline names the DEVICE, and the paused arm carries the age', () => {
  assert.equal(formatHandoffHeadline(presence()), 'Playing on iPhone');
  assert.equal(formatHandoffHeadline(presence({ state: 'paused', ageSeconds: 18 * 60 })),
    'Paused on iPhone - 18 min ago');
  assert.equal(formatHandoffHeadline(presence({ deviceLabel: '' })), 'Playing on another device');
  assert.equal(formatHandoffHeadline(null), 'Playing on another device');
});

test('headline uses a plain hyphen, never an em dash (repo norm)', () => {
  const s = formatHandoffHeadline(presence({ state: 'paused', ageSeconds: 600 }));
  assert.ok(!/[–—]/.test(s), `no en/em dash in "${s}"`);
});

test('age reads coarsely and never goes negative', () => {
  assert.equal(formatHandoffAge(0), 'just now');
  assert.equal(formatHandoffAge(59), 'just now');
  assert.equal(formatHandoffAge(60), '1 min ago');
  assert.equal(formatHandoffAge(18 * 60), '18 min ago');
  assert.equal(formatHandoffAge(59 * 60), '59 min ago');
  assert.equal(formatHandoffAge(3600), '1 hour ago');
  assert.equal(formatHandoffAge(3 * 3600), '3 hours ago');
  assert.equal(formatHandoffAge(-5), 'just now');
  assert.equal(formatHandoffAge(undefined), 'just now');
  assert.equal(formatHandoffAge(NaN), 'just now');
});

test('time line shows position/duration, and degrades to position alone when duration is unknown', () => {
  assert.equal(formatHandoffTime(754, 2706), '12:34 / 45:06');
  assert.equal(formatHandoffTime(0, 2706), '0:00 / 45:06');
  assert.equal(formatHandoffTime(754, 0), '12:34', 'never "12:34 / 0:00"');
  assert.equal(formatHandoffTime(754, undefined), '12:34');
  assert.equal(formatHandoffTime(754, NaN), '12:34');
  assert.equal(formatHandoffTime(3725, 7200), '1:02:05 / 2:00:00', 'hours roll up');
});

test('progress percent is clamped into 0-100 and never NaN into a style attribute', () => {
  assert.equal(handoffProgressPercent(0, 100), 0);
  assert.equal(handoffProgressPercent(50, 100), 50);
  assert.equal(handoffProgressPercent(100, 100), 100);
  assert.equal(handoffProgressPercent(150, 100), 100, 'clamped: a position past the end cannot overflow the bar');
  assert.equal(handoffProgressPercent(-10, 100), 0);
  assert.equal(handoffProgressPercent(50, 0), 0, 'unknown duration -> empty bar, not a divide-by-zero');
  assert.equal(handoffProgressPercent(50, undefined), 0);
  assert.equal(handoffProgressPercent(NaN, 100), 0);
  for (const v of [handoffProgressPercent(NaN, NaN), handoffProgressPercent(1, -1)]) {
    assert.ok(Number.isFinite(v), 'always a finite number - it goes straight into style.width');
  }
});
