'use strict';

// [UNIT] Wave 6 (scan extraction) -- lib/scan/identity.js, required DIRECTLY:
//
//   - extractYtdlpVideoId: the trailing ` [<11-char id>]` / `_[...]` bracket.
//   - youtubeIdFromUrlString: an untrusted URL-ish string through the SAME
//     classifySingleVideo gate the yt-dlp module uses (fails closed).
//   - deriveScanYoutubeId: bracket-if-yt-dlp-rooted, else the embedded URL.
//   - deriveReleaseDate: embedded date wins, mtime is the last resort.
//
// test/unit/youtube-id-derivation.test.js covers the same helpers through
// server.js's re-export; this file is the direct-module door, so a broken
// re-export shows up as a DIFFERENCE between the two rather than as silence.
// (This file deliberately does NOT reach for server.js at all - it needs no
// database, and test/unit/test-isolation-parity.test.js matches the require
// pattern in raw source, comments included.)

const { test } = require('node:test');
const assert = require('node:assert');

const {
  extractYtdlpVideoId,
  youtubeIdFromUrlString,
  deriveScanYoutubeId,
  deriveReleaseDate,
} = require('../../lib/scan/identity');

// ---- extractYtdlpVideoId ----------------------------------------------------

test('extractYtdlpVideoId: a space-separated bracket suffix yields the 11-char id', () => {
  assert.strictEqual(extractYtdlpVideoId('Never Gonna Give You Up [dQw4w9WgXcQ]'), 'dQw4w9WgXcQ');
});

test('extractYtdlpVideoId: an UNDERSCORE separator is accepted too (the metube-era spelling)', () => {
  assert.strictEqual(extractYtdlpVideoId('Some_Title_[dQw4w9WgXcQ]'), 'dQw4w9WgXcQ');
});

test('extractYtdlpVideoId: the id charset and LENGTH are bounded by the regex itself', () => {
  const eleven = 'ab_-XYZ0912';
  assert.strictEqual(eleven.length, 11, 'precondition: the fixture really is 11 chars');
  assert.strictEqual(extractYtdlpVideoId(`T [${eleven}]`), eleven, 'underscore and hyphen are in the charset');
  assert.strictEqual(extractYtdlpVideoId('T [dQw4w9WgXcQQ]'), null, '12 chars is not an id');
  assert.strictEqual(extractYtdlpVideoId('T [dQw4w9WgXc]'), null, '10 chars is not an id');
  assert.strictEqual(extractYtdlpVideoId('T [dQw4w9WgXc!]'), null, '! is outside [A-Za-z0-9_-]');
});

test('extractYtdlpVideoId: an ordinary library filename yields null', () => {
  assert.strictEqual(extractYtdlpVideoId('Holiday 2019'), null);
  assert.strictEqual(extractYtdlpVideoId('[dQw4w9WgXcQ]'), null, 'no separator before the bracket');
  assert.strictEqual(extractYtdlpVideoId(''), null);
});

test('extractYtdlpVideoId: the bracket must be the LAST thing in the basename', () => {
  assert.strictEqual(extractYtdlpVideoId('T [dQw4w9WgXcQ] extra'), null);
});

test('extractYtdlpVideoId: a control byte inside the basename never matches (fails closed, never throws)', () => {
  // No raw control bytes in source - build the NUL programmatically.
  const NUL = String.fromCharCode(0);
  assert.strictEqual(extractYtdlpVideoId(`T [dQw4w9WgX${NUL}Q]`), null, 'a NUL is outside the id charset');
  assert.strictEqual(extractYtdlpVideoId(`T ${NUL}[dQw4w9WgXcQ]`), null,
    'the separator must be a literal space or underscore IMMEDIATELY before the bracket');
});

// ---- youtubeIdFromUrlString -------------------------------------------------

test('youtubeIdFromUrlString: a canonical watch URL yields its id', () => {
  assert.strictEqual(youtubeIdFromUrlString('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('youtubeIdFromUrlString: non-video and non-YouTube shapes fail CLOSED', () => {
  assert.strictEqual(youtubeIdFromUrlString('https://www.youtube.com/@SomeChannel'), null);
  assert.strictEqual(youtubeIdFromUrlString('https://evil.example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.strictEqual(youtubeIdFromUrlString('not a url'), null);
});

test('youtubeIdFromUrlString: a non-string or empty input is null, never a throw', () => {
  for (const bad of ['', null, undefined, 42, {}, []]) {
    assert.strictEqual(youtubeIdFromUrlString(bad), null, `${JSON.stringify(bad)} -> null`);
  }
});

// ---- deriveScanYoutubeId ----------------------------------------------------

const info = (name, ext) => ({ name: name + ext, ext });

test('deriveScanYoutubeId: under a yt-dlp root the FILENAME bracket wins', () => {
  const id = deriveScanYoutubeId(
    '/downloads/Title [dQw4w9WgXcQ].mp4',
    info('Title [dQw4w9WgXcQ]', '.mp4'),
    ['/downloads'],
    'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  );
  assert.strictEqual(id, 'dQw4w9WgXcQ');
});

test('deriveScanYoutubeId: OUTSIDE a yt-dlp root the bracket is ignored - only the embedded tag counts', () => {
  const id = deriveScanYoutubeId(
    '/library/Title [dQw4w9WgXcQ].mp4',
    info('Title [dQw4w9WgXcQ]', '.mp4'),
    ['/downloads'],
    'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  );
  assert.strictEqual(id, 'aaaaaaaaaaa',
    'a coincidentally-bracketed library file must never be read as yt-dlp provenance');
});

test('deriveScanYoutubeId: a bracket-less yt-dlp-rooted file falls through to the embedded tag', () => {
  const id = deriveScanYoutubeId(
    '/downloads/Plain.mp4', info('Plain', '.mp4'), ['/downloads'],
    'https://youtu.be/dQw4w9WgXcQ',
  );
  assert.strictEqual(id, 'dQw4w9WgXcQ');
});

test('deriveScanYoutubeId: no bracket and no usable tag -> null (callers persist the null)', () => {
  assert.strictEqual(deriveScanYoutubeId('/library/Plain.mp4', info('Plain', '.mp4'), [], null), null);
  assert.strictEqual(
    deriveScanYoutubeId('/library/Plain.mp4', info('Plain', '.mp4'), [], 'https://example.com/x'),
    null, 'a non-YouTube tag does not survive the gate');
});

test('deriveScanYoutubeId: an empty yt-dlp root list means no root matches (the module is off)', () => {
  assert.strictEqual(
    deriveScanYoutubeId('/downloads/T [dQw4w9WgXcQ].mp4', info('T [dQw4w9WgXcQ]', '.mp4'), [], null),
    null);
});

// ---- deriveReleaseDate ------------------------------------------------------

test('deriveReleaseDate: an embedded date WINS over mtime', () => {
  const embedded = Date.UTC(2011, 4, 17); // a fixed historical date, not near-today
  const mtime = Date.now();
  assert.strictEqual(deriveReleaseDate(embedded, mtime), embedded);
});

test('deriveReleaseDate: no embedded date -> mtime (the fragile-but-honest last resort)', () => {
  const mtime = Date.now() - 86_400_000; // dynamic offset, never a literal
  assert.strictEqual(deriveReleaseDate(null, mtime), mtime);
  assert.strictEqual(deriveReleaseDate(undefined, mtime), mtime);
  assert.strictEqual(deriveReleaseDate(NaN, mtime), mtime);
});

test('deriveReleaseDate: epoch 0 embedded is NOT finite-but-skipped - zero is a real value', () => {
  assert.strictEqual(deriveReleaseDate(0, Date.now()), 0,
    'Number.isFinite(0) is true, so the embedded branch takes it');
});

test('deriveReleaseDate: an unusable mtime is the only path to null', () => {
  assert.strictEqual(deriveReleaseDate(null, 0), null, 'mtime must be > 0');
  assert.strictEqual(deriveReleaseDate(null, -5), null);
  assert.strictEqual(deriveReleaseDate(null, null), null);
  assert.strictEqual(deriveReleaseDate(null, undefined), null);
});

test('deriveReleaseDate: the SCHEMA-ONLY BACKFILL call shape (embeddedMs=null) forces the mtime branch', () => {
  const mtime = Date.now() - 3_600_000;
  assert.strictEqual(deriveReleaseDate(null, mtime), mtime,
    'the backfill path must never need a fresh probe - the thumbnail-backfill-regression lesson');
});
