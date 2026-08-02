'use strict';

// [UNIT] v1.69.0 (podcasts): the db.podcasts namespace owner
// (lib/podcasts/store.js) - ensure/read split, reducers, the backfill
// policy, and the archive law (a tombstone blocks re-download forever).

const { test } = require('node:test');
const assert = require('node:assert');

const store = require('../../lib/podcasts/store');

function freshNs() {
  const db = {};
  return store.ensurePodcasts(db);
}

function addedSub(ns, url = 'https://feeds.example.com/show?auth=tok123456') {
  const input = store.validateAddInput({ feedUrl: url });
  assert.strictEqual(input.ok, true);
  const id = store.subscriptionIdFor(input.feed.url);
  const rec = store.subscriptionRecordFrom({ id, feed: input.feed, name: input.name, backfill: input.backfill, nowMs: 1000, order: 0 });
  assert.strictEqual(store.reduceAddSubscription(ns, rec), true);
  return store.findSubscription(ns, id);
}

test('ensurePodcasts backfills missing/broken namespaces; readPodcasts never mutates', () => {
  const db = {};
  const ns = store.ensurePodcasts(db);
  assert.deepStrictEqual(ns, { subscriptions: [], episodes: {}, settings: {} });
  db.podcasts.subscriptions = 'garbage';
  store.ensurePodcasts(db);
  assert.deepStrictEqual(db.podcasts.subscriptions, []);

  const frozen = Object.freeze({ podcasts: Object.freeze({ subscriptions: undefined, episodes: null, settings: [] }) });
  const view = store.readPodcasts(frozen); // must not throw on a frozen db
  assert.deepStrictEqual(view, { subscriptions: [], episodes: {}, settings: {} });
});

test('the subscription record NEVER contains the full feed URL or its query', () => {
  const ns = freshNs();
  const sub = addedSub(ns, 'https://www.patreon.com/rss/show?auth=SuperSecretToken123');
  const json = JSON.stringify(ns);
  assert.ok(!json.includes('SuperSecretToken123'), 'token must not enter the namespace');
  assert.strictEqual(sub.feedUrlDisplay, 'https://www.patreon.com/rss/show');
  assert.strictEqual(sub.feedHost, 'www.patreon.com');
});

test('add is idempotent by id; order is 1 + max(existing)', () => {
  const ns = freshNs();
  const a = addedSub(ns, 'https://a.example/feed');
  assert.strictEqual(a.order, 1);
  const b = addedSub(ns, 'https://b.example/feed');
  assert.strictEqual(b.order, 2);
  const again = store.subscriptionRecordFrom({
    id: a.id, feed: { url: 'https://a.example/feed', display: 'https://a.example/feed', host: 'a.example' },
    name: '', backfill: 'all', nowMs: 2000, order: 0,
  });
  assert.strictEqual(store.reduceAddSubscription(ns, again), false, 're-add returns false (skip save)');
  assert.strictEqual(ns.subscriptions.length, 2);
});

test('validateAddInput: backfill normalization (all/new/N) and rejections', () => {
  assert.strictEqual(store.validateAddInput({ feedUrl: 'https://x.example/f' }).backfill, 'all', 'default is all');
  assert.strictEqual(store.validateAddInput({ feedUrl: 'https://x.example/f', backfill: 'new' }).backfill, 'new');
  assert.strictEqual(store.validateAddInput({ feedUrl: 'https://x.example/f', backfill: '25' }).backfill, 25);
  for (const bad of ['latest', 0, -1, 1.5, {}, store.MAX_BACKFILL_LATEST + 1]) {
    assert.strictEqual(store.validateAddInput({ feedUrl: 'https://x.example/f', backfill: bad }).ok, false, `rejects ${bad}`);
  }
  assert.strictEqual(store.validateAddInput({ feedUrl: 'https://localhost/f' }).ok, false, 'feed URL validation applies');
});

test('validatePatch: allowlist only; unknown/empty patches rejected', () => {
  assert.deepStrictEqual(store.validatePatch({ paused: true }).patch, { paused: true });
  assert.deepStrictEqual(store.validatePatch({ name: '  My Show  ' }).patch, { name: 'My Show' });
  assert.deepStrictEqual(store.validatePatch({ backfill: 'new' }).patch, { backfill: 'new' });
  assert.strictEqual(store.validatePatch({}).ok, false);
  assert.strictEqual(store.validatePatch({ lastStatus: 'forged' }).ok, false, 'poller-owned fields are not patchable');
  assert.strictEqual(store.validatePatch({ paused: 'yes' }).ok, false);
  assert.strictEqual(store.validatePatch({ name: '' }).ok, false);
});

test('selectBackfill: all / new-first-poll / new-steady-state / latest-N', () => {
  const items = [
    { guid: 'g1', pubDateMs: 100 },
    { guid: 'g2', pubDateMs: 300 },
    { guid: 'g3', pubDateMs: 200 },
  ];
  const none = new Set();

  const all = store.selectBackfill(items, none, 'all', true);
  assert.deepStrictEqual(all.download.map((i) => i.guid), ['g2', 'g3', 'g1'], 'newest-first');
  assert.deepStrictEqual(all.skip, []);

  const newFirst = store.selectBackfill(items, none, 'new', true);
  assert.deepStrictEqual(newFirst.download, [], 'first poll with new: nothing downloads');
  assert.strictEqual(newFirst.skip.length, 3, 'everything is recorded as skipped');

  const newSteady = store.selectBackfill([{ guid: 'g4', pubDateMs: 400 }, ...items], new Set(['g1', 'g2', 'g3']), 'new', false);
  assert.deepStrictEqual(newSteady.download.map((i) => i.guid), ['g4'], 'later polls download the genuinely new');

  const latest2 = store.selectBackfill(items, none, 2, true);
  assert.deepStrictEqual(latest2.download.map((i) => i.guid), ['g2', 'g3']);
  assert.deepStrictEqual(latest2.skip.map((i) => i.guid), ['g1']);

  const dupes = store.selectBackfill([{ guid: '', pubDateMs: 1 }, { pubDateMs: 2 }, null], none, 'all', true);
  assert.deepStrictEqual(dupes.download, [], 'guid-less items never become download targets');
});

test('reduceUpsertEpisodes: archive law - ANY existing record blocks re-creation', () => {
  const ns = freshNs();
  const sub = addedSub(ns);
  const items = [{ guid: 'g1', title: 'One', pubDateMs: 100 }];
  const created = store.reduceUpsertEpisodes(ns, sub.id, items, 'pending', 1000);
  assert.strictEqual(created.length, 1);
  const epId = created[0];

  // Tombstone it (user delete), then re-present the same guid from the feed.
  assert.strictEqual(store.reduceEpisodeStatus(ns, epId, 'tombstone'), true);
  const again = store.reduceUpsertEpisodes(ns, sub.id, items, 'pending', 2000);
  assert.deepStrictEqual(again, [], 'tombstoned guid is never re-created');
  assert.strictEqual(ns.episodes[epId].status, 'tombstone', 'and its status is untouched');
});

test('reduceUpsertEpisodes: __proto__ guid cannot poison the map', () => {
  const ns = freshNs();
  const sub = addedSub(ns);
  const created = store.reduceUpsertEpisodes(ns, sub.id, [{ guid: '__proto__', title: 'evil', pubDateMs: 1 }], 'pending', 1000);
  assert.strictEqual(created.length, 1, 'the guid is legal (it hashes into the id)');
  assert.strictEqual(Object.prototype.polluted, undefined);
  assert.match(created[0], /^[0-9a-f]{32}$/, 'episode ids are md5 hex, never the raw guid');
});

test('episode lifecycle reducers: downloaded -> deleted-on-disk keeps the record; fields sane', () => {
  const ns = freshNs();
  const sub = addedSub(ns);
  const [epId] = store.reduceUpsertEpisodes(ns, sub.id, [{ guid: 'g9', title: 'T', pubDateMs: 5 }], 'pending', 1000);

  assert.strictEqual(store.reduceEpisodeDownloaded(ns, epId, { fileName: 'T [rss=g9].mp3', filePath: '/p/T [rss=g9].mp3', bytes: 42, nowMs: 1500 }), true);
  assert.strictEqual(ns.episodes[epId].status, 'downloaded');

  assert.strictEqual(store.reduceEpisodeStatus(ns, epId, 'deleted-on-disk'), true);
  assert.strictEqual(ns.episodes[epId].filePath, '', 'a non-downloaded record points at no file');
  assert.strictEqual(ns.episodes[epId].guid, 'g9', 'the archive key survives');

  assert.strictEqual(store.reduceEpisodeStatus(ns, epId, 'nonsense'), false);
  assert.strictEqual(store.reduceEpisodeFailed(ns, 'missing-id', 'err'), false);
});

test('reduceDeleteSubscription removes the sub AND its episode records, returns the ids', () => {
  const ns = freshNs();
  const a = addedSub(ns, 'https://a.example/feed');
  const b = addedSub(ns, 'https://b.example/feed');
  const aEps = store.reduceUpsertEpisodes(ns, a.id, [{ guid: 'a1', pubDateMs: 1 }, { guid: 'a2', pubDateMs: 2 }], 'pending', 1000);
  store.reduceUpsertEpisodes(ns, b.id, [{ guid: 'b1', pubDateMs: 1 }], 'pending', 1000);

  const removed = store.reduceDeleteSubscription(ns, a.id);
  assert.deepStrictEqual(new Set(removed), new Set(aEps));
  assert.strictEqual(ns.subscriptions.length, 1);
  assert.strictEqual(store.episodesForSub(ns.episodes, b.id).length, 1, 'the other sub is untouched');
  assert.strictEqual(store.reduceDeleteSubscription(ns, 'nope'), false);
});

test('reduceSetSubscriptionStatus: caps lastStatus, adopts title only into an empty name', () => {
  const ns = freshNs();
  const sub = addedSub(ns);
  store.reduceSetSubscriptionStatus(ns, sub.id, { lastStatus: 'x'.repeat(1000), adoptedTitle: 'Feed Title', lastCheckedAt: 99 });
  assert.strictEqual(sub.lastStatus.length, store.MAX_STATUS_LENGTH);
  assert.strictEqual(sub.name, 'Feed Title', 'empty name adopts the feed title');
  store.reduceSetSubscriptionStatus(ns, sub.id, { adoptedTitle: 'Renamed Upstream' });
  assert.strictEqual(sub.name, 'Feed Title', 'an already-set name is never overwritten');
});

test('computeFeedBackoff: doubling from 15min, capped at 6h; episodesForSub sorts newest-first', () => {
  assert.strictEqual(store.computeFeedBackoff(0, 1000), 0);
  assert.strictEqual(store.computeFeedBackoff(1, 0), 15 * 60 * 1000);
  assert.strictEqual(store.computeFeedBackoff(2, 0), 30 * 60 * 1000);
  assert.strictEqual(store.computeFeedBackoff(10, 0), 6 * 60 * 60 * 1000, 'capped');
  assert.strictEqual(store.isInFeedBackoff({ backoffUntil: 500 }, 400), true);
  assert.strictEqual(store.isInFeedBackoff({ backoffUntil: 500 }, 600), false);

  const ns = freshNs();
  const sub = addedSub(ns);
  store.reduceUpsertEpisodes(ns, sub.id, [
    { guid: 'old', pubDateMs: 100 }, { guid: 'new', pubDateMs: 900 }, { guid: 'mid', pubDateMs: 500 },
  ], 'pending', 1000);
  assert.deepStrictEqual(store.episodesForSub(ns.episodes, sub.id).map((e) => e.guid), ['new', 'mid', 'old']);
});
