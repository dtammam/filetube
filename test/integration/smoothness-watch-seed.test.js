'use strict';

// [INTEGRATION] v1.406.0 W1 A1 (plan docs/exec-plans/active/2026-11-08-smoothness.md): every home surface that opens watch hands
// a seed the PLAYER can start from. The Modern grid (`GET /api/home?view=grid`, resolveModernGridItem) and the home rows
// (`GET /api/home`, resolveHomeItem) carried no size / filePath, so the v1.52 seed predicate refused them and the player waited
// for the watch page's own fetches (the black box Dean recorded: 2.4 s on the iPhone). Reachability, not unit correctness
// (LESSONS 2): the SERVER-EMITTED items go through the REAL client predicate. RBAC projection (LESSONS 10): the seed adds the
// stream-decision and display facts only - never a path, never the file size - and only for items the role may see.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-smooth-seed-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { isFullWatchSeedItem } = require('../../public/js/common.js');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function seedLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-smooth-lib-'));
  const mk = (n) => { const p = path.join(root, `${n}.mp4`); fs.writeFileSync(p, 'x'); return p; };
  const common = { folderName: path.basename(root), rootFolder: root, size: 12345, duration: 60 };
  seedState({
    folders: [root], folderSettings: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      // a ready video with a thumbnail and its size
      vid: { ...common, id: 'vid', title: 'A video', type: 'video', ext: '.mp4', filePath: mk('vid'), addedAt: 5, hasThumbnail: true, needsTranscode: false, width: 1920, height: 1080, audioStatus: 'ready' },
      // an AVI still transcoding: the seed must carry the state so the player takes the await path, never a raw stream
      avi: { ...common, id: 'avi', title: 'An avi', type: 'video', ext: '.avi', filePath: mk('avi'), addedAt: 4, hasThumbnail: false, needsTranscode: true, transcodeStatus: 'pending' },
      // a 360 file the owner marked flat: the EFFECTIVE projection (none), never the raw file value
      flat: { ...common, id: 'flat', title: 'Not VR', type: 'video', ext: '.mp4', filePath: mk('flat'), addedAt: 3, hasThumbnail: true, needsTranscode: false, projection: '360', projectionOverride: 'flat' },
      // a real 360 file: the seed says so (the native surface stands down for VR)
      vr: { ...common, id: 'vr', title: 'VR', type: 'video', ext: '.mp4', filePath: mk('vr'), addedAt: 2, hasThumbnail: true, needsTranscode: false, projection: '360' },
      // an audio download: hasThumbnail reaches the audio art path
      aud: { ...common, id: 'aud', title: 'A podcast mp3', type: 'audio', ext: '.mp3', filePath: mk('aud'), addedAt: 1, hasThumbnail: true, needsTranscode: false },
    },
  });
  return root;
}

const FORBIDDEN = ['filePath', 'size', 'rootFolder', 'name', 'sourceUrl'];

test('A1: the Modern grid item is a FULL watch seed (the real predicate says so) and carries the player\'s fields - never a path or size', async () => {
  const root = seedLibrary();
  const res = await fetch(`${base}/api/home?view=grid`);
  assert.equal(res.status, 200);
  const items = Object.fromEntries(((await res.json()).items || []).map((it) => [it.id, it]));
  for (const id of ['vid', 'avi', 'flat', 'vr', 'aud']) {
    const it = items[id];
    assert.ok(it, `${id} is in the grid`);
    assert.strictEqual(isFullWatchSeedItem(it), true, `${id}: the server-emitted grid item starts the player at the tap`);
    for (const k of FORBIDDEN) assert.ok(!(k in it), `${id}: no ${k} on a card`);
    assert.ok(!JSON.stringify(it).includes(root), `${id}: the library path appears nowhere in the item`);
  }
  assert.strictEqual(items.vid.hasThumbnail, true);
  assert.strictEqual(items.vid.needsTranscode, false);
  assert.strictEqual(items.vid.width, 1920);
  assert.strictEqual(items.vid.height, 1080);
  assert.strictEqual(items.vid.audioStatus, 'ready');
  assert.strictEqual(items.avi.needsTranscode, true);
  assert.strictEqual(items.avi.transcodeStatus, 'pending', 'the await-poll path, not a raw /video stream of an AVI');
  assert.strictEqual(items.avi.hasThumbnail, false);
  assert.ok(!('projection' in items.flat), 'the owner\'s flat override wins (effective projection)');
  assert.strictEqual(items.vr.projection, '360');
  assert.strictEqual(items.aud.hasThumbnail, true, 'the audio art is known at the tap');
});

test('A1: a home ROW media item (the feed layout, GET /api/home) is a full watch seed too', async () => {
  seedLibrary();
  const res = await fetch(`${base}/api/home`);
  assert.equal(res.status, 200);
  const rows = (await res.json()).rows || [];
  const media = rows.flatMap((r) => r.items || []).filter((it) => it.kind === 'media');
  assert.ok(media.length > 0, 'a row with media items');
  for (const it of media) {
    assert.strictEqual(isFullWatchSeedItem(it), true, `${it.id}: a row card starts the player at the tap`);
    for (const k of FORBIDDEN) assert.ok(!(k in it), `${it.id}: no ${k} on a row card`);
  }
});

test('A1 predicate: decided by the player\'s fields - a bell row (no type, no stream decision) never pre-loads; a legacy list record still does', () => {
  assert.strictEqual(isFullWatchSeedItem({ id: 'x', type: 'video', needsTranscode: false }), true, 'type + the stream decision');
  assert.strictEqual(isFullWatchSeedItem({ id: 'x', type: 'video' }), false, 'no stream decision');
  assert.strictEqual(isFullWatchSeedItem({ id: 'x', type: 'video', needsTranscode: 'false' }), false, 'a non-boolean is not a decision');
  assert.strictEqual(isFullWatchSeedItem({ id: 'x', needsTranscode: false }), false, 'no type');
  assert.strictEqual(isFullWatchSeedItem({ id: 'x', title: 'Bell', channelName: 'C', hasThumbnail: true }), false, 'the bell row seed');
  assert.strictEqual(isFullWatchSeedItem({ id: 'x', type: 'video', size: 1, filePath: '/m/x.mp4' }), true, 'a list record without the flag');
});
