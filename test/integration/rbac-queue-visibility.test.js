'use strict';

// [INTEGRATION] v1.128 Wave B (S3, census L9) - the shared queue reader.
// shapedQueue(db, req) now drops entries the requester cannot see (silent-drop,
// like a dead id - oracle-free), and POST /api/queue/items visibility-checks
// the id, returning the SAME 404 as a missing one. A restricted member with a
// hidden item queued before the restriction must never get it echoed back with
// its title/path, and must not be able to probe a hidden id via insert.
// Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-queue-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, getMediaId, userStore, __mintTestSession } = require('../../server');
const musicStore = require('../../lib/music/store');
const podcastStore = require('../../lib/podcasts/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, kid;
let pubRoot, hidRoot, openId, hiddenId;
const OPEN_SUB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001';
const HID_SUB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa0002';
let openEpId, hidEpId;

function vid(root, folderName, name) {
  const dir = path.join(root, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'BYTES');
  return { id: getMediaId(fp), title: name.replace(/\.\w+$/, ''), name, filePath: fp, folderName, rootFolder: root, type: 'video', ext: '.mp4', duration: 5, size: 5, addedAt: 1 };
}

before(async () => {
  pubRoot = path.join(DATA_DIR, 'PublicRoot');
  hidRoot = path.join(DATA_DIR, 'HiddenRoot');
  fs.mkdirSync(pubRoot, { recursive: true }); fs.mkdirSync(hidRoot, { recursive: true });

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  const open = vid(pubRoot, 'Fam', 'openclip.mp4');
  const hidden = vid(hidRoot, 'Vault', 'SECRETCLIP.mp4');
  openId = open.id; hiddenId = hidden.id;
  saveDatabase({
    folders: [pubRoot, hidRoot], folderSettings: {},
    progress: {}, metadata: { [open.id]: open, [hidden.id]: hidden },
    viewCounts: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  // A visible + a hidden TRACK (music) and a visible + a hidden downloaded
  // podcast EPISODE, all under pub/hid roots so the ONE path restriction covers
  // the hidden ones - this binds the track and podcast drops in shapedQueue,
  // not just the media drop (gate adversarial WARNING-1).
  const openTrackFile = path.join(pubRoot, 'Music', 'opentrack.mp3');
  const hidTrackFile = path.join(hidRoot, 'Music', 'SECRETTRACK.mp3');
  const openEpFile = path.join(pubRoot, 'Pods', 'openep.mp3');
  const hidEpFile = path.join(hidRoot, 'Pods', 'SECRETEP.mp3');
  for (const f of [openTrackFile, hidTrackFile, openEpFile, hidEpFile]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'A'); }
  openEpId = podcastStore.episodeIdFor(OPEN_SUB, 'og');
  hidEpId = podcastStore.episodeIdFor(HID_SUB, 'hg');
  await updateDatabase((db) => {
    const m = musicStore.ensureMusic(db);
    m.tracks = {
      opentrk: { id: 'opentrk', title: 'Open Track', artist: 'A', album: 'Al', filePath: openTrackFile, rootFolder: pubRoot, folderName: 'Music', ext: '.mp3', durationSec: 100, addedAt: '2026-01-01T00:00:00Z' },
      hidtrk: { id: 'hidtrk', title: 'SECRETTRACK', artist: 'B', album: 'Bl', filePath: hidTrackFile, rootFolder: hidRoot, folderName: 'Music', ext: '.mp3', durationSec: 100, addedAt: '2026-01-02T00:00:00Z' },
    };
    const p = podcastStore.ensurePodcasts(db);
    p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: OPEN_SUB, name: 'Open Show', feedUrl: 'https://e.com/o.xml' });
    podcastStore.reduceAddSubscription(p, { id: HID_SUB, name: 'Secret Show', feedUrl: 'https://e.com/s.xml' });
    podcastStore.reduceUpsertEpisodes(p, OPEN_SUB, [{ guid: 'og', title: 'Open Ep', pubDateMs: 1, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceUpsertEpisodes(p, HID_SUB, [{ guid: 'hg', title: 'SECRETEP', pubDateMs: 2, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, openEpId, { fileName: 'openep.mp3', filePath: openEpFile, bytes: 5, nowMs: 6000 });
    podcastStore.reduceEpisodeDownloaded(p, hidEpId, { fileName: 'SECRETEP.mp3', filePath: hidEpFile, bytes: 5, nowMs: 6000 });
    return true;
  });

  kid = __mintTestSession({ username: 'kidqueue', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'path', value: hidRoot }]);
  // Pre-seed the restricted member's queue with ALL THREE kinds, visible +
  // hidden (as if queued before the restriction, or via a restored bundle).
  userStore.setQueue(kid.user.id, [
    { uid: 'u1', mediaId: openId, kind: 'media' },
    { uid: 'u2', mediaId: hiddenId, kind: 'media' },
    { uid: 'u3', mediaId: 'opentrk', kind: 'track' },
    { uid: 'u4', mediaId: 'hidtrk', kind: 'track' },
    { uid: 'u5', mediaId: openEpId, kind: 'podcast' },
    { uid: 'u6', mediaId: hidEpId, kind: 'podcast' },
  ], 'u1', Date.now());
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const getQueue = (cookie) => fetch(`${base}/api/queue`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.json());
const addItem = (cookie, mediaId) => fetch(`${base}/api/queue/items`, {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: JSON.stringify({ mediaId }),
});

test('L9 read: a restricted member never sees the hidden queued entry or its title/path (all 3 kinds)', async () => {
  const q = await getQueue(kid.cookie);
  const ids = q.entries.map((e) => e.mediaId).sort();
  // The three VISIBLE entries survive; all three HIDDEN entries silent-drop.
  assert.deepStrictEqual(ids, [openId, 'opentrk', openEpId].sort(), 'only the 3 visible entries survive (media+track+podcast)');
  const text = JSON.stringify(q);
  assert.ok(!text.includes('SECRETCLIP'), 'no hidden media title');
  assert.ok(!text.includes('SECRETTRACK'), 'no hidden track title');
  assert.ok(!text.includes('SECRETEP'), 'no hidden episode title');
  assert.ok(!text.includes('Secret Show'), 'no hidden show name');
  assert.ok(!text.includes(hidRoot), 'no hidden path');
});

test('L9 insert: adding a hidden id 404s exactly like a nonexistent one (no oracle)', async () => {
  const hidStatus = (await addItem(kid.cookie, hiddenId)).status;
  const missingStatus = (await addItem(kid.cookie, 'deadbeefdeadbeefdeadbeefdeadbeef')).status;
  assert.strictEqual(hidStatus, 404, 'hidden id insert -> 404');
  assert.strictEqual(missingStatus, 404, 'missing id insert -> 404');
  assert.strictEqual(hidStatus, missingStatus, 'the two are indistinguishable');
  // The visible id still inserts.
  assert.strictEqual((await addItem(kid.cookie, openId)).status, 200, 'visible id inserts fine');
});

test('L9: an ADMIN sees BOTH queued entries (the reader still works)', async () => {
  userStore.setQueue(auth.user.id, [
    { uid: 'a1', mediaId: openId, kind: 'media' },
    { uid: 'a2', mediaId: hiddenId, kind: 'media' },
  ], 'a1', Date.now());
  const q = await getQueue(undefined);
  assert.deepStrictEqual(q.entries.map((e) => e.mediaId).sort(), [openId, hiddenId].sort(), 'admin sees both');
});
