'use strict';

// [INTEGRATION] v1.72 (#94) - the MIXED-KIND Liked playlist. GET /api/liked
// merges liked videos (user_liked), podcast episodes (user_podcast_liked)
// and music tracks (user_music_liked) into ONE {items,total,offset,limit}
// listing with `kind` CARRIED on every item. Binds:
//
//   - the merge itself + kind carriage (kind:'media'|'podcast'|'track')
//   - each id space's silent-drop rule (non-downloaded episode dropped,
//     pruned track dropped) with the membership row SURVIVING the drop
//   - the same-id-both-kinds collision: one md5 id live as BOTH a media
//     row and an episode row, liked in both spaces, listed as TWO items;
//     unliking ONE kind at that destructive moment must not touch the
//     other (both rows are live when the DELETE fires - the v1.71 W3
//     vacuity lesson)
//   - actor isolation at the ROUTE layer: a second real session sees none
//     of the first user's mixed items (the v1.71 W4 lesson)
//   - the format/watch filters + total over the merged set (the sidebar
//     count reads this total - fetchLikedTotal)

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-likedmixed-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app,
  saveDatabase,
  updateDatabase,
  __mintTestSession,
  userStore,
} = require('../../server');
const podcastStore = require('../../lib/podcasts/store');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, uid;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base);
  uid = auth.user.id;
  // One subscription for the whole suite (episodes are seeded per test).
  fs.writeFileSync(epFile, 'mp3-bytes');
  const r = await postJson('/api/podcasts/subscriptions', { feedUrl: 'https://feeds.invalid/rss/show?x=1' });
  assert.strictEqual(r.status, 201);
  subId = (await r.json()).id;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const get = (p) => fetch(`${base}${p}`);
const postJson = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function baseSettings() {
  return { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 };
}

function seedItem(id, overrides) {
  return {
    id, title: id, filePath: `/media/${id}.mp4`, folderName: 'media',
    type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000,
    ...overrides,
  };
}

function seedTrack(id, overrides) {
  return {
    id, filePath: `/musicroot/${id}.flac`, rootFolder: '/musicroot', ext: '.flac',
    title: `Track ${id}`, artist: 'Artist', album: 'Album', albumArtKey: null,
    codec: 'flac', durationSec: 200, addedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

// One subscription for the whole suite; episodes are (re)seeded per test.
let subId;
const epFile = path.join(process.env.DATA_DIR, 'ep.mp3');

// Seed one downloaded episode under `guid`, return its server-derived id
// (episodeIdFor - the same md5 derivation the poll pipeline uses).
async function seedDownloadedEpisode(guid, opts = {}) {
  const epId = podcastStore.episodeIdFor(subId, guid);
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [
      { guid, title: opts.title || `Ep ${guid}`, pubDateMs: opts.pubDateMs || 1000, durationSec: opts.durationSec || 300 },
    ], 'pending', 2000);
    if (opts.download !== false) {
      podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: 'ep.mp3', filePath: epFile, bytes: 9, nowMs: opts.nowMs || 6000 });
    }
    return true;
  });
  return epId;
}

function clearAllLiked(userId) {
  for (const id of userStore.getLiked(userId)) userStore.removeLiked(userId, id);
  for (const row of userStore.getPodcastLiked(userId)) userStore.removePodcastLiked(userId, row.episodeId);
  for (const id of userStore.getMusicLiked(userId)) userStore.removeMusicLiked(userId, id);
}

beforeEach(() => clearAllLiked(uid));

test('the merge: one liked video + episode + track = three kind-carried items, total 3', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidA: seedItem('vidA') },
    liked: [], settings: baseSettings(),
  });
  const epId = await seedDownloadedEpisode('merge-g1');
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = { trkA: seedTrack('trkA') };
    return true;
  });

  assert.strictEqual((await postJson('/api/liked/vidA', {})).status, 200);
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epId}/liked`, {})).status, 200);
  assert.strictEqual((await fetch(`${base}/api/music/liked/trkA`, { method: 'POST' })).status, 200);

  const body = await (await get('/api/liked?sort=newest&limit=50')).json();
  assert.strictEqual(body.total, 3, 'the sidebar count total spans all three id spaces');
  const byKind = Object.fromEntries(body.items.map((it) => [it.kind, it]));
  assert.deepStrictEqual(Object.keys(byKind).sort(), ['media', 'podcast', 'track'], 'kind carried on every item');
  assert.strictEqual(byKind.media.id, 'vidA');
  assert.strictEqual(byKind.podcast.id, epId);
  assert.strictEqual(byKind.podcast.subId, subId, 'the episode item carries its art key (subId)');
  assert.strictEqual(byKind.track.id, 'trkA');
  assert.strictEqual(byKind.track.artist, 'Artist');
  // newest-first across kinds: episode downloadedAt 6000 > video addedAt
  // 5000 > track addedAt Date.parse('2026-01-02') ... which is LARGEST.
  assert.deepStrictEqual(body.items.map((i) => i.kind), ['track', 'podcast', 'media'], 'ONE merged sort orders across kinds by the same addedAt contract');
  for (const it of body.items) {
    assert.ok(!('filePath' in it) || it.kind === 'media', `server paths never leak on a shaped ${it.kind} item`);
  }
});

test('silent-drop scoping: a liked-but-not-downloaded episode and a liked-but-pruned track are dropped; their membership rows SURVIVE', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {}, liked: [], settings: baseSettings(),
  });
  const pendingEp = await seedDownloadedEpisode('drop-g1', { download: false });
  // Like the pending episode DIRECTLY at the carrier (the route 404s
  // nothing here - the row exists; only the playlist projection drops it).
  userStore.addPodcastLiked(uid, pendingEp, new Date().toISOString());
  // A liked track id with no surviving ns.tracks row (pruned library).
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {};
    return true;
  });
  userStore.addMusicLiked(uid, 'ghostTrack', new Date().toISOString());

  const body = await (await get('/api/liked')).json();
  assert.strictEqual(body.total, 0, 'both arms silently drop unresolvable members');
  assert.strictEqual(userStore.getPodcastLiked(uid).length, 1, 'the episode membership row survives the drop');
  assert.deepStrictEqual(userStore.getMusicLiked(uid), ['ghostTrack'], 'the track membership row survives the drop');
});

test('same-id-both-kinds collision: one id live as BOTH media and episode lists twice; unliking one kind leaves the other untouched', async () => {
  // Compute the episode's md5 id up front (pure derivation), seed the SAME
  // id as a media row, THEN seed the episode row - saveDatabase replaces
  // doc tables wholesale, so it must run before the podcasts seeding. Both
  // rows are live from here on; no re-key ever happens in this test.
  const epId = podcastStore.episodeIdFor(subId, 'collide-g1');
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [epId]: seedItem(epId) },
    liked: [], settings: baseSettings(),
  });
  assert.strictEqual(await seedDownloadedEpisode('collide-g1'), epId);
  assert.strictEqual((await postJson(`/api/liked/${epId}`, {})).status, 200, 'media like');
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epId}/liked`, {})).status, 200, 'podcast like, same id');

  let body = await (await get('/api/liked?limit=50')).json();
  assert.strictEqual(body.total, 2, 'the one id lists TWICE - once per kind');
  assert.deepStrictEqual(body.items.map((i) => i.kind).sort(), ['media', 'podcast']);
  assert.ok(body.items.every((i) => i.id === epId));

  // The destructive moment - both rows live RIGHT NOW: unlike the MEDIA
  // membership only.
  const un = await fetch(`${base}/api/liked/${epId}`, { method: 'DELETE' });
  assert.strictEqual(un.status, 200);

  body = await (await get('/api/liked?limit=50')).json();
  assert.strictEqual(body.total, 1, 'exactly one membership retired');
  assert.strictEqual(body.items[0].kind, 'podcast', 'the podcast like survived the media unlike');
  assert.strictEqual(userStore.getPodcastLiked(uid).length, 1);
  assert.deepStrictEqual(userStore.getLiked(uid), []);
});

test('actor isolation: a second real session sees NONE of the first user\'s mixed likes (route layer)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { isoVid: seedItem('isoVid') },
    liked: [], settings: baseSettings(),
  });
  const epId = await seedDownloadedEpisode('iso-g1');
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = { isoTrk: seedTrack('isoTrk') };
    return true;
  });
  await postJson('/api/liked/isoVid', {});
  await postJson(`/api/podcasts/episodes/${epId}/liked`, {});
  await fetch(`${base}/api/music/liked/isoTrk`, { method: 'POST' });
  assert.strictEqual((await (await get('/api/liked')).json()).total, 3, 'owner sees all three');

  const second = __mintTestSession({ username: 'likedMixedOther' });
  const asOther = await fetch(`${base}/api/liked`, { headers: { Cookie: second.cookie } });
  assert.strictEqual(asOther.status, 200);
  const otherBody = await asOther.json();
  assert.strictEqual(otherBody.total, 0, 'the second user sees an empty playlist');
  assert.deepStrictEqual(otherBody.items, []);
});

test('filters over the merged set: format=video hides audio kinds; watch=watched surfaces a PLAYED episode (the latch is the watched authority)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { fmtVid: seedItem('fmtVid') },
    liked: [], settings: baseSettings(),
  });
  const epId = await seedDownloadedEpisode('fmt-g1');
  await postJson('/api/liked/fmtVid', {});
  await postJson(`/api/podcasts/episodes/${epId}/liked`, {});

  const videoOnly = await (await get('/api/liked?format=video')).json();
  assert.strictEqual(videoOnly.total, 1);
  assert.strictEqual(videoOnly.items[0].kind, 'media');

  const audioOnly = await (await get('/api/liked?format=audio')).json();
  assert.strictEqual(audioOnly.total, 1);
  assert.strictEqual(audioOnly.items[0].kind, 'podcast');

  // Latch the episode played (the manual toggle route), then watch=watched.
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epId}/played`, { played: true })).status, 200);
  const watched = await (await get('/api/liked?watch=watched')).json();
  assert.strictEqual(watched.total, 1, 'the played latch IS the watched state for a podcast item');
  assert.strictEqual(watched.items[0].kind, 'podcast');
  assert.strictEqual(watched.items[0].watchState, 'watched');

  const fresh = await (await get('/api/liked?watch=new')).json();
  assert.deepStrictEqual(fresh.items.map((i) => i.kind), ['media'], 'the un-started video stays new');
});
