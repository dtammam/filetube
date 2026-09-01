'use strict';

// [INTEGRATION] v1.79 home feed - GET /api/home. The route gathers per-user
// inputs, hands them to the pure lib/home/feed.js assembler (unit-covered in
// test/unit/home-feed.test.js), then resolves the selected ids to render
// fields SERVER-side. This file binds the route's behavior: per-user
// derivation, cross-kind continue/liked rows, the subscription join, dead-link
// skips, per-user isolation, prototype safety, and the resolver's three kind
// arms. Isolated DATA_DIR; own process (node --test); cleans up after itself
// (residual #110).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-home-api-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, updateDatabase, userStore,
  __mintTestSession, __resetDatabaseForTests, resolveHomeItem, getCachedDatabase,
} = require('../../server');
const musicStore = require('../../lib/music/store');
const podcastStore = require('../../lib/podcasts/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, uid, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  uid = auth.user.id;
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
beforeEach(async () => { await __resetDatabaseForTests(); });

function item(id, over = {}) {
  return {
    id, title: `Title ${id}`, filePath: `/media/Chan/${id}.mp4`, folderName: 'Chan',
    channelName: 'Chan', type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000, ...over,
  };
}
function seed(metadata, over = {}) {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    ...over,
  });
}
const getHome = async (opts = {}) => {
  const res = await fetch(`${base}/api/home`, opts);
  return { status: res.status, body: await res.json() };
};
const rowOf = (body, id) => (body.rows || []).find((r) => r.id === id) || null;

// ---------------------------------------------------------------------------
// AC1 - shape + server-resolved fields only
// ---------------------------------------------------------------------------

test('AC1: rows envelope; items carry only server-resolved fields', async () => {
  seed({ a: item('a', { addedAt: 10 }) });
  const { status, body } = await getHome();
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.rows));
  const ra = rowOf(body, 'recently-added');
  assert.ok(ra, 'a non-empty library always has recently-added');
  const it = ra.items[0];
  // v1.236: `type` now rides the row-feed media card (server-fold) so the client can reroute
  // audio downloads to the music player; `chapterCount` is added only for audio (this seed is a video).
  assert.deepStrictEqual(Object.keys(it).sort(), ['href', 'id', 'kind', 'progressPercent', 'subtitle', 'thumbnailUrl', 'title', 'type'].sort());
  assert.strictEqual(it.type, 'video', 'a video carries type:video and NO chapterCount');
  assert.strictEqual(it.title, 'Title a');
  assert.strictEqual(it.thumbnailUrl, '/thumbnail/a');
  assert.strictEqual(it.href, '/watch.html?v=a');
});

test('v1.236: an AUDIO row-feed card carries type:audio + chapterCount (server-fold for the music-player reroute)', async () => {
  seed({ s: item('s', { type: 'audio', ext: '.mp3', chapters: [{ startTime: 0, title: 'One' }, { startTime: 60, title: 'Two' }] }) });
  const { status, body } = await getHome();
  assert.strictEqual(status, 200);
  const ra = rowOf(body, 'recently-added');
  const it = ra.items.find((x) => x.id === 's');
  assert.ok(it, 'the audio download is in recently-added');
  assert.strictEqual(it.type, 'audio', 'type:audio rides the card so the client can reroute it');
  assert.strictEqual(it.chapterCount, 2, 'chapterCount rides an audio card (>=2 -> the client routes ::c0 to the album)');
  assert.strictEqual(it.href, '/watch.html?v=s', 'the server href stays /watch; the CLIENT (flag-gated) does the reroute');
});

// ---------------------------------------------------------------------------
// AC3 - continue-watching excludes finished, spans kinds
// ---------------------------------------------------------------------------

test('AC3: continue-watching includes in-progress, excludes finished/latched', async () => {
  seed({
    prog: item('prog'),      // in progress (35%)
    done: item('done'),      // 95% -> finished by threshold
    latched: item('latched'),// 40% but latched -> finished
    fresh: item('fresh'),    // untouched
  });
  userStore.setProgress(uid, 'prog', { timestamp: 35, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });
  userStore.setProgress(uid, 'done', { timestamp: 95, duration: 100, updatedAt: '2026-08-01T01:00:00Z' });
  userStore.setProgress(uid, 'latched', { timestamp: 40, duration: 100, updatedAt: '2026-08-01T02:00:00Z' });
  userStore.markWatched(uid, 'latched', '2026-08-01T02:00:00Z');

  const { body } = await getHome();
  const cw = rowOf(body, 'continue-watching');
  assert.ok(cw, 'continue-watching present');
  const ids = cw.items.map((i) => i.id);
  assert.deepStrictEqual(ids, ['prog'], 'only the in-progress, non-finished item');
  assert.ok(cw.items[0].progressPercent > 0, 'carries the bar percent');
});

test('AC3: continue-watching spans a music track (cross-kind)', async () => {
  seed({ v: item('v') });
  const trackId = 'a'.repeat(32);
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = { [trackId]: { id: trackId, filePath: '/music/s.mp3', rootFolder: '/music', ext: '.mp3', title: 'Song', artist: 'Artist', album: 'Album', albumArtKey: null, codec: 'mp3', durationSec: 200, addedAt: '2026-01-01T00:00:00Z' } };
    return true;
  });
  userStore.setProgress(uid, 'v', { timestamp: 30, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });
  userStore.setMusicProgress(uid, trackId, { position: 50, duration: 200, updatedAt: '2026-08-02T00:00:00Z' });

  const { body } = await getHome();
  const cw = rowOf(body, 'continue-watching');
  const track = cw.items.find((i) => i.kind === 'track');
  assert.ok(track, 'a music track rides the mixed continue-watching row');
  assert.strictEqual(track.href, `/music?play=${trackId}`);
  assert.strictEqual(track.title, 'Song');
});

// ---------------------------------------------------------------------------
// AC5 - recently-added includes watched (the thesis)
// ---------------------------------------------------------------------------

test('AC5: recently-added includes watched items, newest first', async () => {
  seed({ old: item('old', { addedAt: 10 }), mid: item('mid', { addedAt: 20 }), recent: item('recent', { addedAt: 30 }) });
  userStore.markWatched(uid, 'recent', '2026-08-01T00:00:00Z'); // watched but still newest

  const { body } = await getHome();
  const ra = rowOf(body, 'recently-added');
  assert.deepStrictEqual(ra.items.map((i) => i.id), ['recent', 'mid', 'old'], 'watched "recent" is NOT hidden');
});

// ---------------------------------------------------------------------------
// AC4 - new-from-subscriptions join + absence
// ---------------------------------------------------------------------------

test('AC4: new-from-subs only when a subscription folder matches; absent with no subs', async () => {
  // No subscriptions -> row absent.
  seed({ a: item('a', { folderName: 'Chan', channelName: 'Chan' }) });
  assert.strictEqual(rowOf((await getHome()).body, 'new-from-subs'), null, 'no subs -> no row');

  // A subscription named "Chan" -> the item under folder "Chan" is from-a-sub.
  await __resetDatabaseForTests();
  seed({ a: item('a', { folderName: 'Chan', channelName: 'Chan', addedAt: 30 }), b: item('b', { folderName: 'Other', channelName: 'Other', addedAt: 40 }) });
  await updateDatabase((db) => {
    if (!db.ytdlp || typeof db.ytdlp !== 'object') db.ytdlp = { allowMembersOnly: false, subscriptions: [] };
    db.ytdlp.subscriptions = [{ name: 'Chan', order: 0 }];
    return true;
  });
  const sub = rowOf((await getHome()).body, 'new-from-subs');
  assert.ok(sub, 'subscription match -> row present');
  assert.deepStrictEqual(sub.items.map((i) => i.id), ['a'], 'only the subscription-folder item; the non-sub "b" is excluded');
});

// ---------------------------------------------------------------------------
// AC2 - caps, empty omission, from-liked, watch-again
// ---------------------------------------------------------------------------

test('AC2: rows capped at 8; empty rows omitted', async () => {
  const md = {};
  for (let i = 0; i < 12; i++) md[`v${i}`] = item(`v${i}`, { addedAt: 100 + i });
  seed(md);
  const { body } = await getHome();
  assert.strictEqual(rowOf(body, 'recently-added').items.length, 8, 'capped');
  assert.strictEqual(rowOf(body, 'continue-watching'), null, 'no progress -> no continue row');
  assert.strictEqual(rowOf(body, 'from-liked'), null, 'no likes -> no liked row');
  assert.strictEqual(rowOf(body, 'watch-again'), null, 'nothing finished -> no watch-again');
});

test('AC2: from-liked and watch-again populate from their signals', async () => {
  seed({ liked: item('liked', { addedAt: 10 }), fin: item('fin', { addedAt: 20 }) });
  userStore.addLiked(uid, 'liked', '2026-08-01T00:00:00Z');
  userStore.setProgress(uid, 'fin', { timestamp: 100, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });
  userStore.markWatched(uid, 'fin', '2026-08-03T00:00:00Z');

  const { body } = await getHome();
  assert.deepStrictEqual(rowOf(body, 'from-liked').items.map((i) => i.id), ['liked']);
  assert.deepStrictEqual(rowOf(body, 'watch-again').items.map((i) => i.id), ['fin']);
});

// ---------------------------------------------------------------------------
// AC6 - per-user isolation
// ---------------------------------------------------------------------------

test('AC6: two users share a library but get different personal rows', async () => {
  seed({ x: item('x'), y: item('y') });
  userStore.setProgress(uid, 'x', { timestamp: 30, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });

  const mine = rowOf((await getHome()).body, 'continue-watching');
  assert.deepStrictEqual(mine.items.map((i) => i.id), ['x'], 'my progress -> my continue row');

  const other = __mintTestSession({ username: 'homeOther' });
  const theirs = rowOf((await getHome({ headers: { Cookie: other.cookie } })).body, 'continue-watching');
  assert.strictEqual(theirs, null, 'the other user has no progress -> no continue row');
  // ...but both see the shared library's recently-added.
  assert.ok(rowOf((await getHome({ headers: { Cookie: other.cookie } })).body, 'recently-added'));
});

// ---------------------------------------------------------------------------
// AC7 - prototype safety
// ---------------------------------------------------------------------------

test('AC7: a GENUINE own __proto__ media id never pollutes and never phantoms', async () => {
  // Adversarial gate SUGGESTION-1: an object-LITERAL `__proto__` key sets the
  // prototype (not an own key) and does not survive JSON, so the old fixture
  // never became a candidate - it proved nothing. Build the real hostile case:
  // an OWN "__proto__" key (JSON.parse makes it own, and it survives
  // saveDatabase's JSON round-trip) carrying a booby-trapped title.
  const md = JSON.parse('{"real":' + JSON.stringify(item('real', { addedAt: 5 }))
    + ',"__proto__":' + JSON.stringify(item('__proto__', { addedAt: 9, title: 'PWNED' })) + '}');
  seed(md);
  const { status, body } = await getHome();
  assert.strictEqual(status, 200, 'the hostile own key must not crash the route');
  // The booby-trapped title must NOT have leaked onto Object.prototype.
  assert.strictEqual(({}).title, undefined, 'Object.prototype was not polluted');
  assert.strictEqual(({}).PWNED, undefined);
  // The legitimate item still resolves; a prototype-chain-only id ('constructor',
  // never seeded) must never appear as a phantom card in any row.
  const ra = rowOf(body, 'recently-added');
  assert.ok(ra.items.some((i) => i.id === 'real'));
  for (const row of body.rows) {
    assert.ok(!row.items.some((i) => i.id === 'constructor'), 'no phantom from the prototype chain');
  }
});

// ---------------------------------------------------------------------------
// resolveHomeItem - the three kind arms + dead-link nulls (bound directly)
// ---------------------------------------------------------------------------

test('resolveHomeItem: media/track/podcast arms + dead-link nulls', async () => {
  seed({ vid: item('vid') });
  const trackId = 't'.repeat(32);
  const subId = 'b'.repeat(32);
  const showDir = path.join(DATA_DIR, 'podcasts', 'Show');
  fs.mkdirSync(showDir, { recursive: true });
  const mediaFile = path.join(showDir, 'ep.mp3');
  fs.writeFileSync(mediaFile, 'BYTES');
  const epId = podcastStore.episodeIdFor(subId, 'g1');
  await updateDatabase((db) => {
    const m = musicStore.ensureMusic(db);
    m.tracks = { [trackId]: { id: trackId, filePath: '/music/s.mp3', rootFolder: '/music', ext: '.mp3', title: 'T', artist: 'A', album: 'Al', albumArtKey: null, codec: 'mp3', durationSec: 100, addedAt: '2026-01-01T00:00:00Z' } };
    const p = podcastStore.ensurePodcasts(db);
    p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'The Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Ep', pubDateMs: 1, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epId, { fileName: 'ep.mp3', filePath: mediaFile, bytes: 5, nowMs: 6000 });
    const pendingEp = podcastStore.episodeIdFor(subId, 'g2');
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g2', title: 'Pending', pubDateMs: 2, durationSec: 10 }], 'pending', 5000);
    return { pendingEp };
  });
  const db = getCachedDatabase();

  assert.strictEqual(resolveHomeItem(db, 'vid', 'media', 12).href, '/watch.html?v=vid');
  assert.strictEqual(resolveHomeItem(db, trackId, 'track', 0).thumbnailUrl, `/albumart/${trackId}`);
  const pod = resolveHomeItem(db, epId, 'podcast', 30);
  assert.strictEqual(pod.title, 'Ep');
  assert.strictEqual(pod.subtitle, 'The Show');

  // dead links -> null (never a phantom card)
  assert.strictEqual(resolveHomeItem(db, 'ghost', 'media', 0), null, 'unknown media');
  assert.strictEqual(resolveHomeItem(db, 'nope', 'track', 0), null, 'unknown track');
  assert.strictEqual(resolveHomeItem(db, podcastStore.episodeIdFor(subId, 'g2'), 'podcast', 0), null, 'non-downloaded episode');
  assert.strictEqual(resolveHomeItem(db, '__proto__', 'media', 0), null, 'prototype key is not a phantom item');
});
