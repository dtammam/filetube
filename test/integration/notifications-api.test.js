'use strict';

// [INTEGRATION] v1.51 notification bell -- the five /api/notifications
// endpoints against the REAL app: the three-way visibility gate (module env,
// sub count, settings toggle), the joined panel payload, two-tier
// seen/read/clear semantics over HTTP, per-user isolation with two live
// sessions, and the settings-toggle round-trip. Auth is the real gate
// (patched-fetch helper); the census suite separately proves 401s.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-notifapi-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, userStore, __resetDatabaseForTests,
} = require('../../server');
const store = require('../../lib/ytdlp/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
  delete process.env.FILETUBE_YTDLP_ENABLED;
});

// The gate needs: module env ON + >=1 subscription + toggle not-false. This
// arms the first two and seeds one indexed item the feed rows can join.
//
// FEED TIMES anchor to the ADMIN ACCOUNT's creation moment plus a few ms:
// they must be strictly AFTER the account (a stateless user's badge
// watermark defaults to created_at, so pre-account rows correctly never
// badge) yet strictly BEFORE the server's own Date.now() when seen/clear
// stamp their watermarks mid-test. A fixed literal fails the first
// constraint; "now + offset" fails the second. item.addedAt stays a fixed
// literal (the join payload does not depend on the account clock).
const ITEM_ADDED_AT = Date.UTC(2026, 5, 20, 10, 0, 0);
let T0;
async function armFeature() {
  // auth.user is the publicUser projection (no createdAt) -- read the full
  // row for the account clock.
  T0 = Date.parse(userStore.getById(auth.user.id).createdAt) + 2;
  assert.ok(Number.isFinite(T0), 'fixture anchor must be a real timestamp');
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.subscriptions.push({ id: 'sub1', channelUrl: 'https://www.youtube.com/@sömechannel', name: 'Söme Channel', order: 0 });
    db.metadata['mediä-1'] = {
      id: 'mediä-1', name: 'Clïp One.mp4', title: 'Clïp One', type: 'video', ext: '.mp4',
      filePath: '/lib/Clïp One.mp4', size: 10, addedAt: ITEM_ADDED_AT,
      folderName: 'Söme Channel', channelName: 'Söme Channel', hasThumbnail: true, duration: 754, // v1.208: 12:34
    };
    db.metadata['mediä-2'] = {
      id: 'mediä-2', name: 'Söng Two.m4a', title: 'Söng Two', type: 'audio', ext: '.m4a',
      filePath: '/lib/Söng Two.m4a', size: 10, addedAt: ITEM_ADDED_AT + 1000,
      folderName: 'Söme Channel',
    };
  });
  userStore.recordNotifications([
    { mediaId: 'mediä-1', createdAt: T0 },
    { mediaId: 'mediä-2', createdAt: T0 + 2 },
  ]);
}

test('the three-way visibility gate: module off, zero subs, and toggle off each 404 every endpoint', async () => {
  // 1. Module env off (but subs + rows exist).
  await armFeature();
  delete process.env.FILETUBE_YTDLP_ENABLED;
  for (const [method, url] of [['GET', '/api/notifications'], ['GET', '/api/notifications/badge'], ['POST', '/api/notifications/seen'], ['POST', '/api/notifications/read'], ['POST', '/api/notifications/clear']]) {
    const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 404, `${method} ${url} must 404 with the module off`);
  }

  // 2. Module on, zero subscriptions.
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  await updateDatabase((db) => { store.ensureYtdlp(db).subscriptions.length = 0; });
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 404, 'no subs -> no bell (decision 9)');

  // 3. Subs back, toggle off.
  await updateDatabase((db) => {
    store.ensureYtdlp(db).subscriptions.push({ id: 'sub1', channelUrl: 'https://www.youtube.com/@x', name: 'X', order: 0 });
    db.settings.notificationsEnabled = false;
  });
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 404, 'toggle off -> no bell');
});

test('panel payload: rows join the CURRENT item (title/channel/type/thumbnail), phantom media filtered, badge counts', async () => {
  await armFeature();
  userStore.recordNotifications([
    { mediaId: 'gone-mediä', createdAt: T0 + 4 },
    // Gate round 2 (adversarial): a prototype-key mediaId must read as
    // ABSENT in the join (own-property lookup), then prune like any phantom
    // -- never render as a truthy inherited junk row.
    { mediaId: 'constructor', createdAt: T0 + 6 },
  ]);

  const badge = await (await fetch(`${base}/api/notifications/badge`)).json();
  assert.equal(badge.count, 4, 'all four rows are unseen (feed-level), including both phantoms');

  const { items, unseenCount } = await (await fetch(`${base}/api/notifications`)).json();
  assert.deepEqual(items.map((i) => i.mediaId), ['mediä-2', 'mediä-1'], 'newest first; BOTH phantoms (missing item + prototype key) filtered by the join net');
  // Gate fix (adversarial W3): the join net doesn't just filter phantoms
  // -- it PRUNES them, so this same response's unseenCount (and every badge
  // fetch after) agrees with the panel.
  assert.equal(unseenCount, 2, 'unseenCount excludes the pruned phantoms');
  assert.equal((await (await fetch(`${base}/api/notifications/badge`)).json()).count, 2, 'the badge self-healed');
  const video = items.find((i) => i.mediaId === 'mediä-1');
  assert.equal(video.title, 'Clïp One');
  assert.equal(video.channelName, 'Söme Channel');
  assert.equal(video.type, 'video');
  assert.equal(video.hasThumbnail, true);
  assert.equal(video.unread, true);
  assert.equal(video.createdAt, T0);
  assert.equal(video.durationSec, 754, 'v1.208: the watch length joins the payload from db.metadata.duration (for the panel badge)');
  const audio = items.find((i) => i.mediaId === 'mediä-2');
  assert.equal(audio.type, 'audio');
  assert.equal(audio.channelName, '', 'no captured channel -> empty string, the client derives from folderName');
  assert.equal(audio.folderName, 'Söme Channel');
  assert.equal(audio.durationSec, 0, 'v1.208: an item with no duration -> 0 (no badge)');
});

test('two-tier semantics over HTTP: seen zeroes the badge but keeps dots; read drops a dot; clear empties the panel', async () => {
  await armFeature();

  assert.equal((await (await fetch(`${base}/api/notifications/badge`)).json()).count, 2);
  const seenRes = await fetch(`${base}/api/notifications/seen`, { method: 'POST' });
  assert.equal(seenRes.status, 200);
  assert.equal((await (await fetch(`${base}/api/notifications/badge`)).json()).count, 0, 'opening the panel zeroed the badge');

  let { items } = await (await fetch(`${base}/api/notifications`)).json();
  assert.ok(items.every((i) => i.unread === true), 'dots survive mark-seen (two-tier)');

  const readRes = await fetch(`${base}/api/notifications/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: items[0].id }),
  });
  assert.equal(readRes.status, 200);
  ({ items } = await (await fetch(`${base}/api/notifications`)).json());
  assert.equal(items[0].unread, false, 'tapped row lost its dot');
  assert.equal(items[1].unread, true, 'untapped row kept its dot');

  for (const badId of [items[0].id + 999, 'seven', 1.5, null]) {
    const bad = await fetch(`${base}/api/notifications/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: badId }),
    });
    assert.equal(bad.status, 400, `phantom/garbage id ${JSON.stringify(badId)} must 400`);
  }

  const clearRes = await fetch(`${base}/api/notifications/clear`, { method: 'POST' });
  assert.equal(clearRes.status, 200);
  const after = await (await fetch(`${base}/api/notifications`)).json();
  assert.deepEqual(after.items, [], 'clear-all emptied the panel');
  assert.equal(after.unseenCount, 0);
});

test('per-user isolation over HTTP: one user clearing never touches the other session', async () => {
  await armFeature();
  const { __mintTestSession } = require('../../server');
  const other = __mintTestSession({ username: 'wife2', role: 'member' });
  const asOther = (url, opts = {}) => fetch(`${base}${url}`, { ...opts, headers: { ...(opts.headers || {}), Cookie: other.cookie } });

  await fetch(`${base}/api/notifications/clear`, { method: 'POST' }); // admin clears

  assert.equal((await (await fetch(`${base}/api/notifications`)).json()).items.length, 0, 'admin panel empty');
  const otherView = await (await asOther('/api/notifications')).json();
  assert.equal(otherView.items.length, 2, "the other user's panel is untouched");
  // The second user's account POSTDATES the feed rows, so the account-age
  // rule correctly suppresses their dots and badge (pre-account history is
  // never "new to them") -- dot/badge isolation for a pre-existing user is
  // proven at the store layer in test/unit/notification-store.test.js.
  assert.ok(otherView.items.every((i) => i.unread === false), 'pre-account rows carry no dots for a newer account');
});

test('the settings toggle round-trips through POST /api/settings and gates the bell live', async () => {
  await armFeature();
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 200);

  let res = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationsEnabled: false }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).notificationsEnabled, false);
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 404, 'toggle off took effect immediately');

  // The feed still accumulates while off (decision 8).
  userStore.recordNotifications([{ mediaId: 'mediä-1', createdAt: T0 + 6 }]);

  res = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationsEnabled: true }),
  });
  assert.equal((await res.json()).notificationsEnabled, true);
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 200, 'and back on');
  const { items } = await (await fetch(`${base}/api/notifications`)).json();
  assert.equal(items.filter((i) => i.mediaId === 'mediä-1').length, 1, 'history accumulated while off has no gap');

  const bad = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationsEnabled: 'yes' }),
  });
  assert.equal(bad.status, 400, 'non-boolean toggle 400s like every typed key');
});

// ---- v1.73 (Dean ruling 7): podcast rows in the kind-carried feed -----------

const podcastStoreV173 = require('../../lib/podcasts/store');

async function seedPodcastEpisodeV173(guid) {
  // A subscription + one downloaded episode, seeded at the store (the
  // podcasts-api pattern; the poll pipeline is podcasts-poll's business).
  const subId = podcastStoreV173.subscriptionIdFor('https://feeds.invalid/rss/notif');
  const epId = podcastStoreV173.episodeIdFor(subId, guid);
  const epFile = path.join(process.env.DATA_DIR, `notif-${guid}.mp3`);
  fs.writeFileSync(epFile, 'mp3');
  await updateDatabase((db) => {
    const ns = podcastStoreV173.ensurePodcasts(db);
    if (!ns.subscriptions.some((x) => x && x.id === subId)) {
      ns.subscriptions.push(podcastStoreV173.subscriptionRecordFrom({ id: subId, feed: { feedUrlDisplay: 'https://feeds.invalid/rss/notif' }, name: 'Notif Show', backfill: 'all', nowMs: T0, order: 0 }));
    }
    podcastStoreV173.reduceUpsertEpisodes(ns, subId, [{ guid, title: `Ep ${guid}`, pubDateMs: 1000, durationSec: 60 }], 'pending', T0);
    podcastStoreV173.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(epFile), filePath: epFile, bytes: 3, nowMs: T0 });
    return true;
  });
  return { subId, epId };
}

test('v1.73: a podcast feed row lists kind-aware (show name, art, audio type); media rows carry kind media; the bell payload has both', async () => {
  await armFeature();
  const { subId, epId } = await seedPodcastEpisodeV173('g-list');
  userStore.recordNotifications([
    { mediaId: 'mediä-1', createdAt: T0 + 10 },
    { mediaId: epId, createdAt: T0 + 20, kind: 'podcast' },
  ]);
  const body = await (await fetch(`${base}/api/notifications`)).json();
  // armFeature already recorded media-1/media-2; my re-record REPLACED
  // media-1 (the feed's replace semantics) and added the episode = 3 rows.
  assert.equal(body.items.length, 3);
  const ep = body.items.find((r) => r.mediaId === epId);
  const med = body.items.find((r) => r.mediaId === 'mediä-1');
  assert.ok(ep && med, 'both freshly-recorded rows list');
  assert.equal(ep.kind, 'podcast');
  assert.equal(ep.title, 'Ep g-list');
  assert.equal(ep.channelName, 'Notif Show');
  assert.equal(ep.artUrl, `/podcastart/${subId}`);
  assert.equal(ep.type, 'audio');
  assert.equal(ep.durationSec, 60, 'v1.208: the episode length rides the podcast row (from ep.durationSec) for the panel badge');
  assert.equal(med.kind, 'media', 'kind carried on media rows too');
});

test('v1.73 kind-confusion probe: a PHANTOM podcast row prunes via the EPISODE carrier - a media item sharing the md5 id keeps every user row', async () => {
  await armFeature();
  const { epId } = await seedPodcastEpisodeV173('g-phantom');
  // The SAME md5 id is also a LIVE media item with real per-user state.
  await updateDatabase((db) => {
    db.metadata[epId] = {
      id: epId, name: 'Collide.mp4', title: 'Collide', type: 'video', ext: '.mp4',
      filePath: '/lib/Collide.mp4', size: 10, addedAt: ITEM_ADDED_AT, folderName: 'Söme Channel', hasThumbnail: false,
    };
    return true;
  });
  userStore.setProgress(auth.user.id, epId, { timestamp: 33, duration: 100, updatedAt: new Date(T0).toISOString() });
  userStore.recordNotifications([{ mediaId: epId, createdAt: T0 + 30, kind: 'podcast' }]);
  // Make the podcast row PHANTOM: the episode record vanishes wholesale.
  await updateDatabase((db) => {
    delete podcastStoreV173.ensurePodcasts(db).episodes[epId];
    return true;
  });
  const body = await (await fetch(`${base}/api/notifications`)).json();
  assert.ok(!body.items.some((r) => r.kind === 'podcast' && r.mediaId === epId), 'the phantom podcast row is gone');
  assert.equal(userStore.getOneProgress(auth.user.id, epId).timestamp, 33,
    'the colliding MEDIA item kept its progress - the prune used the episode carrier, never removeMediaState');
});

test('v1.73: a TRASHED episode row is HIDDEN, not pruned (restore brings it back) + the documented cross-kind replace semantics', async () => {
  await armFeature();
  const { epId } = await seedPodcastEpisodeV173('g-trash');
  userStore.recordNotifications([{ mediaId: epId, createdAt: T0 + 40, kind: 'podcast' }]);
  await updateDatabase((db) => {
    podcastStoreV173.reduceEpisodeTrashed(podcastStoreV173.ensurePodcasts(db), epId, { trashPath: '/x/.filetube-trash/y', nowMs: T0 });
    return true;
  });
  let body = await (await fetch(`${base}/api/notifications`)).json();
  assert.ok(!body.items.some((r) => r.mediaId === epId), 'hidden while trashed');
  assert.equal(userStore.exportNotificationsForBackup().some((r) => r.mediaId === epId && r.kind === 'podcast'), true, 'the row SURVIVED (hidden, not pruned)');

  // Replace semantics (UNIQUE media_id predates kinds - documented, benign):
  // recording the same id as MEDIA replaces the podcast row wholesale.
  userStore.recordNotifications([{ mediaId: epId, createdAt: T0 + 50 }]);
  const rows = userStore.exportNotificationsForBackup().filter((r) => r.mediaId === epId);
  assert.equal(rows.length, 1, 'ONE row per id - the feed replaces across kinds');
  assert.equal(rows[0].kind, 'media', 'the newest writer won');
});

test('v1.73 gate (adversarial W1/S4): resolvePushMeta arms bound - podcast/media/trashed/phantom/legacy-id', async () => {
  const { resolvePushMeta } = require('../../server');
  await armFeature();
  const { subId, epId } = await seedPodcastEpisodeV173('g-meta');
  const { loadDatabase } = require('../../server');
  const db = loadDatabase();
  // Podcast arm: title + show channel + kind echoed.
  assert.deepEqual(resolvePushMeta(db, { mediaId: epId, kind: 'podcast' }),
    { title: 'Ep g-meta', channel: 'Notif Show', kind: 'podcast' });
  // Media arm + the legacy bare-id call shape. v1.246: carries type + chaptered so an audio
  // download's push deep-links the music skin (pushMusicUrl) while a video keeps /watch.
  assert.deepEqual(resolvePushMeta(db, { mediaId: 'mediä-1', kind: 'media' }),
    { title: 'Clïp One', channel: 'Söme Channel', kind: 'media', type: 'video', chaptered: false });
  assert.equal(resolvePushMeta(db, { mediaId: 'mediä-2', kind: 'media' }).type, 'audio',
    'v1.246: an audio download carries type:audio so payloadForRow routes its notification to the music skin');
  assert.equal(resolvePushMeta(db, 'mediä-1').kind, 'media', 'bare-id legacy shape tolerated');
  // TRASHED episode -> null (the S4 mutant's named killer: a push must
  // never deep-link a non-playable episode).
  await updateDatabase((mdb) => {
    podcastStoreV173.reduceEpisodeTrashed(podcastStoreV173.ensurePodcasts(mdb), epId, { trashPath: '/x/.filetube-trash/z', nowMs: T0 });
    return true;
  });
  assert.equal(resolvePushMeta(loadDatabase(), { mediaId: epId, kind: 'podcast' }), null, 'trashed episode skips delivery');
  // Phantom -> null.
  assert.equal(resolvePushMeta(loadDatabase(), { mediaId: 'no-such-ep', kind: 'podcast' }), null);
  assert.ok(subId, 'fixture sanity');
});

test('v1.73 gate (QA W4b): the phantom prune + episode purge actually DELETE feed rows - store-level absence, kind-scoped', async () => {
  await armFeature();
  const { epId } = await seedPodcastEpisodeV173('g-purge');
  userStore.recordNotifications([{ mediaId: epId, createdAt: T0 + 60, kind: 'podcast' }]);
  // Phantom: the episode record vanishes; the panel GET must retire the
  // feed row AT THE STORE (not merely hide it - unpruned hidden orphans
  // squat the 200-row cap forever).
  await updateDatabase((db) => {
    delete podcastStoreV173.ensurePodcasts(db).episodes[epId];
    return true;
  });
  await (await fetch(`${base}/api/notifications`)).json();
  assert.ok(!userStore.exportNotificationsForBackup().some((r) => r.mediaId === epId),
    'the phantom podcast feed row is GONE from the store after the panel read');

  // Direct purge path: a podcast row dies with removePodcastEpisodeState;
  // a MEDIA row keeps its feed row under the same call (kind scoping).
  const { epId: ep2 } = await seedPodcastEpisodeV173('g-purge2');
  userStore.recordNotifications([
    { mediaId: ep2, createdAt: T0 + 70, kind: 'podcast' },
    { mediaId: 'mediä-2', createdAt: T0 + 71 },
  ]);
  userStore.removePodcastEpisodeState([ep2, 'mediä-2']);
  const after = userStore.exportNotificationsForBackup();
  assert.ok(!after.some((r) => r.mediaId === ep2), 'the podcast feed row retired with the episode purge');
  assert.ok(after.some((r) => r.mediaId === 'mediä-2' && r.kind === 'media'),
    'a MEDIA feed row survives the episode carrier even when its id rides the purge list (kind-scoped delete)');
});

// ---------------------------------------------------------------------------
// v1.146 (downloader-engine T5): engine event rows are ADMIN-ONLY at every
// read surface - the panel list, the badge, AND the panel's own
// unseenCount. A member must see neither the row nor evidence of it.
// ---------------------------------------------------------------------------

test('v1.146: engine rows render for the admin (composed title) and are invisible to a member - list AND badge', async () => {
  await armFeature();
  userStore.recordNotifications([
    { mediaId: 'engine:updated:2026.8.17.73947.dev0', createdAt: T0 + 10, kind: 'engine' },
    { mediaId: 'engine:garbage-not-parseable', createdAt: T0 + 11, kind: 'engine' },
  ]);

  const { __mintTestSession } = require('../../server');
  // A member whose account PREDATES nothing here would suppress unread via
  // account age; visibility (rows present at all) is what this test binds.
  const member = __mintTestSession({ username: 'kid-nocaps', role: 'member' });
  const asMember = (url, opts = {}) => fetch(`${base}${url}`, { ...opts, headers: { ...(opts.headers || {}), Cookie: member.cookie } });

  // Admin panel: the two media rows + ONE engine row (the malformed id
  // renders NOTHING - crafted-bundle defense), newest first.
  const adminView = await (await fetch(`${base}/api/notifications`)).json();
  const engineRows = adminView.items.filter((i) => i.kind === 'engine');
  assert.equal(engineRows.length, 1, 'exactly the well-formed engine row, never the malformed one');
  assert.equal(engineRows[0].title, 'Downloader engine updated to 2026.8.17.73947.dev0');
  assert.equal(engineRows[0].channelName, 'Downloader engine');
  assert.equal(engineRows[0].hasThumbnail, false);

  // Admin badge counts the engine row (2 media + 1 well-formed engine + 1
  // malformed engine = 4 raw rows; the badge is a kind-level count, so the
  // malformed row still ticks it - it is invisible only at RENDER; both
  // remain clearable through the normal seen/clear flow).
  const adminBadge = await (await fetch(`${base}/api/notifications/badge`)).json();
  assert.equal(adminBadge.count, 4);

  // Member: no engine rows in the panel, and a badge of 0 - the two media
  // rows predate the member's account (the account-age rule), and the
  // engine rows are excluded by KIND, so nothing here can tick it.
  const memberView = await (await asMember('/api/notifications')).json();
  assert.equal(memberView.items.filter((i) => i.kind === 'engine').length, 0, 'no engine rows for a member');
  assert.equal(memberView.unseenCount, 0);
  const memberBadge = await (await asMember('/api/notifications/badge')).json();
  assert.equal(memberBadge.count, 0, 'a member badge NEVER ticks for engine events');
});
