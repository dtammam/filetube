'use strict';

// [UNIT] v1.54 - real subscriber counts, client half: the compact formatter,
// the ONE subscriber-label resolver (real -> compact + ISO as-of; absent ->
// the unchanged deterministic mock), and the paint-plan wiring so the seed
// pre-paint and hydration render the identical string. Divergent fixtures.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  formatCompactCount, resolveSubscriberLabel, formatViewCountCaptureDate,
  deriveWatchPaintPlan, resolveViewCountLabel,
} = require('../../public/js/common.js');

test('formatCompactCount: YouTube-style boundaries', () => {
  assert.equal(formatCompactCount(0), '0');
  assert.equal(formatCompactCount(999), '999');
  assert.equal(formatCompactCount(1000), '1K');
  assert.equal(formatCompactCount(1234), '1.2K');
  assert.equal(formatCompactCount(9949), '9.9K');
  assert.equal(formatCompactCount(24000), '24K');
  assert.equal(formatCompactCount(999499), '999K');
  assert.equal(formatCompactCount(1200000), '1.2M');
  assert.equal(formatCompactCount(113000000), '113M');
  assert.equal(formatCompactCount(1500000000), '1.5B');
  assert.equal(formatCompactCount(-5), '0');
  assert.equal(formatCompactCount(2.5), '0', 'non-integers are never a count');
});

test('formatViewCountCaptureDate: ISO YYYY-MM-DD (Dean-approved format change)', () => {
  assert.equal(formatViewCountCaptureDate(Date.UTC(2026, 6, 29, 15, 30)), '2026-07-29');
});

test('resolveSubscriberLabel: a captured count renders compact with its ISO as-of date', () => {
  const label = resolveSubscriberLabel({
    sourceFollowerCount: 1234567,
    sourceFollowerCountCapturedAt: Date.UTC(2026, 6, 29),
  }, 'Zéphyr Films');
  assert.equal(label, '1.2M subscribers as of 2026-07-29');
});

test('resolveSubscriberLabel: zero is a real count; an undated count makes no as-of claim', () => {
  assert.equal(resolveSubscriberLabel({ sourceFollowerCount: 0, sourceFollowerCountCapturedAt: Date.UTC(2026, 6, 29) }, 'X'),
    '0 subscribers as of 2026-07-29', 'a brand-new channel really has 0');
  assert.equal(resolveSubscriberLabel({ sourceFollowerCount: 24000 }, 'X'), '24K subscribers',
    'no capturedAt -> no provenance claim, never a guessed date');
  assert.equal(resolveSubscriberLabel({ sourceFollowerCount: 24000, sourceFollowerCountCapturedAt: 9e15 }, 'X'),
    '24K subscribers', 'an out-of-range timestamp is not a date (the Invalid Date class)');
});

test('resolveSubscriberLabel: no capture -> the deterministic mock, unchanged posture', () => {
  const mock = resolveSubscriberLabel({}, 'Zéphyr Films');
  assert.match(mock, /subscribers$/);
  assert.equal(mock, resolveSubscriberLabel({ sourceFollowerCount: 'lots' }, 'Zéphyr Films'),
    'a garbage count falls back identically (deterministic by channel name)');
});

test('paint plan: subsLabel is the resolver output verbatim - real count on a full item, mock otherwise', () => {
  const real = deriveWatchPaintPlan({
    id: 'a1b2c3d4e5f6', title: 'T', size: 10, filePath: '/x/y.mp4', ext: '.mp4',
    sourceFollowerCount: 24000, sourceFollowerCountCapturedAt: Date.UTC(2026, 6, 29),
  }, 'Zéphyr Films');
  assert.equal(real.subsLabel, '24K subscribers as of 2026-07-29');
  const mock = deriveWatchPaintPlan({ id: 'a1b2c3d4e5f6', title: 'T' }, 'Zéphyr Films');
  assert.match(mock.subsLabel, /subscribers$/);
});

test('view-count label now dates in ISO end-to-end', () => {
  const label = resolveViewCountLabel({
    id: 'a1b2c3d4e5f6', size: 5, sourceViewCount: 42,
    sourceViewCountCapturedAt: Date.UTC(2026, 6, 1), addedAt: Date.UTC(2025, 0, 1),
  }, { detailed: true });
  assert.equal(label, '42 views as of 2026-07-01');
});
