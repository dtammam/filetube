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

// ---- v1.41.6: the OPTIONAL rename (`opts.newBaseName`) ---------------------
//
// The reheat's import-relocation needs the destination to carry the NATIVE
// yt-dlp filename shape (`<title> [<videoId>].<ext>`), so the move may also
// rename. That is the one place a CALLER-BUILT string re-enters the path layer,
// so it is structurally checked here -- rejected, never normalized.

test('v1.41.6: opts.newBaseName renames the file as part of the move', () => {
  const result = computeMoveTarget('/media/lib/Some Import.mp4', '/dl/Rick Astley', ['/dl'], {
    newBaseName: 'Never Gonna Give You Up [dQw4w9WgXcQ].mp4',
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.newPath, path.join('/dl/Rick Astley', 'Never Gonna Give You Up [dQw4w9WgXcQ].mp4'));
});

test('v1.41.6: omitting opts leaves the source basename byte-identical (every pre-existing caller)', () => {
  const withEmptyOpts = computeMoveTarget('/media/lib/movie.mp4', '/media/other', ['/media/other'], {});
  const withNoOpts = computeMoveTarget('/media/lib/movie.mp4', '/media/other', ['/media/other']);
  assert.strictEqual(withEmptyOpts.newPath, path.join('/media/other', 'movie.mp4'));
  assert.deepStrictEqual(withNoOpts, withEmptyOpts);
});

test('v1.41.6 ADVERSARIAL: a newBaseName carrying a path separator or a traversal segment is REJECTED, never normalized', () => {
  for (const bad of ['../escape.mp4', 'sub/dir.mp4', '..', '.', '', '   ', 'a/../../b.mp4', 'dir/']) {
    const result = computeMoveTarget('/media/lib/movie.mp4', '/media/other', ['/media/other'], { newBaseName: bad });
    assert.strictEqual(result.ok, false, `newBaseName=${JSON.stringify(bad)} must be rejected`);
    assert.match(result.error, /invalid destination file name/i);
  }
});

test('v1.41.6: a non-string newBaseName is ignored (falls back to the source basename) rather than throwing', () => {
  for (const ignored of [undefined, null, 42, {}]) {
    const result = computeMoveTarget('/media/lib/movie.mp4', '/media/other', ['/media/other'], { newBaseName: ignored });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.newPath, path.join('/media/other', 'movie.mp4'));
  }
});

test('v1.41.6: a rename INTO the same folder+name as the source is still rejected as a no-op move', () => {
  const result = computeMoveTarget('/media/lib/movie.mp4', '/media/lib', ['/media/lib'], { newBaseName: 'movie.mp4' });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /same file/i);
});
