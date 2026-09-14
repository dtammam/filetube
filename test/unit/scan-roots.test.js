'use strict';

// [UNIT] Wave 6 (scan extraction) -- lib/scan/roots.js, required DIRECTLY (not
// through server.js, which merely re-exports the same function objects):
//
//   - matchRootFolder: which configured folder owns a path (longest prefix).
//   - normalizeScanRoot: a root's canonical realpath, falling back to
//     path.resolve when the root cannot be stat'd (an unmounted share).
//   - detectVanishedRoots: the empty-but-present mountpoint signature - a root
//     that PREVIOUSLY held items contributed ZERO files to this scan.
//
// These cases are deliberately small and honest; the full end-to-end prune/
// mount-loss behaviour is covered by test/integration/vanished-roots.test.js
// and the scan suites, which keep importing the helpers from server.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { matchRootFolder, normalizeScanRoot, detectVanishedRoots } = require('../../lib/scan/roots');

// ---- matchRootFolder --------------------------------------------------------

test('matchRootFolder: returns the LONGEST containing folder, not the first', () => {
  const folders = ['/media', '/media/tv', '/other'];
  assert.strictEqual(matchRootFolder('/media/tv/show/ep1.mp4', folders), '/media/tv');
  assert.strictEqual(matchRootFolder('/media/movies/a.mp4', folders), '/media');
  assert.strictEqual(matchRootFolder('/other/a.mp4', folders), '/other');
});

test('matchRootFolder: the folder path ITSELF matches, and both separators are accepted', () => {
  assert.strictEqual(matchRootFolder('/media', ['/media']), '/media');
  assert.strictEqual(matchRootFolder('C:\\media\\a.mp4', ['C:\\media']), 'C:\\media');
});

test('matchRootFolder: a sibling whose name merely STARTS with the folder never matches', () => {
  // '/media2/...' must not be attributed to '/media' - the prefix check is
  // separator-anchored, which is what keeps two libraries from bleeding.
  assert.strictEqual(matchRootFolder('/media2/a.mp4', ['/media']), null);
});

test('matchRootFolder: no configured folder contains the path -> null', () => {
  assert.strictEqual(matchRootFolder('/elsewhere/a.mp4', ['/media']), null);
  assert.strictEqual(matchRootFolder('/elsewhere/a.mp4', []), null);
});

// ---- normalizeScanRoot ------------------------------------------------------

test('normalizeScanRoot: two spellings of the SAME real tree collapse to one string', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanroots-'));
  try {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    const link = path.join(tmp, 'link');
    fs.symlinkSync(real, link);
    assert.strictEqual(normalizeScanRoot(link), normalizeScanRoot(real),
      'a symlinked re-spelling must not walk the same files under a second absolute path');
    // The `..` spelling collapses too.
    assert.strictEqual(normalizeScanRoot(path.join(real, '..', 'real')), normalizeScanRoot(real));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('normalizeScanRoot: a MISSING root still yields a stable resolved string (never dropped)', () => {
  const missing = path.join(os.tmpdir(), 'filetube-definitely-not-here-' + process.pid);
  assert.ok(!fs.existsSync(missing), 'precondition: the path really is absent');
  // The realpathSync throws, so the fallback is path.resolve - the caller needs
  // SOME stable string to record as a missingRoot, else the mount-loss guard
  // loses the root entirely.
  assert.strictEqual(normalizeScanRoot(missing), path.resolve(missing));
});

test('normalizeScanRoot: a relative missing path is resolved against cwd, not returned as-is', () => {
  const out = normalizeScanRoot('./no-such-dir-for-scan-roots-test');
  assert.strictEqual(out, path.resolve('./no-such-dir-for-scan-roots-test'));
  assert.ok(path.isAbsolute(out), 'the fallback is absolute');
});

// ---- detectVanishedRoots ----------------------------------------------------

const item = (filePath, rootFolder) => ({ filePath, rootFolder });

test('detectVanishedRoots: a root that HELD items and contributed none is flagged', () => {
  const old = { a: item('/media/a.mp4', '/media'), b: item('/media/b.mp4', '/media') };
  assert.deepStrictEqual(detectVanishedRoots(old, {}, ['/media'], []), ['/media']);
});

test('detectVanishedRoots: ONE surviving or new file under the root defuses the signature', () => {
  const old = { a: item('/media/a.mp4', '/media'), b: item('/media/b.mp4', '/media') };
  const fresh = { a: item('/media/a.mp4', '/media') };
  assert.deepStrictEqual(detectVanishedRoots(old, fresh, ['/media'], []), [],
    'a partial deletion of any size is a plausible organic change, not an unmount');
});

test('detectVanishedRoots: a root with NO prior items is never flagged (a newly added folder)', () => {
  assert.deepStrictEqual(detectVanishedRoots({}, {}, ['/media'], []), []);
});

test('detectVanishedRoots: an ALREADY-missing root is skipped (existsSync already protected it)', () => {
  const old = { a: item('/media/a.mp4', '/media') };
  assert.deepStrictEqual(detectVanishedRoots(old, {}, ['/media'], ['/media']), []);
  // A Set is accepted for missingRoots exactly like an array.
  assert.deepStrictEqual(detectVanishedRoots(old, {}, ['/media'], new Set(['/media'])), []);
});

test('detectVanishedRoots: a LEGACY entry with no rootFolder is attributed via matchRootFolder', () => {
  const old = { a: { filePath: '/media/a.mp4' } }; // pre-backfill: no rootFolder
  assert.deepStrictEqual(detectVanishedRoots(old, {}, ['/media'], []), ['/media'],
    'attribution must match selectPrunableIds exactly, or the two disagree about which root owns an id');
});

test('detectVanishedRoots: an entry attributable to NO configured folder is ignored', () => {
  const old = { a: item('/gone-from-settings/a.mp4', '/gone-from-settings') };
  assert.deepStrictEqual(detectVanishedRoots(old, {}, ['/media'], []), []);
});

test('detectVanishedRoots: each vanished root is reported once, and only the vanished ones', () => {
  const old = {
    a: item('/media/a.mp4', '/media'),
    b: item('/media/b.mp4', '/media'),
    c: item('/photos/c.mp4', '/photos'),
  };
  const fresh = { c: item('/photos/c.mp4', '/photos') };
  assert.deepStrictEqual(detectVanishedRoots(old, fresh, ['/media', '/photos'], []), ['/media']);
});

test('detectVanishedRoots: null/undefined metadata maps are tolerated, never thrown on', () => {
  assert.deepStrictEqual(detectVanishedRoots(null, null, ['/media'], null), []);
  assert.deepStrictEqual(detectVanishedRoots(undefined, undefined, null, undefined), []);
});
