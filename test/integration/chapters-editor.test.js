'use strict';

// [INTEGRATION] v1.34 T3 (Dean, chapters) -- the editor endpoint + serve-time
// precedence against the REAL app:
//   - POST /api/videos/:id/chapters stores parsed manual chapters
//     (MANUAL ALWAYS WINS at GET /api/videos/:id), empty text clears back to
//     the next source, validation 400s
//   - description-derived chapters surface with source 'description'
//   - the stale-snapshot trio: a manual edit landing MID-SCAN survives the
//     scan's final merge (Phase-2 mirror guard), a mid-scan CLEAR is not
//     resurrected, and a CHANGED file keeps its manual chapters (re-init
//     carry-forward)
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapters-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, saveDatabase, getMediaId } = require('../../server');

let server;
let base;
let mediaDir;

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapters-media-'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

function seedItem(name, extra = {}) {
  const filePath = path.join(mediaDir, name);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `bytes-of-${name}`);
  const id = getMediaId(filePath);
  return {
    id, name, title: path.basename(name, path.extname(name)), filePath,
    folderName: path.basename(mediaDir), size: fs.statSync(filePath).size, ext: path.extname(name),
    type: 'video', addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
    videoCodec: 'h264', audioCodec: 'aac', releaseDate: 1000, rootFolder: mediaDir,
    ...extra,
  };
}

function seedDb(items) {
  const metadata = {};
  for (const it of items) metadata[it.id] = it;
  saveDatabase({
    folders: [mediaDir], folderSettings: {}, progress: {}, metadata,
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
}

async function getItem(id) {
  const res = await fetch(`${base}/api/videos/${id}`);
  assert.equal(res.status, 200);
  return res.json();
}

test('editor round-trip: manual chapters win over embedded; clearing falls back; invalid text 400s; unknown id 404s', async () => {
  const item = seedItem('editable.mp4', {
    chapters: [{ startTime: 0, title: 'Embedded A' }, { startTime: 60, title: 'Embedded B' }],
  });
  seedDb([item]);

  let body = await getItem(item.id);
  assert.equal(body.chaptersSource, 'embedded');
  assert.equal(body.chapters[0].title, 'Embedded A');

  const post = await fetch(`${base}/api/videos/${item.id}/chapters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '0:00 My Intro 🎬\n2:30 My Main' }),
  });
  assert.equal(post.status, 200);
  const postBody = await post.json();
  assert.equal(postBody.chaptersSource, 'manual');
  assert.deepEqual(postBody.chapters, [
    { startTime: 0, title: 'My Intro 🎬' },
    { startTime: 150, title: 'My Main' },
  ]);

  body = await getItem(item.id);
  assert.equal(body.chaptersSource, 'manual', 'manual must win at serve time');
  assert.equal(body.chapters[1].startTime, 150);

  // Clear -> embedded resurfaces.
  const clear = await fetch(`${base}/api/videos/${item.id}/chapters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '   \n  ' }),
  });
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).chaptersSource, 'embedded');
  assert.equal(loadDatabase().metadata[item.id].chaptersManual, undefined, 'the manual field is deleted, not left as []');

  // Validation.
  const bad = await fetch(`${base}/api/videos/${item.id}/chapters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'no timestamps anywhere here' }),
  });
  assert.equal(bad.status, 400);
  const notString = await fetch(`${base}/api/videos/${item.id}/chapters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 42 }),
  });
  assert.equal(notString.status, 400);
  const unknown = await fetch(`${base}/api/videos/does-not-exist/chapters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '0:00 X' }),
  });
  assert.equal(unknown.status, 404);
});

test('description-derived chapters surface with source description (>=2 entries, first at 0:00)', async () => {
  const item = seedItem('description-chapters.mp4', {
    chapters: [],
    tags: { description: 'My video!\n0:00 Start\n1:00 Middle\n2:00 End' },
  });
  seedDb([item]);
  const body = await getItem(item.id);
  assert.equal(body.chaptersSource, 'description');
  assert.equal(body.chapters.length, 3);
  assert.deepEqual(body.chapters[1], { startTime: 60, title: 'Middle' });
});

test('HEADLINE (stale-snapshot trio, guard 2): a manual chapters edit landing MID-SCAN survives the final merge; a mid-scan CLEAR is not resurrected', async () => {
  // A brand-new file forces the scan through its async probe yield window.
  fs.writeFileSync(path.join(mediaDir, `fresh-yield-${Date.now()}.mp4`), 'new-bytes');
  const edited = seedItem('edited-mid-scan.mp4', {});
  const cleared = seedItem('cleared-mid-scan.mp4', { chaptersManual: [{ startTime: 0, title: 'Old Manual' }] });
  seedDb([edited, cleared]);

  const scanPromise = scanDirectories();
  // Both writes fired in the same tick as the scan start -- exactly what the
  // editor endpoint's updateDatabase does.
  const editPromise = updateDatabase((db) => {
    if (db.metadata[edited.id]) db.metadata[edited.id].chaptersManual = [{ startTime: 10, title: 'Mid-scan edit' }];
    return true;
  });
  const clearPromise = updateDatabase((db) => {
    if (db.metadata[cleared.id]) delete db.metadata[cleared.id].chaptersManual;
    return true;
  });
  await Promise.all([scanPromise, editPromise, clearPromise]);

  const db = loadDatabase();
  assert.deepEqual(db.metadata[edited.id].chaptersManual, [{ startTime: 10, title: 'Mid-scan edit' }],
    'a manual edit landing mid-scan must survive the scan\'s final wholesale merge');
  assert.equal(db.metadata[cleared.id].chaptersManual, undefined,
    'a mid-scan CLEAR must not be resurrected from the scan\'s stale Phase-1 snapshot');
});

test('re-init carry-forward (guard 1): a CHANGED file (same path, new size) keeps its manual chapters', async () => {
  const item = seedItem('replaced-later.mp4', { chaptersManual: [{ startTime: 5, title: 'Keep Me' }] });
  seedDb([item]);
  await scanDirectories(); // settle

  fs.writeFileSync(item.filePath, 'replacement-bytes-with-a-different-length');
  await scanDirectories(); // the re-init branch

  const after = loadDatabase().metadata[item.id];
  assert.deepEqual(after.chaptersManual, [{ startTime: 5, title: 'Keep Me' }],
    'user chapter edits must survive a file replacement (the sourceTitle/youtubeId carry-forward\'s sibling)');
  assert.ok(Array.isArray(after.chapters), 'the probe-derived field re-derives naturally (array, [] when the new file has none)');
});

// ---- v1.34 gate fix (adversarial CRITICAL): chapters gap-fill in Phase-2 ----
// A PARTIAL mid-scan reheat (markComplete:false -- subs failed, marker not
// advanced) that populated `chapters` for the FIRST time must survive the
// scan's final merge: the completed-adoption branch never fires (marker
// unchanged), so the unconditional gap-fill is what protects it.
test('HEADLINE: first-ever chapters written by a PARTIAL reheat mid-scan (marker not advanced) survive the final merge', async () => {
  const { recordRepulledItemMeta } = require('../../server');

  // Brand-new file -> the scan must await its probe (the yield window).
  fs.writeFileSync(path.join(mediaDir, `yield-${Date.now()}.mp4`), 'new-bytes');
  // Already-indexed, unchanged, codec-fields-present -> REUSE fast path,
  // chapters field ABSENT (a pre-v1.34 item).
  const item = seedItem('reheated-chapters-mid-scan.mp4', {});
  delete item.chapters;
  seedDb([item]);

  const scanPromise = scanDirectories();
  const reheatPromise = recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    item.id,
    {
      filePath: item.filePath,
      chapters: [{ startTime: 0, title: 'First Ever' }, { startTime: 30, title: 'Second' }],
      markComplete: false, // subs failed -- the marker does NOT advance
    },
    1_900_000_000_000,
  );
  await Promise.all([scanPromise, reheatPromise]);

  const after = loadDatabase().metadata[item.id];
  assert.deepEqual(after.chapters, [{ startTime: 0, title: 'First Ever' }, { startTime: 30, title: 'Second' }],
    'first-ever chapters from a partial reheat must survive the scan merge (gap-fill, marker-independent)');
  assert.equal(after.metadataRepulledAt, undefined, 'sanity: the marker really did not advance (the completed-adoption branch could not have fired)');
});
