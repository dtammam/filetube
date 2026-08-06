'use strict';

// [INTEGRATION] v1.84 T2 - GET /api/home?view=grid&filter=<chip>. The Modern-
// mode FLAT grid: a dedicated gather over the media library (video+audio) +
// downloaded podcasts, filtered per chip, recency-sorted, capped, enriched to
// the rich card shape. Binds: the six chips' subsets; the video/audio type
// split; podcast inclusion; continue/unwatched watch-state; the RICH item
// fields incl. channelAvatarUrl; hidden-folder exclusion (v1.80 leak class);
// CROSS-USER isolation (two distinct users); recency order; the disclosed cap.
// Isolated DATA_DIR; own process; cleans up (residual #110).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-modern-grid-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, updateDatabase, userStore, __mintTestSession, __resetDatabaseForTests,
} = require('../../server');
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
    folders: [], folderSettings: {}, progress: {}, metadata, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    ...over,
  });
}
const grid = async (filter, opts = {}) => {
  const { sort, ...init } = opts; // v1.86.0: opts.sort -> &sort=, rest -> fetch init (headers)
  const q = filter ? `&filter=${filter}` : '';
  const s = sort ? `&sort=${sort}` : '';
  const res = await fetch(`${base}/api/home?view=grid${q}${s}`, init);
  return { status: res.status, body: await res.json() };
};
const ids = (body) => (body.items || []).map((i) => i.id);

// Seed a downloaded podcast episode (+ an optional pending one) under sub 'S'.
function seedPodcast() {
  const subId = 'sub-S';
  const dlId = podcastStore.episodeIdFor(subId, 'g1');
  const pendId = podcastStore.episodeIdFor(subId, 'g2');
  updateDatabase((db) => {
    const p = podcastStore.ensurePodcasts(db);
    p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'The Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Ep One', pubDateMs: 1, durationSec: 120 }], 'pending', 7000);
    podcastStore.reduceEpisodeDownloaded(p, dlId, { fileName: 'ep.mp3', filePath: '/x/ep.mp3', bytes: 5, nowMs: 7000 });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g2', title: 'Pending', pubDateMs: 2, durationSec: 10 }], 'pending', 7000);
    return db;
  });
  return { subId, dlId, pendId };
}

test('shape: a media grid item carries the RICH card fields (incl. channelAvatarUrl)', async () => {
  seed({ v: item('v', { sourceViewCount: 4242, channelAvatarUrl: 'https://cdn/a.jpg', channelName: 'Chan' }) });
  const { status, body } = await grid('all');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.filter, 'all');
  const it = body.items.find((i) => i.id === 'v');
  assert.ok(it, 'the item is present');
  assert.strictEqual(it.kind, 'media');
  assert.strictEqual(it.type, 'video');
  assert.strictEqual(it.channelName, 'Chan');
  assert.strictEqual(it.channelAvatarUrl, 'https://cdn/a.jpg', 'the channel avatar flows through (Dean\'s subscription-avatar reuse)');
  assert.strictEqual(it.sourceViewCount, 4242);
  assert.strictEqual(it.duration, 100);
});

test('#4: a media grid item is field-complete for the card corners (watchUrl + ext)', async () => {
  seed({ y: item('y', { youtubeId: 'dQw4w9WgXcQ', ext: '.mkv' }) });
  const it = (await grid('all')).body.items.find((i) => i.id === 'y');
  assert.strictEqual(it.ext, '.mkv', 'ext carried -> the download corner gets a real filename');
  assert.strictEqual(it.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'watchUrl carried -> the Share corner renders (it was silently empty in modern before)');
});

test('#4: a non-YouTube media item omits watchUrl (Share correctly absent), keeps ext', async () => {
  seed({ local: item('local', { ext: '.avi' }) }); // no youtubeId
  const it = (await grid('all')).body.items.find((i) => i.id === 'local');
  assert.strictEqual(it.ext, '.avi');
  assert.ok(!('watchUrl' in it), 'no youtubeId -> no watchUrl -> Share renders nothing, exactly like /api/videos');
});

test('videos vs audio: the type split is exact', async () => {
  seed({
    v1: item('v1', { type: 'video' }),
    a1: item('a1', { type: 'audio', ext: '.mp3', filePath: '/media/Chan/a1.mp3' }),
  });
  assert.deepStrictEqual(ids((await grid('videos')).body), ['v1']);
  assert.deepStrictEqual(ids((await grid('audio')).body), ['a1']);
});

test('podcasts + all: downloaded episodes appear; pending does not; all mixes kinds', async () => {
  seed({ v: item('v') });
  const { dlId, pendId } = seedPodcast();

  const pods = ids((await grid('podcasts')).body);
  assert.ok(pods.includes(dlId), 'the downloaded episode is in Podcasts');
  assert.ok(!pods.includes(pendId), 'a pending (not-downloaded) episode is never surfaced');
  assert.ok(!pods.includes('v'), 'a video is not in Podcasts');

  const all = ids((await grid('all')).body);
  assert.ok(all.includes('v') && all.includes(dlId), 'All mixes media + podcasts');
});

test('continue: in-progress media AND in-progress podcast; excludes finished/untouched', async () => {
  seed({
    prog: item('prog'), done: item('done'), fresh: item('fresh'),
  });
  const { dlId } = seedPodcast();
  userStore.setProgress(uid, 'prog', { timestamp: 35, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });
  userStore.setProgress(uid, 'done', { timestamp: 96, duration: 100, updatedAt: '2026-08-01T01:00:00Z' }); // finished
  userStore.setPodcastProgress(uid, dlId, { position: 30, duration: 120, updatedAt: '2026-08-01T02:00:00Z' });

  const c = ids((await grid('continue')).body);
  assert.ok(c.includes('prog'), 'in-progress media');
  assert.ok(c.includes(dlId), 'in-progress podcast');
  assert.ok(!c.includes('done'), 'finished media excluded');
  assert.ok(!c.includes('fresh'), 'untouched media excluded');
});

test('unwatched: not-watched media only; watched + finished-by-threshold out; podcasts out', async () => {
  seed({ seen: item('seen'), unseen: item('unseen'), nearDone: item('nearDone') });
  const { dlId } = seedPodcast();
  userStore.markWatched(uid, 'seen', '2026-08-01T00:00:00Z');
  // 95% watched but NEVER latched -> finished-by-threshold; must NOT be "unwatched".
  userStore.setProgress(uid, 'nearDone', { timestamp: 95, duration: 100, updatedAt: '2026-08-01T03:00:00Z' });

  const u = ids((await grid('unwatched')).body);
  assert.ok(u.includes('unseen'), 'a not-watched video is in Unwatched');
  assert.ok(!u.includes('seen'), 'a latched video is out');
  assert.ok(!u.includes('nearDone'), 'a 95%-watched unlatched video is out (finished-by-threshold)');
  assert.ok(!u.includes(dlId), 'podcasts (no watched latch) are never in Unwatched');
});

test('v1.80 leak class: an item under a HIDDEN folder never appears in the grid', async () => {
  // Hidden folders are keyed by PATH PREFIX (underFolder), exactly as the row
  // path reads them - so the key is the folder path, and buried lives under it.
  seed(
    { shown: item('shown'), buried: item('buried', { folderName: 'Secret', channelName: 'Secret', filePath: '/media/Secret/buried.mp4' }) },
    { folderSettings: { '/media/Secret': { hidden: true } } },
  );
  const all = ids((await grid('all')).body);
  assert.ok(all.includes('shown'));
  assert.ok(!all.includes('buried'), 'a hidden-folder item is filtered exactly like the row path');
});

test('cross-user isolation: continue-watching reflects the ACTING user only (two distinct users)', async () => {
  seed({ mine: item('mine'), theirs: item('theirs') });
  const other = __mintTestSession({ username: 'gridOther' });
  // userA is watching 'mine'; userB is watching 'theirs'.
  userStore.setProgress(uid, 'mine', { timestamp: 20, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });
  userStore.setProgress(other.user.id, 'theirs', { timestamp: 20, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });

  assert.deepStrictEqual(ids((await grid('continue')).body), ['mine'], 'userA sees only their own progress');
  assert.deepStrictEqual(
    ids((await grid('continue', { headers: { Cookie: other.cookie } })).body), ['theirs'],
    'userB sees only theirs - no leak across users',
  );
});

test('recency: items are newest-first by addedAt', async () => {
  seed({ old: item('old', { addedAt: 100 }), mid: item('mid', { addedAt: 200 }), new: item('new', { addedAt: 300 }) });
  assert.deepStrictEqual(ids((await grid('videos')).body), ['new', 'mid', 'old']);
});

test('T4: /api/channels flags subscribed channels (isSub) for the avatar bar', async () => {
  seed(
    {
      s1: item('s1', { folderName: 'SubChan', channelName: 'SubChan', filePath: '/media/SubChan/s1.mp4', addedAt: 900 }),
      p1: item('p1', { folderName: 'PlainChan', channelName: 'PlainChan', filePath: '/media/PlainChan/p1.mp4', addedAt: 800 }),
    },
    { ytdlp: { allowMembersOnly: false, subscriptions: [{ name: 'SubChan', order: 0 }] } },
  );
  const res = await fetch(`${base}/api/channels`);
  const { channels } = await res.json();
  const sub = channels.find((c) => c.folder === 'SubChan');
  const plain = channels.find((c) => c.folder === 'PlainChan');
  assert.strictEqual(sub.isSub, true, 'a subscribed channel is flagged isSub');
  assert.strictEqual(plain.isSub, false, 'a plain (non-subscription) channel is not');
  assert.strictEqual(sub.latestAddedAt, 900, 'latestAddedAt carries the recency the bar sorts by');
});

test('#3a: /api/channels resolves the avatar from the channelId registry, not just the baked field', async () => {
  // The channel's videos bake NO channelAvatarUrl, but the registry (what the
  // Subscriptions menu + per-card avatar use) has the photo. The bar must show it.
  const CHID = 'UC-lHJZR3Gqxm24_Vd_AJ5Yw'; // valid UC + 22-char shape
  seed(
    { r1: item('r1', { folderName: 'Reg', channelName: 'Reg', channelId: CHID, channelAvatarUrl: '' }) },
    { ytdlp: { allowMembersOnly: false, subscriptions: [{ name: 'Reg', order: 0 }], channelAvatars: { [CHID]: { avatarUrl: 'https://cdn/reg.jpg', channelUrl: '', fetchedAt: 1 } } } },
  );
  const { channels } = await (await fetch(`${base}/api/channels`)).json();
  const reg = channels.find((c) => c.folder === 'Reg');
  assert.strictEqual(reg.avatarUrl, 'https://cdn/reg.jpg', 'the registry photo shows even though items baked no URL (Dean: Subs shows it, the bar did not)');
  assert.strictEqual(reg.isSub, true);
});

test('the 60-item cap is DISCLOSED via truncated:true, never silent', async () => {
  const meta = {};
  for (let i = 0; i < 65; i++) meta[`m${i}`] = item(`m${i}`, { addedAt: 1000 + i });
  seed(meta);
  const { body } = await grid('all');
  assert.strictEqual(body.items.length, 60, 'capped at 60');
  assert.strictEqual(body.truncated, true, 'the cap is disclosed');
});

// ---- v1.86.0 (Dean): the whole-library sort --------------------------------

test('sort applies to the WHOLE library BEFORE the 60-cap (oldest surfaces a globally-old item, not oldest-of-newest-60)', async () => {
  const meta = {};
  // 65 items, addedAt ascending: g0 (globally oldest) .. g64 (globally newest).
  for (let i = 0; i < 65; i++) meta[`g${i}`] = item(`g${i}`, { addedAt: 1000 + i });
  seed(meta);

  // Default (newest): g64 leads, and the globally-oldest g0 is BELOW the 60-cap.
  const newest = ids((await grid('all')).body);
  assert.strictEqual(newest[0], 'g64', 'newest-first default');
  assert.ok(!newest.includes('g0'), 'the globally-oldest item is NOT in the newest-60 snapshot');

  // Oldest: g0 (globally oldest) leads. This ONLY happens if the sort ran on the
  // FULL candidate set before the cap - a cap-then-sort would never surface g0.
  const oldest = (await grid('all', { sort: 'oldest' })).body;
  assert.strictEqual(oldest.sort, 'oldest', 'the response echoes the resolved sort');
  assert.strictEqual(ids(oldest)[0], 'g0', 'oldest-first surfaces the globally-oldest item -> sort BEFORE cap');
  assert.strictEqual(oldest.items.length, 60, 'still capped at 60');
  assert.strictEqual(oldest.truncated, true);
});

test('sort: unknown/absent -> newest; title and size sorts order correctly', async () => {
  seed({
    a: item('a', { title: 'Apple', size: 300, addedAt: 100 }),
    b: item('b', { title: 'Banana', size: 100, addedAt: 200 }),
    c: item('c', { title: 'Cherry', size: 200, addedAt: 300 }),
  });
  assert.deepStrictEqual(ids((await grid('all', { sort: 'bogus' })).body), ['c', 'b', 'a'], 'unknown sort -> newest');
  assert.strictEqual((await grid('all', { sort: 'bogus' })).body.sort, 'newest', 'echoes the bounded value');
  assert.deepStrictEqual(ids((await grid('all', { sort: 'title-asc' })).body), ['a', 'b', 'c'], 'title A-Z');
  assert.deepStrictEqual(ids((await grid('all', { sort: 'title-desc' })).body), ['c', 'b', 'a'], 'title Z-A');
  assert.deepStrictEqual(ids((await grid('all', { sort: 'size-desc' })).body), ['a', 'c', 'b'], 'largest first');
  assert.deepStrictEqual(ids((await grid('all', { sort: 'size-asc' })).body), ['b', 'c', 'a'], 'smallest first');
});

test('sort does not bypass RBAC/hidden-folder exclusion (sort runs on the already-filtered set)', async () => {
  seed(
    { shown: item('shown', { addedAt: 100 }), buried: item('buried', { addedAt: 999, folderName: 'Secret', channelName: 'Secret', filePath: '/media/Secret/buried.mp4' }) },
    { folderSettings: { '/media/Secret': { hidden: true } } },
  );
  // Even sorting by newest (where buried's addedAt=999 would lead), the hidden
  // item must never surface - the sort operates on the post-RBAC candidate set.
  for (const sort of ['newest', 'oldest', 'size-desc', 'random']) {
    const got = ids((await grid('all', { sort })).body);
    assert.ok(got.includes('shown'), `shown present under sort=${sort}`);
    assert.ok(!got.includes('buried'), `hidden item excluded under sort=${sort} (no leak via sort)`);
  }
});
