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
