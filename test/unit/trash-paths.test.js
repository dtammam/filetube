'use strict';

// [UNIT] v1.65 -- lib/trashPaths.js, the one authority for the trash dir
// name + trash-side path shapes (pure, DOM/FS-free).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { TRASH_DIR_NAME, trashDirFor, trashFileName, computeTrashTarget } = require('../../lib/trashPaths');

test('TRASH_DIR_NAME is the namespaced dot-dir, never a generic recycle name', () => {
  assert.equal(TRASH_DIR_NAME, '.filetube-trash');
});

test('trashDirFor: root-attributed -> <root>/.filetube-trash; unattributable -> the file\'s OWN dir (same filesystem)', () => {
  assert.equal(trashDirFor('/media/lib/Chan/a.mp4', '/media/lib'), path.join('/media/lib', TRASH_DIR_NAME));
  assert.equal(trashDirFor('/odd/place/a.mp4', null), path.join('/odd/place', TRASH_DIR_NAME));
});

test('trashFileName: <ms>-<id8>-<basename>, unique per (ms, id) and human-recoverable', () => {
  const name = trashFileName('/media/lib/Chan/My Video.mp4', 'abcdef0123456789', 1750000000000);
  assert.equal(name, '1750000000000-abcdef01-My Video.mp4');
});

test('computeTrashTarget composes the two', () => {
  const t = computeTrashTarget('/media/lib/Chan/a.mp4', 'deadbeefcafe0000', '/media/lib', 42);
  assert.equal(t.trashDir, path.join('/media/lib', TRASH_DIR_NAME));
  assert.equal(t.trashPath, path.join('/media/lib', TRASH_DIR_NAME, '42-deadbeef-a.mp4'));
});
