'use strict';

// C5-local (v1.24, T5) -- the release-date capture helpers exported from
// server.js: `parseEmbeddedReleaseDateMs` (pull an embedded date out of
// ffprobe's format tags) and `deriveReleaseDate` (the embedded->mtime
// precedence resolver). Both are pure and unit-tested here without any real
// ffprobe/ffmpeg binary -- isolate DATA_DIR so requiring the server is
// side-effect-free (own process per test file), same convention as
// ffprobe-tags.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { parseEmbeddedReleaseDateMs, deriveReleaseDate } = require('../../server');

// ---- parseEmbeddedReleaseDateMs ----

test('parseEmbeddedReleaseDateMs: extracts an ISO creation_time tag', () => {
  const j = { format: { tags: { creation_time: '2023-04-01T12:00:00.000000Z' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.parse('2023-04-01T12:00:00.000000Z'));
});

test('parseEmbeddedReleaseDateMs: extracts a compact YYYYMMDD date tag (yt-dlp --embed-metadata shape)', () => {
  const j = { format: { tags: { date: '20230401' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.UTC(2023, 3, 1));
});

test('parseEmbeddedReleaseDateMs: extracts a dashed ISO date tag', () => {
  const j = { format: { tags: { date: '2023-04-01' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.parse('2023-04-01'));
});

test('parseEmbeddedReleaseDateMs: falls back to a bare year tag', () => {
  const j = { format: { tags: { year: '1999' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.parse('1999'));
});

test('parseEmbeddedReleaseDateMs: creation_time takes precedence over date and year', () => {
  const j = { format: { tags: {
    creation_time: '2023-04-01T00:00:00.000000Z',
    date: '20200101',
    year: '1999',
  } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.parse('2023-04-01T00:00:00.000000Z'));
});

test('parseEmbeddedReleaseDateMs: date takes precedence over year when creation_time is absent', () => {
  const j = { format: { tags: { date: '20200101', year: '1999' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.UTC(2020, 0, 1));
});

test('parseEmbeddedReleaseDateMs: is case-insensitive on tag keys', () => {
  const j = { format: { tags: { CREATION_TIME: '2023-04-01T00:00:00.000000Z' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.parse('2023-04-01T00:00:00.000000Z'));
});

test('parseEmbeddedReleaseDateMs: accepts a raw JSON string too', () => {
  const s = JSON.stringify({ format: { tags: { date: '2020-01-01' } } });
  assert.equal(parseEmbeddedReleaseDateMs(s), Date.parse('2020-01-01'));
});

test('parseEmbeddedReleaseDateMs: returns null on malformed/empty/missing tags', () => {
  assert.equal(parseEmbeddedReleaseDateMs('{ not json'), null);
  assert.equal(parseEmbeddedReleaseDateMs(null), null);
  assert.equal(parseEmbeddedReleaseDateMs({}), null);
  assert.equal(parseEmbeddedReleaseDateMs({ format: {} }), null);
  assert.equal(parseEmbeddedReleaseDateMs({ format: { tags: {} } }), null);
});

test('parseEmbeddedReleaseDateMs: returns null on an unparseable date string (never throws)', () => {
  const j = { format: { tags: { date: 'not-a-real-date' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), null);
});

test('parseEmbeddedReleaseDateMs: skips an empty-string date tag and falls through to year', () => {
  const j = { format: { tags: { date: '   ', year: '2001' } } };
  assert.equal(parseEmbeddedReleaseDateMs(j), Date.parse('2001'));
});

// ---- deriveReleaseDate (embedded -> mtime precedence) ----

test('deriveReleaseDate: prefers the embedded date over mtime when both are present', () => {
  const embedded = Date.UTC(2020, 0, 1);
  const mtime = Date.UTC(2024, 0, 1);
  assert.equal(deriveReleaseDate(embedded, mtime), embedded);
});

test('deriveReleaseDate: falls back to mtime when the embedded date is null (no embedded tag / no probe)', () => {
  const mtime = Date.UTC(2024, 0, 1);
  assert.equal(deriveReleaseDate(null, mtime), mtime);
});

test('deriveReleaseDate: falls back to mtime when the embedded date is NaN (unparseable)', () => {
  const mtime = Date.UTC(2024, 0, 1);
  assert.equal(deriveReleaseDate(NaN, mtime), mtime);
});

test('deriveReleaseDate: returns null when neither embedded nor mtime is usable', () => {
  assert.equal(deriveReleaseDate(null, undefined), null);
  assert.equal(deriveReleaseDate(null, NaN), null);
  assert.equal(deriveReleaseDate(null, 0), null, 'a zero/epoch mtime is treated as unusable, not a real timestamp');
});

test('deriveReleaseDate: a positive embedded value of 0 is impossible in practice but negative/zero embedded still falls through safely', () => {
  const mtime = Date.UTC(2024, 0, 1);
  // Date.UTC(1970,0,1) === 0, which is falsy but IS finite -- must still win
  // over the mtime fallback (Number.isFinite(0) is true).
  assert.equal(deriveReleaseDate(0, mtime), 0);
});
