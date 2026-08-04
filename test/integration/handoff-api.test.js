'use strict';

// [INTEGRATION] v1.78 device handoff - the presence write path (piggybacked on
// all THREE progress handlers) and the one read endpoint, GET /api/handoff.
//
// The load-bearing assertion in this file is the one that looks like it does
// nothing: AC10, backward compatibility. Presence rides on the progress
// handlers, which are the hottest write path in the app, so a ping WITHOUT
// device fields must behave byte-identically to pre-v1.78 - same status, same
// stored value, same watched latch. An old cached client and the Roku both
// depend on that, and neither can be asked to upgrade.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-handoff-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, updateDatabase, userStore, effectiveProgress,
  __mintTestSession, __presenceForTests, resolveHandoffTarget, getCachedDatabase,
} = require('../../server');
const musicStore = require('../../lib/music/store');
const podcastStore = require('../../lib/podcasts/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, uid, auth;

const DEV_A = 'device-aaaa-1111';
const DEV_B = 'device-bbbb-2222';

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
  // Residual #110: the suite's mkdtemp dirs once exhausted the box's inodes.
  // A new suite cleans up after itself.
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// The presence map is process-wide module state, so it MUST be cleared between
// tests or one test's device leaks into the next one's expectations.
beforeEach(() => { __presenceForTests.clear(); });

const postJson = (p, body, opts = {}) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
  body: JSON.stringify(body),
});
const getHandoff = (deviceId, opts = {}) => fetch(
  `${base}/api/handoff${deviceId === undefined ? '' : `?deviceId=${encodeURIComponent(deviceId)}`}`,
  opts
);

function seedItem(id, over = {}) {
  return {
    id, title: `Title ${id}`, filePath: `/media/${id}.mp4`, folderName: 'Woodturning',
    type: 'video', ext: '.mp4', duration: 2706, size: 1000, addedAt: 5000, ...over,
  };
}

function seedDb() {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vid1: seedItem('vid1'), vid2: seedItem('vid2') },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
}

const devicePing = (over = {}) => ({
  id: 'vid1', timestamp: 754, duration: 2706,
  deviceId: DEV_A, deviceLabel: 'iPhone', presenceAt: 1000, ...over,
});

// ---------------------------------------------------------------------------
// AC1 / AC7 / AC8 - the core read contract
// ---------------------------------------------------------------------------

test('AC1: a ping from device A is visible to device B, with server-resolved display fields', async () => {
  seedDb();
  assert.strictEqual((await postJson('/api/progress', devicePing())).status, 200);

  const r = await getHandoff(DEV_B);
  assert.strictEqual(r.status, 200);
  const { presence } = await r.json();
  assert.ok(presence, 'device B must see device A');
  assert.strictEqual(presence.deviceLabel, 'iPhone');
  assert.strictEqual(presence.state, 'playing');
  assert.strictEqual(presence.kind, 'media');
  assert.strictEqual(presence.mediaId, 'vid1');
  assert.strictEqual(presence.position, 754);
  assert.strictEqual(presence.duration, 2706);
  assert.ok(presence.ageSeconds <= 1, 'position is no staler than one ping interval');
  // Resolved SERVER-side from our own records - the client never supplied any
  // of these, which is what makes a client-supplied title impossible.
  assert.strictEqual(presence.title, 'Title vid1');
  assert.strictEqual(presence.subtitle, 'Woodturning');
  assert.strictEqual(presence.thumbnailUrl, '/thumbnail/vid1');
  assert.strictEqual(presence.href, '/watch.html?v=vid1');
});

test('AC7: a device is never offered its own playback; another device still is', async () => {
  seedDb();
  await postJson('/api/progress', devicePing());

  assert.strictEqual((await (await getHandoff(DEV_A)).json()).presence, null, 'self must be excluded');
  assert.ok((await (await getHandoff(DEV_B)).json()).presence, 'a different device still sees it');
});

test('AC7: an omitted or blank deviceId excludes nothing (it cannot identify itself) and never errors', async () => {
  seedDb();
  await postJson('/api/progress', devicePing());

  const noParam = await getHandoff(undefined);
  assert.strictEqual(noParam.status, 200);
  assert.ok((await noParam.json()).presence, 'no param -> no exclusion, still a clean 200');

  const blank = await getHandoff('');
  assert.strictEqual(blank.status, 200);
  assert.ok((await blank.json()).presence);
});

test('AC8/#10: a presence-less user reads a clean null - the restart-amnesia path', async () => {
  seedDb();
  const r = await getHandoff(DEV_B);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { presence: null }, 'nulls, never an error');

  // And a restart, simulated exactly as production experiences it: the map is
  // gone, the durable progress is not.
  await postJson('/api/progress', devicePing());
  assert.ok((await (await getHandoff(DEV_B)).json()).presence);
  __presenceForTests.clear();
  assert.strictEqual((await (await getHandoff(DEV_B)).json()).presence, null, 'restart clears presence');
  assert.strictEqual(effectiveProgress(uid, 'vid1').timestamp, 754, 'durable progress SURVIVES the restart');
});

// ---------------------------------------------------------------------------
// AC10 - backward compatibility. The reason this feature is cheap.
// ---------------------------------------------------------------------------

test('AC10: a ping with NO device fields is byte-identical - 200, stored value, watched latch, and NO presence', async () => {
  seedDb();
  const r = await postJson('/api/progress', { id: 'vid1', timestamp: 100, duration: 2706 });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { success: true }, 'response shape unchanged');

  const stored = effectiveProgress(uid, 'vid1');
  assert.strictEqual(stored.timestamp, 100);
  assert.strictEqual(stored.duration, 2706);

  assert.strictEqual((await (await getHandoff(DEV_B)).json()).presence, null,
    'an old client contributes no presence at all - it just keeps working');
});

test('AC10: the watched latch still fires for a device-less ping (the load-bearing side effect)', async () => {
  seedDb();
  await postJson('/api/progress', { id: 'vid2', timestamp: 2690, duration: 2706 });
  assert.ok(userStore.getWatchedIds(uid).includes('vid2'), 'a >=95% ping latches watched, device fields or not');
});

test('AC10: the 400/404 gates are unchanged AND a rejected ping mints no presence', async () => {
  seedDb();
  assert.strictEqual((await postJson('/api/progress', { timestamp: 5 })).status, 400, 'missing id');
  assert.strictEqual((await postJson('/api/progress', { id: 'vid1' })).status, 400, 'missing timestamp');
  assert.strictEqual((await postJson('/api/progress', { id: 'nope', timestamp: 5 })).status, 404, 'unknown id');

  // The same three, now WITH device fields: the gates must not soften, and
  // nothing may be recorded for an id this user was refused.
  assert.strictEqual((await postJson('/api/progress', devicePing({ id: undefined }))).status, 400);
  assert.strictEqual((await postJson('/api/progress', devicePing({ timestamp: 'x' }))).status, 400);
  assert.strictEqual((await postJson('/api/progress', devicePing({ id: 'ghost' }))).status, 404);
  assert.strictEqual((await (await getHandoff(DEV_B)).json()).presence, null,
    'a refused ping must never mint presence');
});

test('AC10: __proto__ as an id is still a 404 and mints no presence (#4)', async () => {
  seedDb();
  assert.strictEqual((await postJson('/api/progress', devicePing({ id: '__proto__' }))).status, 404);
  assert.strictEqual((await (await getHandoff(DEV_B)).json()).presence, null);
  assert.strictEqual({}.deviceLabel, undefined, 'no prototype pollution');
});

// ---------------------------------------------------------------------------
// AC9 - cross-user isolation
// ---------------------------------------------------------------------------

test('AC9: user B never sees user A\'s presence, even naming A\'s deviceId', async () => {
  seedDb();
  const second = __mintTestSession({ username: 'handoff-second' });
  assert.notStrictEqual(second.user.id, uid, 'two genuinely different users');

  await postJson('/api/progress', devicePing()); // user A (the patched-fetch session)

  // User B asks with its OWN cookie. The bucket is keyed by req.user.id from
  // the auth gate, so there is no id user B can name to reach into A's.
  const asB = await getHandoff(DEV_B, { headers: { Cookie: second.cookie } });
  assert.strictEqual(asB.status, 200);
  assert.strictEqual((await asB.json()).presence, null, 'user B sees NOTHING of user A');

  const asBNamingA = await getHandoff(DEV_A, { headers: { Cookie: second.cookie } });
  assert.strictEqual((await asBNamingA.json()).presence, null);

  // User A is unaffected throughout.
  assert.ok((await (await getHandoff(DEV_B)).json()).presence, 'user A still sees its own device');
});

// ---------------------------------------------------------------------------
// State: the pause beacon and the decay
// ---------------------------------------------------------------------------

test('AC2: presenceState:paused flips the state immediately, carrying the final position', async () => {
  seedDb();
  await postJson('/api/progress', devicePing({ timestamp: 100, presenceAt: 1000 }));
  await postJson('/api/progress', devicePing({ timestamp: 512, presenceState: 'paused', presenceAt: 2000 }));

  const { presence } = await (await getHandoff(DEV_B)).json();
  assert.strictEqual(presence.state, 'paused', 'no waiting out the active TTL when the device says so');
  assert.strictEqual(presence.position, 512, 'the final position rides the beacon');
  assert.strictEqual(effectiveProgress(uid, 'vid1').timestamp, 512, 'and it is a REAL progress ping too');
});

test('#6: a play ping that arrives late (older presenceAt) cannot un-pause a newer beacon', async () => {
  seedDb();
  await postJson('/api/progress', devicePing({ timestamp: 512, presenceState: 'paused', presenceAt: 5000 }));
  const late = await postJson('/api/progress', devicePing({ timestamp: 500, presenceAt: 4000 }));

  assert.strictEqual(late.status, 200, 'the late ping is still a perfectly good PROGRESS write');
  const { presence } = await (await getHandoff(DEV_B)).json();
  assert.strictEqual(presence.state, 'paused', 'presence keeps the newer event\'s state');
  assert.strictEqual(presence.position, 512);
  assert.strictEqual(effectiveProgress(uid, 'vid1').timestamp, 500,
    'progress itself is still last-writer-wins - presence ordering must not change that');
});

// ---------------------------------------------------------------------------
// The other two kinds
// ---------------------------------------------------------------------------

test('kind track: a music ping mints presence resolving to the music surface', async () => {
  seedDb();
  const trackId = 'a'.repeat(32);
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {};
    ns.tracks[trackId] = {
      id: trackId, filePath: '/music/song.mp3', rootFolder: '/music', ext: '.mp3',
      title: 'Comfortably Numb', artist: 'Pink Floyd', album: 'The Wall',
      albumArtKey: null, codec: 'mp3', durationSec: 383, addedAt: '2026-01-01T00:00:00Z',
    };
    return true;
  });

  assert.strictEqual((await postJson('/api/music/progress', {
    id: trackId, position: 120, duration: 383, deviceId: DEV_A, deviceLabel: 'Mac', presenceAt: 1000,
  })).status, 200);

  const { presence } = await (await getHandoff(DEV_B)).json();
  assert.ok(presence, 'a music ping mints presence');
  assert.strictEqual(presence.kind, 'track');
  assert.strictEqual(presence.title, 'Comfortably Numb');
  assert.strictEqual(presence.subtitle, 'Pink Floyd');
  assert.strictEqual(presence.href, `/music?play=${trackId}`);
  assert.strictEqual(presence.thumbnailUrl, `/albumart/${trackId}`);
  assert.strictEqual(presence.position, 120);
  assert.strictEqual(presence.duration, 383);
});

test('kind podcast: an episode ping mints presence resolving to the podcasts surface', async () => {
  seedDb();
  const subId = 'b'.repeat(32);
  const showDir = path.join(DATA_DIR, 'podcasts', 'Seeded Show');
  fs.mkdirSync(showDir, { recursive: true });
  const mediaFile = path.join(showDir, 'Ep One.mp3');
  fs.writeFileSync(mediaFile, 'MP3BYTES');
  const epId = podcastStore.episodeIdFor(subId, 'guid-1');

  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    ns.subscriptions = [];
    ns.episodes = {};
    podcastStore.reduceAddSubscription(ns, { id: subId, name: 'The Woodworkers', feedUrl: 'https://example.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'guid-1', title: 'Bowl Turning', pubDateMs: 1000, durationSec: 1800 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(mediaFile), filePath: mediaFile, bytes: 8, nowMs: 6000 });
    return true;
  });

  assert.strictEqual((await postJson('/api/podcasts/progress', {
    episodeId: epId, position: 300, duration: 1800, deviceId: DEV_A, deviceLabel: 'iPad', presenceAt: 1000,
  })).status, 200);

  const { presence } = await (await getHandoff(DEV_B)).json();
  assert.ok(presence, 'a podcast ping mints presence');
  assert.strictEqual(presence.kind, 'podcast');
  assert.strictEqual(presence.title, 'Bowl Turning');
  assert.strictEqual(presence.subtitle, 'The Woodworkers');
  assert.strictEqual(presence.href, `/podcasts?play=${epId}`);
  assert.strictEqual(presence.thumbnailUrl, `/podcastart/${subId}`);
  assert.strictEqual(presence.position, 300);
});

test('podcasts: a ping without device fields still behaves byte-identically (AC10, third handler)', async () => {
  seedDb();
  const subId = 'c'.repeat(32);
  const epId = podcastStore.episodeIdFor(subId, 'guid-x');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    ns.subscriptions = [];
    ns.episodes = {};
    podcastStore.reduceAddSubscription(ns, { id: subId, name: 'S', feedUrl: 'https://example.com/g.xml' });
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'guid-x', title: 'E', pubDateMs: 1000, durationSec: 100 }], 'pending', 5000);
    return true;
  });

  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epId, position: 50, duration: 100 })).status, 200);
  assert.strictEqual(userStore.getOnePodcastProgress(uid, epId).position, 50, 'progress stored exactly as before');
  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: 'f'.repeat(32), position: 1 })).status, 400, 'phantom id still 400');
  assert.strictEqual((await (await getHandoff(DEV_B)).json()).presence, null);
});

// ---------------------------------------------------------------------------
// The offer must never be a dead link
// ---------------------------------------------------------------------------

test('a deleted item reads as NO presence, not a broken card', async () => {
  seedDb();
  await postJson('/api/progress', devicePing());
  assert.ok((await (await getHandoff(DEV_B)).json()).presence);

  await updateDatabase((db) => { delete db.metadata.vid1; return true; });
  assert.strictEqual((await (await getHandoff(DEV_B)).json()).presence, null,
    'offering a dead link is worse than offering nothing');
});

test('resolveHandoffTarget: a non-downloaded episode is not offerable (bindable, both arms)', async () => {
  const subId = 'd'.repeat(32);
  const epId = podcastStore.episodeIdFor(subId, 'guid-p');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    ns.subscriptions = [];
    ns.episodes = {};
    podcastStore.reduceAddSubscription(ns, { id: subId, name: 'S2', feedUrl: 'https://example.com/h.xml' });
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'guid-p', title: 'Pending One', pubDateMs: 1, durationSec: 10 }], 'pending', 5000);
    return true;
  });

  const db = getCachedDatabase();
  assert.strictEqual(resolveHandoffTarget(db, { kind: 'podcast', mediaId: epId, duration: 0 }), null,
    'pending -> not playable -> not offerable');
  assert.strictEqual(resolveHandoffTarget(db, { kind: 'podcast', mediaId: 'e'.repeat(32), duration: 0 }), null, 'unknown episode');
  assert.strictEqual(resolveHandoffTarget(db, { kind: 'track', mediaId: 'nope', duration: 0 }), null, 'unknown track');
  assert.strictEqual(resolveHandoffTarget(db, { kind: 'media', mediaId: 'gone', duration: 0 }), null, 'unknown media');
  assert.strictEqual(resolveHandoffTarget(db, null), null);
  assert.strictEqual(resolveHandoffTarget(db, { kind: 'media' }), null, 'no mediaId');
});

// ---------------------------------------------------------------------------
// Hostile input reaching the card
// ---------------------------------------------------------------------------

test('#2: a hostile deviceLabel comes back capped and VERBATIM as text - never HTML, never truncatable into markup', async () => {
  seedDb();
  await postJson('/api/progress', devicePing({ deviceLabel: '<img src=x onerror=alert(1)>' }));
  let { presence } = await (await getHandoff(DEV_B)).json();
  assert.strictEqual(presence.deviceLabel, '<img src=x onerror=alert(1)>',
    'stored verbatim: the card renders it with textContent, where escaping here would be the bug');

  __presenceForTests.clear();
  await postJson('/api/progress', devicePing({ deviceId: DEV_A, deviceLabel: 'z'.repeat(500) }));
  ({ presence } = await (await getHandoff(DEV_B)).json());
  assert.strictEqual(presence.deviceLabel.length, 32, 'capped server-side');
});

test('#1: a malformed deviceId mints no presence; the per-user device map stays capped at 8', async () => {
  seedDb();
  for (const bad of ['has space', 'has/slash', 'x'.repeat(65), '']) {
    await postJson('/api/progress', devicePing({ deviceId: bad }));
  }
  assert.strictEqual((await (await getHandoff(DEV_B)).json()).presence, null, 'no malformed id was stored');

  for (let i = 0; i < 200; i++) {
    await postJson('/api/progress', devicePing({ deviceId: `incognito-${i}`, presenceAt: 1000 + i }));
  }
  assert.strictEqual(__presenceForTests.deviceCount(uid), 8, '200 fresh UUIDs leave the map at the cap');
});
