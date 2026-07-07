'use strict';

// [UNIT] FR-4 (v1.19.0, synthetic Downloads folder remove-button disable):
// `isSyntheticFolder` (public/js/common.js) -- the pure decision helper Setup's
// `renderFolders()` uses to disable the remove button on the yt-dlp module's
// synthetic download-folder row, fed by GET /api/config's additive, read-only
// `syntheticFolders` array (server.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { isSyntheticFolder } = require('../../public/js/common.js');

test('returns true when the folder path is present in syntheticFolders', () => {
  assert.equal(isSyntheticFolder('/data/downloads', ['/data/downloads']), true);
});

test('returns false for a real (non-synthetic) folder', () => {
  assert.equal(isSyntheticFolder('/media/Movies', ['/data/downloads']), false);
});

test('returns false when syntheticFolders is empty', () => {
  assert.equal(isSyntheticFolder('/data/downloads', []), false);
});

test('returns false (never throws) when syntheticFolders is missing/undefined -- e.g. an older cached response shape', () => {
  assert.equal(isSyntheticFolder('/data/downloads', undefined), false);
});

test('returns false (never throws) when syntheticFolders is not an array', () => {
  assert.equal(isSyntheticFolder('/data/downloads', null), false);
  assert.equal(isSyntheticFolder('/data/downloads', 'not-an-array'), false);
  assert.equal(isSyntheticFolder('/data/downloads', {}), false);
});

test('matches multiple synthetic roots correctly (only the ones actually listed)', () => {
  const roots = ['/data/downloads', '/data/other-download-dir'];
  assert.equal(isSyntheticFolder('/data/downloads', roots), true);
  assert.equal(isSyntheticFolder('/data/other-download-dir', roots), true);
  assert.equal(isSyntheticFolder('/data/unrelated', roots), false);
});
