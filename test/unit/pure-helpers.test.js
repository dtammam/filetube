'use strict';

// Isolate DATA_DIR to a throwaway temp dir BEFORE requiring the server, so that
// transcodedPath() resolves under a predictable, disposable location and the
// module never touches real project data. Node's test runner executes each test
// file in its own process, so this env assignment is local to this file.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  needsTranscode,
  transcodedPath,
  getMediaId,
  matchRootFolder,
  cleanDisplayTitle,
  extractYtdlpVideoId,
  normalizeScanRoot,
} = require('../../server');

test('needsTranscode: browser-incompatible containers need transcoding', () => {
  for (const ext of ['.avi', '.flv', '.wmv', '.mpg', '.mpeg']) {
    assert.equal(needsTranscode(ext), true, `${ext} should need transcoding`);
  }
});

test('needsTranscode: web-native containers do NOT need transcoding', () => {
  for (const ext of ['.mp4', '.mkv', '.webm', '.mov', '.m4v']) {
    assert.equal(needsTranscode(ext), false, `${ext} should not need transcoding`);
  }
});

test('needsTranscode: is case-sensitive (callers pass lowercased ext)', () => {
  // scanDirRecursive lowercases via path.extname().toLowerCase() before calling,
  // so an uppercase ext arriving here is a bug upstream — lock the contract.
  assert.equal(needsTranscode('.AVI'), false);
});

test('transcodedPath: builds an .mp4 path under the transcoded dir', () => {
  const p = transcodedPath('abc123');
  assert.ok(p.endsWith(path.join('transcoded', 'abc123.mp4')), `got ${p}`);
  assert.ok(p.startsWith(process.env.DATA_DIR), 'must live under DATA_DIR');
});

test('getMediaId: deterministic md5 of the file path', () => {
  const fp = '/media/movies/example.avi';
  const expected = crypto.createHash('md5').update(fp).digest('hex');
  assert.equal(getMediaId(fp), expected);
  assert.equal(getMediaId(fp), getMediaId(fp), 'same input -> same id');
  assert.match(getMediaId(fp), /^[0-9a-f]{32}$/, 'is a 32-char hex md5');
});

test('getMediaId: different paths produce different ids', () => {
  assert.notEqual(getMediaId('/a/b.mp4'), getMediaId('/a/c.mp4'));
});

test('matchRootFolder: returns the configured folder a file lives under', () => {
  const folders = ['/media/movies', '/media/tv'];
  assert.equal(matchRootFolder('/media/movies/a.mp4', folders), '/media/movies');
  assert.equal(matchRootFolder('/media/tv/show/ep.mkv', folders), '/media/tv');
});

test('matchRootFolder: longest matching prefix wins', () => {
  const folders = ['/media', '/media/movies'];
  assert.equal(matchRootFolder('/media/movies/a.mp4', folders), '/media/movies');
});

test('matchRootFolder: exact-path match returns that folder', () => {
  assert.equal(matchRootFolder('/media/movies', ['/media/movies']), '/media/movies');
});

test('matchRootFolder: no match returns null', () => {
  assert.equal(matchRootFolder('/somewhere/else/a.mp4', ['/media/movies']), null);
});

test('matchRootFolder: does not falsely match a sibling with a shared name prefix', () => {
  // '/media/movies' must NOT be considered under '/media/movie' (boundary check).
  assert.equal(matchRootFolder('/media/movies/a.mp4', ['/media/movie']), null);
});

// ---- FR-F (v1.12.0, yt-dlp module parity): cleanDisplayTitle ----------------
// [UNIT] AC33/34/35/36/37 (see docs/exec-plans/active/2026-07-06-ytdlp-metube-parity.md).

test('cleanDisplayTitle: strips a trailing bracketed 11-char yt-dlp id and turns underscores into spaces (AC33)', () => {
  assert.equal(cleanDisplayTitle('Title_With_Underscores [dQw4w9WgXcQ]'), 'Title With Underscores');
});

test('cleanDisplayTitle: works with a space (not just an underscore) before the bracket', () => {
  assert.equal(cleanDisplayTitle('My Great Video [dQw4w9WgXcQ]'), 'My Great Video');
});

// v1.15.0 item 5: --windows-filenames (replacing --restrict-filenames)
// produces spaces-and-punctuation on-disk names instead of the previous
// ASCII-folded/underscored form -- cleanDisplayTitle must still strip the
// `[id]` suffix identically for BOTH shapes, producing the same clean
// display title (AC5.3).
test('cleanDisplayTitle: a --windows-filenames-shaped name (spaces + punctuation) and the legacy --restrict-filenames-shaped name (underscores) clean to the identical display title', () => {
  // `cleanDisplayTitle` is always called on the basename WITHOUT its
  // extension (server.js: `path.basename(info.name, info.ext)`), mirroring
  // real usage here.
  const windowsFilenamesShape = 'Link Miguel en Vivo [wN4p6TKlBzQ]';
  const restrictFilenamesShape = 'Link_Miguel_en_Vivo [wN4p6TKlBzQ]';
  assert.equal(cleanDisplayTitle(windowsFilenamesShape), 'Link Miguel en Vivo');
  assert.equal(cleanDisplayTitle(windowsFilenamesShape), cleanDisplayTitle(restrictFilenamesShape));
});

test('cleanDisplayTitle: collapses a run of consecutive underscores to a single space', () => {
  // restrict-filenames can emit multiple consecutive underscores when several
  // non-ASCII/special characters appear back-to-back.
  assert.equal(cleanDisplayTitle('A___B [dQw4w9WgXcQ]'), 'A B');
});

test('cleanDisplayTitle: REGRESSION -- a plain non-yt-dlp file with no bracket is left completely unchanged (AC34)', () => {
  assert.equal(cleanDisplayTitle('My_Home_Movie'), 'My_Home_Movie');
});

test('cleanDisplayTitle: REGRESSION -- a bracket whose content is not exactly 11 id-shaped characters is left unchanged (AC35)', () => {
  assert.equal(cleanDisplayTitle('Something [notanid]'), 'Something [notanid]');
  assert.equal(cleanDisplayTitle('Movie [2024]'), 'Movie [2024]');
  assert.equal(cleanDisplayTitle('Song [Remix]'), 'Song [Remix]');
});

test('cleanDisplayTitle: REGRESSION -- a 12-character bracket token (one char too many) is left unchanged (boundary check)', () => {
  assert.equal(cleanDisplayTitle('Video [dQw4w9WgXcQx]'), 'Video [dQw4w9WgXcQx]');
});

test('cleanDisplayTitle: REGRESSION -- a 10-character bracket token (one char too few) is left unchanged (boundary check)', () => {
  const tenCharToken = 'dQw4w9WgXc';
  assert.equal(tenCharToken.length, 10, 'sanity: the token under test must be exactly 10 characters');
  assert.equal(cleanDisplayTitle(`Video [${tenCharToken}]`), `Video [${tenCharToken}]`);
});

test('cleanDisplayTitle: display-only -- getMediaId is identical whether or not the title is cleaned (AC36, no id churn)', () => {
  const filePath = '/data/yt-dlp/Title_With_Underscores [dQw4w9WgXcQ].mp4';
  const before = getMediaId(filePath);
  // Cleaning the title never touches filePath/getMediaId's input.
  cleanDisplayTitle('Title_With_Underscores [dQw4w9WgXcQ]');
  const after = getMediaId(filePath);
  assert.equal(before, after, 'getMediaId must be unaffected by title derivation');
});

test('cleanDisplayTitle: empty string and a bare bracket-only name never throw', () => {
  assert.equal(cleanDisplayTitle(''), '');
  assert.equal(cleanDisplayTitle('[dQw4w9WgXcQ]'), '[dQw4w9WgXcQ]'); // no leading space/underscore -> no match, unchanged
});

// ---- v1.20.0 FR-2: extractYtdlpVideoId -- sibling to cleanDisplayTitle, ----
// reusing the identical ` [<11-char id>]` bracket shape (never a forked
// regex) so the two helpers can never disagree about what counts as a
// yt-dlp-shaped filename.

test('extractYtdlpVideoId: extracts the bracketed 11-char id from a yt-dlp-shaped basename', () => {
  assert.equal(extractYtdlpVideoId('Title_With_Underscores [dQw4w9WgXcQ]'), 'dQw4w9WgXcQ');
});

test('extractYtdlpVideoId: works with a space (not just an underscore) before the bracket', () => {
  assert.equal(extractYtdlpVideoId('My Great Video [dQw4w9WgXcQ]'), 'dQw4w9WgXcQ');
});

test('extractYtdlpVideoId: a plain non-yt-dlp file with no bracket returns null', () => {
  assert.equal(extractYtdlpVideoId('My_Home_Movie'), null);
});

test('extractYtdlpVideoId: a bracket whose content is not exactly 11 id-shaped characters returns null (mirrors cleanDisplayTitle\'s own boundary)', () => {
  assert.equal(extractYtdlpVideoId('Something [notanid]'), null);
  assert.equal(extractYtdlpVideoId('Something [12charactersX]'), null); // 12 chars, one too many
  assert.equal(extractYtdlpVideoId('Something [9charsxx]'), null); // 9 chars, one too few
});

test('extractYtdlpVideoId: agrees with cleanDisplayTitle on the SAME input (shared bracket regex, never forked)', () => {
  const shaped = 'Link Miguel en Vivo [wN4p6TKlBzQ]';
  assert.equal(extractYtdlpVideoId(shaped), 'wN4p6TKlBzQ');
  assert.equal(cleanDisplayTitle(shaped), 'Link Miguel en Vivo');
  const unshaped = 'Vacation_2024 [Holiday2024]'; // coincidentally 11 chars but not a real id shape check target here
  assert.equal(extractYtdlpVideoId(unshaped), 'Holiday2024', 'a coincidental 11-char bracket still "matches" the shape (scoping to yt-dlp roots is the caller\'s job, mirroring cleanDisplayTitle)');
});

test('extractYtdlpVideoId: empty string and a bare bracket-only name never throw', () => {
  assert.equal(extractYtdlpVideoId(''), null);
  assert.equal(extractYtdlpVideoId('[dQw4w9WgXcQ]'), null); // no leading space/underscore -> no match
});

// ---- FR-G part 1 (v1.12.0): normalizeScanRoot -------------------------------
// [UNIT] AC38/39 (see the exec plan). Uses real temp dirs + a real symlink so
// `fs.realpathSync` behavior is exercised for real, not mocked.

test('normalizeScanRoot: a symlink alias and its real target normalize to the SAME string (AC38, same-tree collapse)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-normalize-'));
  const realDir = path.join(base, 'real');
  const linkDir = path.join(base, 'alias-link');
  fs.mkdirSync(realDir);
  fs.symlinkSync(realDir, linkDir, 'dir');
  try {
    assert.equal(normalizeScanRoot(linkDir), normalizeScanRoot(realDir), 'a symlink alias must normalize to the same real path as its target');
    assert.equal(normalizeScanRoot(realDir), fs.realpathSync(realDir));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('normalizeScanRoot: a relative-with-".." spelling normalizes to the same string as the resolved-absolute spelling (AC38)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-normalize-rel-'));
  const target = path.join(base, 'movies');
  fs.mkdirSync(target);
  try {
    const divergentSpelling = path.join(base, 'movies', '..', 'movies');
    assert.equal(normalizeScanRoot(divergentSpelling), normalizeScanRoot(target));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('normalizeScanRoot: REGRESSION -- two genuinely distinct real trees are never collapsed (AC39)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-normalize-distinct-'));
  const dirA = path.join(base, 'a');
  const dirB = path.join(base, 'b');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  try {
    assert.notEqual(normalizeScanRoot(dirA), normalizeScanRoot(dirB));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('normalizeScanRoot: a missing/unmounted root falls back to path.resolve (never dropped, never throws)', () => {
  const missing = path.join(os.tmpdir(), `filetube-normalize-missing-${Date.now()}-${Math.random()}`);
  assert.equal(fs.existsSync(missing), false, 'sanity: must genuinely not exist');
  assert.equal(normalizeScanRoot(missing), path.resolve(missing));
});

test('normalizeScanRoot: the missing-root fallback is stable/deterministic across repeated calls (so it can be relied on as a Set key)', () => {
  const missing = path.join(os.tmpdir(), `filetube-normalize-missing-stable-${Date.now()}`);
  assert.equal(normalizeScanRoot(missing), normalizeScanRoot(missing));
});
