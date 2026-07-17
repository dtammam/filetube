'use strict';

// [INTEGRATION][MANDATORY] C1 (v1.24 UX Round, Wave 3) -- the load-bearing
// `getMediaId` invariant: watch progress for a MOVED item must SURVIVE the
// next scan unchanged, under its NEW (path-derived) id -- never look like a
// delete (old id pruned, progress lost) + a brand-new add (new id, no
// history). See docs/exec-plans/active/2026-07-09-v1.24-ux-round.md's Design
// -> "Load-bearing grounding fact" section.
//
// Isolated DATA_DIR before requiring the app, own process per file
// (node --test), mirroring test/integration/scan-delete-reconcile.test.js's
// exact isolation pattern.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-scan-'));
const DATA_DIR = process.env.DATA_DIR;

const { test } = require('node:test');
const assert = require('node:assert');
const {
  getMediaId, loadDatabase, saveDatabase, updateDatabase, moveItemToFolder, scanDirectories,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

// v1.42: seeds go through the exported saveDatabase (the adapter opened at
// require time, so a raw db.json write would be dead); persisted-state
// assertions go through the sanctioned SQLite read helper. An EMPTY doc_kv
// namespace persists as zero rows (absent); backfill the ones this file
// dereferences so `finalDb.progress[id]`-style reads stay valid.
function readDb() {
  const db = readPersistedDatabase(DATA_DIR);
  for (const ns of ['metadata', 'progress']) {
    if (!db[ns]) db[ns] = {};
  }
  return db;
}

function baseSettings() {
  return { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '', autoplayNext: false };
}

test('HEADLINE: watch progress for a moved item survives the next scan unchanged (no delete+new-add)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-scan-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-scan-dst-'));
  const filePath = path.join(srcDir, 'episode.mp4');
  fs.writeFileSync(filePath, 'episode-bytes');
  const size = fs.statSync(filePath).size;
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'episode.mp4');
  const newId = getMediaId(newPath);
  assert.notEqual(oldId, newId, 'sanity: moving to a different folder must change the path-derived id');

  saveDatabase({
    folders: [srcDir, dstDir],
    folderSettings: {},
    progress: { [oldId]: { timestamp: 123, duration: 600, updatedAt: '2026-07-01T00:00:00.000Z' } },
    metadata: {
      [oldId]: {
        id: oldId, name: 'episode.mp4', title: 'episode', filePath,
        folderName: path.basename(srcDir), size, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 600, hasThumbnail: false, artist: '',
        videoCodec: null, audioCodec: null,
      },
    },
    settings: baseSettings(),
  });

  const moveResult = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId }, oldId, dstDir);
  assert.equal(moveResult.ok, true);
  assert.equal(moveResult.newId, newId);

  const progressBeforeScan = readDb().progress[newId];
  assert.deepStrictEqual(progressBeforeScan, { timestamp: 123, duration: 600, updatedAt: '2026-07-01T00:00:00.000Z' });

  // The mandatory regression: run the NEXT scan, exactly as if the operator
  // triggered (or the timer fired) a rescan after the move.
  await scanDirectories();

  const finalDb = readDb();

  // Not a delete: the new-path id must still carry the SAME watch progress,
  // byte-for-byte, that existed right after the move -- a scan reusing the
  // fast path never re-touches progress.
  assert.deepStrictEqual(finalDb.progress[newId], progressBeforeScan,
    'watch progress under the new id must be BYTE-IDENTICAL after a scan -- any drift means the scan treated this as a fresh item');

  // Not a new-add: exactly one metadata entry exists for this file -- no
  // duplicate, no resurrected old id.
  assert.ok(finalDb.metadata[newId], 'the new-path id must be present after the scan');
  assert.ok(!finalDb.metadata[oldId], 'the OLD id must never be resurrected by the scan');
  assert.equal(Object.keys(finalDb.metadata).length, 1, 'exactly one metadata entry -- no duplicate/ghost entry from a false delete+new-add');
  assert.ok(!finalDb.progress[oldId], 'no stray progress entry should be left under the old id');

  assert.equal(finalDb.metadata[newId].filePath, newPath);
  assert.equal(finalDb.metadata[newId].title, 'episode', 'the reuse fast-path must preserve the existing title, not recompute it fresh');
});

test('a moved item with NO prior watch progress: single entry, no duplicate, after the next scan', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-scan-src2-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-scan-dst2-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const size = fs.statSync(filePath).size;
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');
  const newId = getMediaId(newPath);

  saveDatabase({
    folders: [srcDir, dstDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [oldId]: {
        id: oldId, name: 'clip.mp4', title: 'clip', filePath,
        folderName: path.basename(srcDir), size, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 30, hasThumbnail: false, artist: '',
        videoCodec: null, audioCodec: null,
      },
    },
    settings: baseSettings(),
  });

  const moveResult = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId }, oldId, dstDir);
  assert.equal(moveResult.ok, true);

  await scanDirectories();

  const finalDb = readDb();
  assert.equal(Object.keys(finalDb.metadata).length, 1);
  assert.ok(finalDb.metadata[newId]);
  assert.ok(!finalDb.metadata[oldId]);
});
