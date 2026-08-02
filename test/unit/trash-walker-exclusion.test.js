'use strict';

// [UNIT] v1.65 gate fix (adversarial W7) -- the books and music walkers'
// TRASH_DIR_NAME exclusions were load-bearing (a trashed audio item in a
// folder that is also a music root would re-index into the Music library --
// the resurrection class) but had ZERO binding: deleting either skip
// survived the full suite. Direct walker probes, per the seat's own repro.

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { walkMusicRoot } = require('../../lib/music/scan');
const { walkBookRoot } = require('../../lib/books/scan');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

function makeRoot(liveName, trashedName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-walkex-'));
  fs.writeFileSync(path.join(root, liveName), 'live');
  fs.mkdirSync(path.join(root, TRASH_DIR_NAME, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, TRASH_DIR_NAME, trashedName), 'trashed');
  fs.writeFileSync(path.join(root, TRASH_DIR_NAME, 'nested', trashedName), 'trashed-deep');
  return root;
}

test('music walker: files inside .filetube-trash (any depth) are invisible', () => {
  const root = makeRoot('live.mp3', 'trashed.mp3');
  const found = walkMusicRoot(root, []);
  assert.deepEqual(found, [path.join(root, 'live.mp3')], 'only the live track walks');
});

test('books walker: files inside .filetube-trash (any depth) are invisible', () => {
  const root = makeRoot('live.epub', 'trashed.epub');
  const found = walkBookRoot(root);
  assert.deepEqual(found, [path.join(root, 'live.epub')], 'only the live book walks');
});
