'use strict';

// [UNIT] v1.286 (Dean, "everything shareable"): shareMediaFile shares the actual
// media FILE via navigator.share({files}), falling back to a download when
// file-share is unavailable or the file is too big to blob safely. The browser
// plumbing (fetch/navigator.share) is Dean's on-device arbiter (CONTRIBUTING);
// this binds the PURE strategy decision (chooseShareStrategy) that gates it.

const { test } = require('node:test');
const assert = require('node:assert');
const { chooseShareStrategy } = require('../../public/js/common.js');

test('chooseShareStrategy: no file-share support -> download', () => {
  assert.strictEqual(chooseShareStrategy({ canShareFiles: false }), 'download');
  assert.strictEqual(chooseShareStrategy({ canShareFiles: false, sizeBytes: 10, maxBytes: 999 }), 'download');
});

test('chooseShareStrategy: can file-share + within (or unknown) size -> file', () => {
  assert.strictEqual(chooseShareStrategy({ canShareFiles: true }), 'file', 'unknown size still file-shares');
  assert.strictEqual(chooseShareStrategy({ canShareFiles: true, sizeBytes: 40 * 1024 * 1024, maxBytes: 400 * 1024 * 1024 }), 'file', 'a 40MB mp3');
  assert.strictEqual(chooseShareStrategy({ canShareFiles: true, sizeBytes: 400 * 1024 * 1024, maxBytes: 400 * 1024 * 1024 }), 'file', 'exactly at the cap is still file (strict >)');
});

test('chooseShareStrategy: can file-share but OVER the cap -> download (never blob a huge file)', () => {
  assert.strictEqual(chooseShareStrategy({ canShareFiles: true, sizeBytes: 400 * 1024 * 1024 + 1, maxBytes: 400 * 1024 * 1024 }), 'download');
  assert.strictEqual(chooseShareStrategy({ canShareFiles: true, sizeBytes: 3 * 1024 * 1024 * 1024, maxBytes: 400 * 1024 * 1024 }), 'download', 'a 3GB video');
});

test('chooseShareStrategy: a missing maxBytes never forces download on a known size', () => {
  assert.strictEqual(chooseShareStrategy({ canShareFiles: true, sizeBytes: 9e9 }), 'file', 'no cap declared -> size is not consulted');
});
