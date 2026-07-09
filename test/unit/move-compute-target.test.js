'use strict';

// [UNIT] C1 (v1.24 UX Round, Wave 3) -- `computeMoveTarget`'s path
// confinement, the FOCUSED two-reviewer-gate surface for T9 alongside the
// scan-survival regression test (test/integration/move-scan-survives.test.js).
//
// `computeMoveTarget` is PURE (no filesystem access at all) so this suite
// exercises the confinement decision directly and exhaustively, mirroring
// `lib/ytdlp/args.js`'s own `isPathUnder`/`resolveChannelDir` confinement
// discipline: resolve both sides, then require exact equality OR
// `startsWith(root + path.sep)` -- never a bare string-prefix check, which a
// sibling directory sharing a prefix would defeat (the adversarial case this
// suite pins down explicitly below).

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { computeMoveTarget } = require('../../server');

test('accepts a target that IS an allowed root itself', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/other', ['/media/other']);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.newPath, path.join('/media/other', 'movie.mp4'));
});

test('accepts a target that is a NESTED descendant of an allowed root', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/lib/subfolder/deeper', ['/media/lib']);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.newPath, path.join('/media/lib/subfolder/deeper', 'movie.mp4'));
});

test('rejects a target completely outside every allowed root -- BEFORE any filesystem op (pure function)', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/etc/passwd-dir', ['/media/lib']);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /outside/i);
});

test('ADVERSARIAL: rejects a sibling directory that merely shares a string PREFIX with an allowed root', () => {
  // "/media/lib2" starts with the literal characters "/media/lib" but is a
  // completely different, non-nested directory -- a naive `startsWith(root)`
  // check (no separator) would wrongly let this through.
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/lib2', ['/media/lib']);
  assert.strictEqual(result.ok, false, 'a sibling dir sharing a string prefix must NOT be confused with a nested descendant');
});

test('ADVERSARIAL: rejects a traversal attempt (../) that resolves outside every allowed root', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/lib/../../etc', ['/media/lib']);
  assert.strictEqual(result.ok, false);
});

test('accepts a traversal-shaped target that still RESOLVES back inside an allowed root', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/lib/sub/../other', ['/media/lib']);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.newPath, path.join('/media/lib/other', 'movie.mp4'));
});

test('rejects when no allowed roots are configured at all', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/lib', []);
  assert.strictEqual(result.ok, false);
});

test('rejects when allowedRoots is missing/malformed (fails safe, never throws)', () => {
  assert.doesNotThrow(() => computeMoveTarget('/media/lib/movie.mp4', '/media/lib', undefined));
  assert.strictEqual(computeMoveTarget('/media/lib/movie.mp4', '/media/lib', undefined).ok, false);
  assert.strictEqual(computeMoveTarget('/media/lib/movie.mp4', '/media/lib', null).ok, false);
  assert.strictEqual(computeMoveTarget('/media/lib/movie.mp4', '/media/lib', 'not-an-array').ok, false);
});

test('ignores a non-string entry inside allowedRoots rather than throwing', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/other', [null, 42, '/media/other']);
  assert.strictEqual(result.ok, true);
});

test('rejects a non-string filePath', () => {
  assert.strictEqual(computeMoveTarget(null, '/media/lib', ['/media/lib']).ok, false);
  assert.strictEqual(computeMoveTarget(undefined, '/media/lib', ['/media/lib']).ok, false);
  assert.strictEqual(computeMoveTarget(42, '/media/lib', ['/media/lib']).ok, false);
});

test('rejects a missing/empty/whitespace-only targetFolder', () => {
  assert.strictEqual(computeMoveTarget('/media/lib/movie.mp4', '', ['/media/lib']).ok, false);
  assert.strictEqual(computeMoveTarget('/media/lib/movie.mp4', '   ', ['/media/lib']).ok, false);
  assert.strictEqual(computeMoveTarget('/media/lib/movie.mp4', undefined, ['/media/lib']).ok, false);
  assert.strictEqual(computeMoveTarget('/media/lib/movie.mp4', null, ['/media/lib']).ok, false);
});

test('rejects moving a file to the folder it is ALREADY in (source === destination)', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/lib', ['/media/lib']);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /same file/i);
});

test('preserves the basename exactly, including unicode/spaces, when building newPath', () => {
  const result = computeMoveTarget('/media/lib/My Vacation été.mp4', '/media/other', ['/media/other']);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.newPath, path.join('/media/other', 'My Vacation été.mp4'));
});

test('never mutates its inputs (pure)', () => {
  const allowedRoots = ['/media/lib'];
  const snapshot = [...allowedRoots];
  computeMoveTarget('/media/lib/movie.mp4', '/media/lib/sub', allowedRoots);
  assert.deepStrictEqual(allowedRoots, snapshot);
});
