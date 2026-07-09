'use strict';

// [UNIT] C4 (v1.24 UX Round, Wave 3) -- the pure display-formatting helpers
// in public/js/stats.js (the retro "fun stats" dashboard's own client
// script). The DOM-rendering functions around them are untested-by-necessity
// (mirrors the rest of this app's client scripts -- see e.g. setup.js/
// player.js's own module.exports guard), but these are pure and exercised
// directly here.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  formatCount, formatTotalDuration, formatByteSize, formatItemDuration, formatRelativeDate, shortenChannelLabel,
} = require('../../public/js/stats.js');

// ---- formatCount ------------------------------------------------------------

test('formatCount: adds thousands separators for large counts', () => {
  assert.equal(formatCount(1234567), '1,234,567');
});

test('formatCount: leaves small counts unseparated', () => {
  assert.equal(formatCount(42), '42');
  assert.equal(formatCount(0), '0');
});

test('formatCount: a non-finite/negative input fails safe to "0", never throws', () => {
  assert.equal(formatCount(NaN), '0');
  assert.equal(formatCount(-5), '0');
  assert.equal(formatCount(undefined), '0');
  assert.equal(formatCount('not-a-number'), '0');
});

// ---- formatTotalDuration -----------------------------------------------------

test('formatTotalDuration: shows days+hours once the total crosses a day', () => {
  const seconds = (2 * 86400) + (5 * 3600) + (40 * 60); // 2d 5h 40m
  assert.equal(formatTotalDuration(seconds), '2d 5h');
});

test('formatTotalDuration: shows hours+minutes under a day', () => {
  const seconds = (3 * 3600) + (20 * 60); // 3h 20m
  assert.equal(formatTotalDuration(seconds), '3h 20m');
});

test('formatTotalDuration: shows minutes-only under an hour', () => {
  assert.equal(formatTotalDuration(42 * 60), '42m');
});

test('formatTotalDuration: zero/non-finite/negative input fails safe to "0m"', () => {
  assert.equal(formatTotalDuration(0), '0m');
  assert.equal(formatTotalDuration(NaN), '0m');
  assert.equal(formatTotalDuration(-100), '0m');
  assert.equal(formatTotalDuration(undefined), '0m');
});

// ---- formatByteSize -----------------------------------------------------------

test('formatByteSize: converts to the appropriate unit', () => {
  assert.equal(formatByteSize(0), '0 B');
  assert.equal(formatByteSize(1536), '1.5 KB');
  assert.equal(formatByteSize(5 * 1024 * 1024), '5 MB');
  assert.equal(formatByteSize(2 * 1024 * 1024 * 1024), '2 GB');
});

test('formatByteSize: a non-finite/negative input fails safe to "0 B"', () => {
  assert.equal(formatByteSize(NaN), '0 B');
  assert.equal(formatByteSize(-5), '0 B');
  assert.equal(formatByteSize(undefined), '0 B');
});

// ---- formatItemDuration ---------------------------------------------------------

test('formatItemDuration: MM:SS under an hour', () => {
  assert.equal(formatItemDuration(65), '1:05');
});

test('formatItemDuration: H:MM:SS at/over an hour', () => {
  assert.equal(formatItemDuration(3725), '1:02:05');
});

test('formatItemDuration: zero/non-finite/negative input fails safe to "0:00"', () => {
  assert.equal(formatItemDuration(0), '0:00');
  assert.equal(formatItemDuration(NaN), '0:00');
  assert.equal(formatItemDuration(-10), '0:00');
  assert.equal(formatItemDuration(undefined), '0:00');
});

// ---- formatRelativeDate -----------------------------------------------------------

test('formatRelativeDate: renders a past timestamp relative to an injected "now"', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);
  const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
  assert.equal(formatRelativeDate(threeDaysAgo, now), '3 days ago');
});

test('formatRelativeDate: renders minutes/hours for recent timestamps', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);
  assert.equal(formatRelativeDate(now - (30 * 60 * 1000), now), '30 minutes ago');
  assert.equal(formatRelativeDate(now - (5 * 60 * 60 * 1000), now), '5 hours ago');
});

test('formatRelativeDate: a missing/non-finite epochMs fails safe to "unknown date"', () => {
  assert.equal(formatRelativeDate(undefined, Date.now()), 'unknown date');
  assert.equal(formatRelativeDate(NaN, Date.now()), 'unknown date');
});

// ---- shortenChannelLabel ------------------------------------------------------

test('shortenChannelLabel: extracts an @handle from a channel URL', () => {
  assert.equal(shortenChannelLabel('https://www.youtube.com/@somechannel'), '@somechannel');
});

test('shortenChannelLabel: falls back to the raw string on an unparseable/non-URL value', () => {
  assert.equal(shortenChannelLabel('not a url at all'), 'not a url at all');
});

test('shortenChannelLabel: a missing/blank channelUrl reads "Unknown channel"', () => {
  assert.equal(shortenChannelLabel(''), 'Unknown channel');
  assert.equal(shortenChannelLabel(undefined), 'Unknown channel');
  assert.equal(shortenChannelLabel(null), 'Unknown channel');
});

test('shortenChannelLabel: never throws on a malformed URL', () => {
  assert.doesNotThrow(() => shortenChannelLabel('http://'));
});
