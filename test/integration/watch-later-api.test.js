'use strict';

// [INTEGRATION] v1.343 Watch later. Routes, ownership, visibility, finish
// auto-removal (only on a WATCHED_PCT crossing), the reorder race, and the
// server-side "Play all" queue feed. Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-watchlater-api-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession, __resetDatabaseForTests } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, uid, kid, hidRoot;

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

function item(id, over = {}) {
  return { id, title: `Title ${id}`, filePath: `/media/Chan/${id}.mp4`, folderName: 'Chan', channelName: 'Chan',
    type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000, ...over };
}
function seed(metadata, folders = []) {
  seedState({ folders, folderSettings: {}, metadata, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
}
beforeEach(async () => {
  await __resetDatabaseForTests();
  hidRoot = path.join(DATA_DIR, 'HiddenRoot');
  kid = null;
});

const J = { 'Content-Type': 'application/json' };
const hdr = (cookie) => Object.assign({}, J, cookie ? { Cookie: cookie } : {});
const add = (id, cookie) => fetch(`${base}/api/watch-later/${encodeURIComponent(id)}`, { method: 'POST', headers: cookie ? { Cookie: cookie } : {} });
const del = (id, cookie) => fetch(`${base}/api/watch-later/${encodeURIComponent(id)}`, { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });
const order = (ids, cookie) => fetch(`${base}/api/watch-later/order`, { method: 'PUT', headers: hdr(cookie), body: JSON.stringify({ ids }) });
const list = async (q = '', cookie) => (await fetch(`${base}/api/watch-later${q}`, { headers: cookie ? { Cookie: cookie } : {} })).json();
const idsOf = async (cookie) => (await (await fetch(`${base}/api/watch-later/ids`, { headers: cookie ? { Cookie: cookie } : {} })).json()).ids;
const ping = (id, timestamp, duration = 100) => fetch(`${base}/api/progress`, { method: 'POST', headers: J, body: JSON.stringify({ id, timestamp, duration }) });

test('add / list in order / remove; the list is shaped like Liked media with watchLater true', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['b', 'a', 'c']) assert.strictEqual((await add(id)).status, 200);
  assert.strictEqual((await add('b')).status, 200, 're-add is fine');
  const l = await list();
  assert.deepEqual(l.items.map((i) => i.id), ['b', 'a', 'c'], 'add order, not library order');
  assert.strictEqual(l.total, 3);
  assert.ok(l.items.every((i) => i.watchLater === true && i.kind === 'media'));
  assert.deepEqual(await idsOf(), ['b', 'a', 'c']);
  assert.strictEqual((await del('a')).status, 200);
  assert.strictEqual((await del('a')).status, 200, 'DELETE is idempotent');
  assert.deepEqual((await list()).items.map((i) => i.id), ['b', 'c']);
});

test('POST 404s a missing id and refuses __proto__ (nothing is stored)', async () => {
  seed({ a: item('a') });
  assert.strictEqual((await add('nope')).status, 404);
  assert.strictEqual((await add('__proto__')).status, 404);
  assert.strictEqual((await add('constructor')).status, 404);
  assert.deepEqual(await idsOf(), []);
});

test('another user never sees or affects my list', async () => {
  seed({ a: item('a'), b: item('b') });
  kid = __mintTestSession({ username: 'kidwl', role: 'member' });
  await add('a');
  assert.deepEqual(await idsOf(kid.cookie), []);
  assert.deepEqual((await list('', kid.cookie)).items, []);
  await add('b', kid.cookie);
  await del('a', kid.cookie);
  await order(['b', 'a'], kid.cookie);
  assert.deepEqual(await idsOf(), ['a'], 'my list is untouched by the other member');
  assert.deepEqual(await idsOf(kid.cookie), ['b']);
});

test('a restricted member: POST of a hidden id 404s like a missing one; a hidden id already stored never lists', async () => {
  const hid = item('hid', { filePath: path.join(hidRoot, 'Vault', 'hid.mp4'), rootFolder: hidRoot, folderName: 'Vault', title: 'SECRETCLIP' });
  seed({ open: item('open'), hid }, [hidRoot]);
  kid = __mintTestSession({ username: 'kidwl2', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'path', value: hidRoot }]);
  const hidStatus = (await add('hid', kid.cookie)).status;
  const missStatus = (await add('deadbeef', kid.cookie)).status;
  assert.strictEqual(hidStatus, 404);
  assert.strictEqual(hidStatus, missStatus, 'no oracle');
  assert.strictEqual((await add('open', kid.cookie)).status, 200);
  userStore.addWatchLater(kid.user.id, 'hid', new Date().toISOString()); // stored before the restriction
  const l = await list('', kid.cookie);
  assert.deepEqual(l.items.map((i) => i.id), ['open']);
  assert.ok(!JSON.stringify(l).includes('SECRETCLIP'));
  const q = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: hdr(kid.cookie) }).then((r) => r.json());
  assert.strictEqual(q.added, 1, 'only the visible id was added');
  assert.deepEqual(userStore.getQueue(kid.user.id).entries.map((e) => e.mediaId), ['open'], 'the STORED queue never holds the hidden id');
  assert.deepEqual(q.queue.entries.map((e) => e.mediaId), ['open'], 'Play all skips the hidden id too');
});

test('a deleted / trashed id (gone from the library) is skipped at read time, never an error', async () => {
  seed({ a: item('a'), b: item('b') });
  await add('a'); await add('b');
  seed({ b: item('b') });
  const l = await list();
  assert.deepEqual(l.items.map((i) => i.id), ['b']);
  assert.strictEqual(l.total, 1);
});

test('PUT order: validates the body; reorders; a stale order never drops a new item or resurrects a removed one', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c'), d: item('d') });
  for (const id of ['a', 'b', 'c']) await add(id);
  assert.strictEqual((await fetch(`${base}/api/watch-later/order`, { method: 'PUT', headers: J, body: JSON.stringify({ ids: 'a' }) })).status, 400);
  assert.strictEqual((await order([1, 2])).status, 400);
  assert.strictEqual((await order(new Array(5001).fill('a'))).status, 400);
  assert.strictEqual((await order(['c', 'a', 'b'])).status, 200);
  assert.deepEqual(await idsOf(), ['c', 'a', 'b']);
  await del('a'); await add('d');
  await order(['b', 'a', 'c']); // stale: still lists the removed 'a', misses the new 'd'
  assert.deepEqual(await idsOf(), ['b', 'c', 'd']);
});

test('GET honours limit/offset and the watch filter', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['a', 'b', 'c']) await add(id);
  const page = await list('?limit=1&offset=1');
  assert.deepEqual(page.items.map((i) => i.id), ['b']);
  assert.strictEqual(page.total, 3);
  await fetch(`${base}/api/watched/b`, { method: 'POST' });
  await add('b');
  assert.deepEqual((await list('?watch=new')).items.map((i) => i.id), ['a', 'c']);
  assert.deepEqual((await list('?watch=watched')).items.map((i) => i.id), ['b']);
});

test('finish rule: a ping below 90% never removes; at or above 90% removes; manual mark-watched removes', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['a', 'b', 'c']) await add(id);
  assert.strictEqual((await ping('a', 50)).status, 200);
  assert.strictEqual((await ping('a', 89)).status, 200);
  assert.deepEqual(await idsOf(), ['a', 'b', 'c'], 'an unfinished item is never removed');
  assert.strictEqual((await ping('a', 95)).status, 200);
  assert.deepEqual(await idsOf(), ['b', 'c'], 'finishing removes it');
  assert.strictEqual((await fetch(`${base}/api/watched/b`, { method: 'POST' })).status, 200);
  assert.deepEqual(await idsOf(), ['c'], 'mark-watched removes it');
});

test('POST /api/queue/watch-later: list order, skips dead ids, reports added, and 0 added leaves the queue alone', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['c', 'a', 'b']) await add(id);
  userStore.addWatchLater(uid, 'ghost', new Date().toISOString());
  const r = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: J });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.added, 3);
  assert.deepEqual(body.queue.entries.map((e) => e.mediaId), ['c', 'a', 'b']);
  assert.ok(body.first);
  await __resetDatabaseForTests();
  seed({ a: item('a') });
  const empty = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: J }).then((x) => x.json());
  assert.strictEqual(empty.added, 0);
});

test('POST /api/queue/watch-later stops at the queue cap: adds what fits, reports full, never overfills', async () => {
  const queueStore = require('../../lib/queue/store');
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['a', 'b', 'c']) await add(id);
  let state = { entries: [], pointerUid: null };
  for (let i = 0; i < queueStore.QUEUE_CAP - 1; i += 1) state = queueStore.reduceAdd(state, `filler${i}`, 'end', 'media').state;
  userStore.setQueue(uid, state.entries, state.pointerUid, Date.now());
  const body = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: J }).then((r) => r.json());
  assert.strictEqual(body.added, 1, 'only the one that fits');
  assert.strictEqual(body.full, true);
  assert.strictEqual(userStore.getQueue(uid).entries.length, queueStore.QUEUE_CAP);
});

// ---- v1.376.0 W2: a podcast EPISODE in Watch later (Dean: "podcasts get the same options") ----
// The row key is `podcast:<episodeId>` in the existing table (userStore.watchLaterKey); the kind
// is STATED by the caller (`kind=podcast`). Bound: add (body and query), the neutral 404 for a
// missing / pending / trashed / hidden episode, the mixed list (shaped like a Liked episode),
// Play all ('podcast' queue entries), every way out (DELETE, finish at 95%, mark played, the
// purge carrier), no cross-kind bleed, and the media contract unchanged.
const { podcastsDb, updateDatabase } = require('../../server');
const pstore = require('../../lib/podcasts/store');

async function seedEpisodes(spec) {
  // spec: [{ guid, status? ('downloaded' default | 'pending' | 'trashed'), feed? }]
  const out = {};
  for (const e of spec) {
    const feed = e.feed || 'https://feeds.invalid/rss/wl';
    const subId = pstore.subscriptionIdFor(feed);
    const epId = pstore.episodeIdFor(subId, e.guid);
    const file = path.join(DATA_DIR, 'podcasts', `wl-${e.guid}.mp3`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'mp3');
    await updateDatabase(() => podcastsDb.mutate((db) => {
      const ns = pstore.ensurePodcasts(db);
      if (!ns.subscriptions.some((x) => x && x.id === subId)) {
        ns.subscriptions.push(pstore.subscriptionRecordFrom({ id: subId, feed: { feedUrlDisplay: feed }, name: `Shöw ${feed.slice(-2)}`, backfill: 'all', nowMs: 1000, order: 0 }));
      }
      pstore.reduceUpsertEpisodes(ns, subId, [{ guid: e.guid, title: `Ep ${e.guid}`, pubDateMs: 1000, durationSec: 60 }], 'pending', 1000);
      if (e.status !== 'pending') pstore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(file), filePath: file, bytes: 3, nowMs: 1000 });
      if (e.status === 'trashed') pstore.reduceEpisodeTrashed(ns, epId, { trashPath: file + '.trash', nowMs: 2000 });
      return true;
    }));
    out[e.guid] = { epId, subId };
  }
  return out;
}
const addPod = (id, cookie, via = 'body') => fetch(`${base}/api/watch-later/${encodeURIComponent(id)}${via === 'query' ? '?kind=podcast' : ''}`, {
  method: 'POST', headers: hdr(cookie), body: via === 'body' ? JSON.stringify({ kind: 'podcast' }) : undefined,
});
const delPod = (id, cookie) => fetch(`${base}/api/watch-later/${encodeURIComponent(id)}?kind=podcast`, { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });

test('W2: an episode adds (body or query kind), lists MIXED in the user order shaped like a Liked episode, and the ids carry its key', async () => {
  seed({ v1: item('v1'), v2: item('v2') });
  const eps = await seedEpisodes([{ guid: 'a' }, { guid: 'b' }]);
  assert.strictEqual((await add('v1')).status, 200);
  assert.strictEqual((await addPod(eps.a.epId)).status, 200);
  assert.strictEqual((await add('v2')).status, 200);
  assert.strictEqual((await addPod(eps.b.epId, undefined, 'query')).status, 200);
  assert.deepEqual(await idsOf(), ['v1', `podcast:${eps.a.epId}`, 'v2', `podcast:${eps.b.epId}`]);
  const l = await list();
  assert.deepEqual(l.items.map((i) => [i.kind, i.id]), [['media', 'v1'], ['podcast', eps.a.epId], ['media', 'v2'], ['podcast', eps.b.epId]]);
  const ep = l.items[1];
  assert.deepEqual([ep.title, ep.type, ep.subId, ep.showName, ep.watchLater, ep.liked], ['Ep a', 'audio', eps.a.subId, 'Shöw wl', true, false]);
  assert.strictEqual(l.total, 4);
  assert.deepEqual((await list('?format=video')).items.map((i) => i.id), ['v1', 'v2'], 'the format filter treats an episode as audio');
  assert.deepEqual((await list('?format=audio')).items.map((i) => i.id), [eps.a.epId, eps.b.epId]);
  // the media contract is unchanged: no kind = media, and an episode id WITHOUT the kind is a missing media id
  assert.strictEqual((await add(eps.a.epId)).status, 404, 'an episode id sent as media is not found (kind is stated, never inferred)');
});

test('W2: the neutral 404 - a missing, pending, trashed or HIDDEN episode never stores (no oracle)', async () => {
  seed({});
  const eps = await seedEpisodes([{ guid: 'ok' }, { guid: 'pend', status: 'pending' }, { guid: 'tr', status: 'trashed' }]);
  for (const id of [eps.pend.epId, eps.tr.epId, 'deadbeef', '__proto__']) {
    assert.strictEqual((await addPod(id)).status, 404, `refused: ${id}`);
  }
  kid = __mintTestSession({ username: 'kidwlpod', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'library', value: 'podcasts' }]);
  const hidden = await addPod(eps.ok.epId, kid.cookie);
  assert.strictEqual(hidden.status, 404, 'a podcasts-restricted member cannot add a hidden episode');
  assert.deepEqual(await hidden.json(), await (await addPod('deadbeef', kid.cookie)).json(), 'the same body as a missing one');
  assert.deepEqual(await idsOf(kid.cookie), [], 'nothing stored for the member');
  assert.deepEqual(await idsOf(), [], 'nothing stored for anyone');
  // A row stored BEFORE the restriction never lists, never queues.
  userStore.addWatchLater(kid.user.id, `podcast:${eps.ok.epId}`, new Date().toISOString());
  const l = await list('', kid.cookie);
  assert.deepEqual(l.items, []);
  assert.ok(!JSON.stringify(l).includes('Ep ok'));
  const q = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: hdr(kid.cookie) }).then((r) => r.json());
  assert.strictEqual(q.added, 0);
  assert.deepEqual(userStore.getQueue(kid.user.id).entries, [], 'Play all queued nothing hidden');
});

test('W2: a video-restricted member can still list an episode (the PODCAST gate decides, not the media one)', async () => {
  seed({ v1: item('v1') });
  const eps = await seedEpisodes([{ guid: 'g' }]);
  kid = __mintTestSession({ username: 'kidwlvid', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'library', value: 'video' }]);
  assert.strictEqual((await addPod(eps.g.epId, kid.cookie)).status, 200);
  assert.strictEqual((await add('v1', kid.cookie)).status, 404, 'the video gate still bites on media');
  assert.deepEqual((await list('', kid.cookie)).items.map((i) => i.id), [eps.g.epId]);
});

test('W2: Play all queues an episode as a podcast entry, in list order with the videos', async () => {
  seed({ v1: item('v1') });
  const eps = await seedEpisodes([{ guid: 'p' }, { guid: 'gone', status: 'trashed' }]);
  await addPod(eps.p.epId);
  await add('v1');
  userStore.addWatchLater(uid, `podcast:${eps.gone.epId}`, new Date().toISOString());
  const q = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: J }).then((r) => r.json());
  assert.strictEqual(q.added, 2, 'the trashed episode is skipped');
  assert.deepEqual(userStore.getQueue(uid).entries.map((e) => [e.kind, e.mediaId]), [['podcast', eps.p.epId], ['media', 'v1']]);
  assert.strictEqual(q.first.mediaId, eps.p.epId);
});

test('W2: every way out - DELETE with the kind, finishing at 95%, mark played, the purge carrier; a media id twin is untouched', async () => {
  const eps = await seedEpisodes([{ guid: 'x' }, { guid: 'y' }, { guid: 'z' }, { guid: 'w' }]);
  seed({ [eps.w.epId]: item(eps.w.epId) }); // a MEDIA item whose id equals an episode id: the kinds never touch
  for (const g of ['x', 'y', 'z', 'w']) await addPod(eps[g].epId);
  await add(eps.w.epId);
  const keys = () => userStore.getWatchLater(uid);
  assert.strictEqual(keys().length, 5);
  assert.strictEqual((await del(eps.x.epId)).status, 200);
  assert.ok(keys().includes(`podcast:${eps.x.epId}`), 'a DELETE without the kind removes the MEDIA key only (no row)');
  await delPod(eps.x.epId);
  assert.ok(!keys().includes(`podcast:${eps.x.epId}`), 'DELETE ?kind=podcast removes it');
  const prog = (position) => fetch(`${base}/api/podcasts/progress`, { method: 'POST', headers: J, body: JSON.stringify({ episodeId: eps.y.epId, position, duration: 100 }) });
  await prog(94);
  assert.ok(keys().includes(`podcast:${eps.y.epId}`), 'below 95% it stays');
  await prog(95);
  assert.ok(!keys().includes(`podcast:${eps.y.epId}`), 'the played latch removes it');
  await fetch(`${base}/api/podcasts/episodes/${eps.z.epId}/played`, { method: 'POST', headers: J, body: JSON.stringify({ played: false }) });
  assert.ok(keys().includes(`podcast:${eps.z.epId}`), 'UN-marking played does not remove');
  await fetch(`${base}/api/podcasts/episodes/${eps.z.epId}/played`, { method: 'POST', headers: J, body: '{}' });
  assert.ok(!keys().includes(`podcast:${eps.z.epId}`), 'mark played removes it');
  userStore.removePodcastEpisodeState([eps.w.epId]);
  assert.deepEqual(keys(), [eps.w.epId], 'the purge carrier drops the podcast row and NOT the media row with the same id');
  userStore.removeMediaState([eps.w.epId]);
  assert.deepEqual(keys(), []);
});

test('W2: the media path never removes a podcast row: a media finish / delete of an id leaves the episode key', async () => {
  const eps = await seedEpisodes([{ guid: 'm' }]);
  seed({ [eps.m.epId]: item(eps.m.epId) });
  await addPod(eps.m.epId);
  await ping(eps.m.epId, 95);
  userStore.removeMediaState([eps.m.epId]);
  assert.deepEqual(userStore.getWatchLater(uid), [`podcast:${eps.m.epId}`]);
});

test('W2: a backup carries the podcast key verbatim and restores it', async () => {
  const eps = await seedEpisodes([{ guid: 'bk' }]);
  seed({ v1: item('v1') });
  await add('v1');
  await addPod(eps.bk.epId);
  const exported = userStore.exportUsersForBackup ? userStore.exportUsersForBackup() : null;
  assert.ok(exported, 'the store exposes the users export');
  const me = exported.find((u) => u.id === uid);
  assert.deepEqual(me.watchLater.map((w) => w.mediaId), ['v1', `podcast:${eps.bk.epId}`]);
  userStore.replaceAllUsersRaw(exported);
  assert.deepEqual(userStore.getWatchLater(uid), ['v1', `podcast:${eps.bk.epId}`], 'restored in order, the podcast key intact');
});
