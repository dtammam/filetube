'use strict';

// [UNIT] v1.41.0 — the pure helpers behind the Stats page's new Books inventory
// + About/version block (Dean). The DOM rendering (stats.js) + the live
// /api/stats assembly are validated on-device; these lock the aggregation and
// version-parse contracts.

const { test } = require('node:test');
const assert = require('node:assert');

const { computeBookStats, computeNarratedCount, computeBookFolderBreakdown } = require('../../lib/stats.js');
const { parseEngineVersion } = require('../../lib/books/tts-config.js');

// ---- computeBookStats -------------------------------------------------------

test('computeBookStats: empty / malformed input yields a fully-zeroed shape (never throws)', () => {
  for (const input of [undefined, null, {}, 'nope', 42]) {
    const s = computeBookStats(input, undefined);
    assert.strictEqual(s.count, 0);
    assert.strictEqual(s.totalSizeBytes, 0);
    assert.deepStrictEqual(s.byFormat, { epub: { count: 0, totalSizeBytes: 0 }, pdf: { count: 0, totalSizeBytes: 0 } });
    assert.deepStrictEqual(s.byFolder, []);
    assert.strictEqual(s.narratedCount, 0);
  }
});

test('computeBookStats: counts, total size, EPUB/PDF split, and per-folder breakdown', () => {
  const items = {
    a: { format: 'epub', size: 100, folderName: 'Sci-Fi' },
    b: { format: 'pdf', size: 50, folderName: 'Sci-Fi' },
    c: { format: 'epub', size: 200, folderName: 'Business' },
    d: { format: 'epub', size: 10, folderName: '' }, // blank folder -> excluded from byFolder
  };
  const s = computeBookStats(items, {});
  assert.strictEqual(s.count, 4);
  assert.strictEqual(s.totalSizeBytes, 360);
  assert.deepStrictEqual(s.byFormat.epub, { count: 3, totalSizeBytes: 310 });
  assert.deepStrictEqual(s.byFormat.pdf, { count: 1, totalSizeBytes: 50 });
  // Sorted count-desc then name-asc; blank-folder book excluded.
  assert.deepStrictEqual(s.byFolder, [
    { folderName: 'Sci-Fi', count: 2, totalSizeBytes: 150 },
    { folderName: 'Business', count: 1, totalSizeBytes: 200 },
  ]);
});

test('computeBookStats: a malformed/negative size never poisons the total (safeNumber)', () => {
  const items = { a: { format: 'epub', size: 'huge', folderName: 'X' }, b: { format: 'pdf', size: -5, folderName: 'X' } };
  const s = computeBookStats(items, {});
  assert.strictEqual(s.totalSizeBytes, 0);
});

// ---- computeNarratedCount ---------------------------------------------------

test('computeNarratedCount: counts books with at least one READY chapter, ignores processing/failed and orphans', () => {
  const items = { a: {}, b: {}, c: {} };
  const audio = {
    a: { 0: { status: 'ready' }, 1: { status: 'processing' } }, // narrated (has a ready chapter)
    b: { 0: { status: 'processing' }, 1: { status: 'failed' } }, // NOT narrated
    z: { 0: { status: 'ready' } }, // orphan: not in items -> not counted
  };
  assert.strictEqual(computeNarratedCount(items, audio), 1);
});

test('computeNarratedCount: missing/malformed audio map is 0', () => {
  assert.strictEqual(computeNarratedCount({ a: {} }, undefined), 0);
  assert.strictEqual(computeNarratedCount({ a: {} }, null), 0);
  assert.strictEqual(computeNarratedCount({ a: {} }, {}), 0);
});

test('computeBookFolderBreakdown: size-only rows (no duration segment for books)', () => {
  const rows = computeBookFolderBreakdown([{ folderName: 'F', size: 5 }, { folderName: 'F', size: 5 }]);
  assert.deepStrictEqual(rows, [{ folderName: 'F', count: 2, totalSizeBytes: 10 }]);
  assert.ok(!('totalDurationSeconds' in rows[0]), 'book rows carry no duration');
});

// ---- parseEngineVersion (TTS) -----------------------------------------------

test('parseEngineVersion: extracts the espeak-ng version from its --version banner', () => {
  assert.strictEqual(parseEngineVersion('espeak-ng', 'eSpeak NG text-to-speech: 1.51  Data at: /usr/share/espeak-ng-data'), '1.51');
  assert.strictEqual(parseEngineVersion('espeak-ng', 'eSpeak NG text-to-speech: 1.52.0'), '1.52.0');
});

test('parseEngineVersion: piper returns null (its --version output is not a trustworthy version string)', () => {
  assert.strictEqual(parseEngineVersion('piper', 'piper 1.2.3'), null);
  assert.strictEqual(parseEngineVersion('piper', 'anything 9.9'), null);
});

test('parseEngineVersion: missing/garbage input is null (never throws)', () => {
  assert.strictEqual(parseEngineVersion('espeak-ng', undefined), null);
  assert.strictEqual(parseEngineVersion('espeak-ng', ''), null);
  assert.strictEqual(parseEngineVersion('espeak-ng', 'no digits here'), null);
});
