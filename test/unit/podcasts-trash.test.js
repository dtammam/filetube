'use strict';

// [UNIT] v1.70.0 - the episode trash lane's pure layer (store reducers +
// the retention selector) and the cover-fix policy (D1), driven through the
// poll pipeline with fakes.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const podcasts = require('../../lib/podcasts');
const store = require('../../lib/podcasts/store');
const secrets = require('../../lib/podcasts/secrets');

// ---- reducers ---------------------------------------------------------------

function nsWith(status, extra) {
  const ns = { subscriptions: [], episodes: {}, settings: {} };
  ns.episodes.ep1 = { id: 'ep1', subId: 's1', guid: 'g1', status, filePath: '/r/show/f.mp3', ...extra };
  return ns;
}

test('reduceEpisodeTrashed: downloaded-only, keeps filePath (the restore destination), records where the bytes went', () => {
  const ns = nsWith('downloaded');
  assert.strictEqual(store.reduceEpisodeTrashed(ns, 'ep1', { trashPath: '/r/.filetube-trash/1-e-f.mp3', nowMs: 5000 }), true);
  assert.strictEqual(ns.episodes.ep1.status, 'trashed');
  assert.strictEqual(ns.episodes.ep1.filePath, '/r/show/f.mp3', 'filePath survives - it is the restore destination');
  assert.strictEqual(ns.episodes.ep1.trashPath, '/r/.filetube-trash/1-e-f.mp3');
  assert.strictEqual(ns.episodes.ep1.trashedAt, 5000);

  for (const bad of ['pending', 'failed', 'skipped', 'trashed', 'tombstone', 'deleted-on-disk']) {
    const n2 = nsWith(bad);
    assert.strictEqual(store.reduceEpisodeTrashed(n2, 'ep1', { trashPath: '/t', nowMs: 1 }), false, `refuses from ${bad}`);
  }
  assert.strictEqual(store.reduceEpisodeTrashed(nsWith('downloaded'), 'ep1', { trashPath: '', nowMs: 1 }), false, 'refuses an empty trashPath');
  assert.strictEqual(store.reduceEpisodeTrashed(nsWith('downloaded'), 'nope', { trashPath: '/t', nowMs: 1 }), false);
});

test('reduceEpisodeRestored: trashed-only, reverses the transition cleanly', () => {
  const ns = nsWith('trashed', { trashPath: '/r/.filetube-trash/x', trashedAt: 5 });
  assert.strictEqual(store.reduceEpisodeRestored(ns, 'ep1'), true);
  assert.strictEqual(ns.episodes.ep1.status, 'downloaded');
  assert.ok(!('trashPath' in ns.episodes.ep1), 'trash pointer cleared');
  assert.ok(!('trashedAt' in ns.episodes.ep1));
  assert.strictEqual(store.reduceEpisodeRestored(nsWith('downloaded'), 'ep1'), false, 'refuses a non-trashed record');
});

test('tombstoning a trashed record clears the trash pointer too', () => {
  const ns = nsWith('trashed', { trashPath: '/r/.filetube-trash/x', trashedAt: 5 });
  assert.strictEqual(store.reduceEpisodeStatus(ns, 'ep1', 'tombstone'), true);
  assert.ok(!('trashPath' in ns.episodes.ep1));
  assert.strictEqual(ns.episodes.ep1.filePath, '');
  assert.strictEqual(ns.episodes.ep1.guid, 'g1', 'the archive key survives the whole lifecycle');
});

test('selectExpiredTrashedEpisodes: 0/invalid retention = keep forever; only trashed + old enough expire', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;
  const episodes = {
    old: { id: 'old', status: 'trashed', trashedAt: now - 8 * DAY },
    fresh: { id: 'fresh', status: 'trashed', trashedAt: now - 2 * DAY },
    exact: { id: 'exact', status: 'trashed', trashedAt: now - 7 * DAY },
    down: { id: 'down', status: 'downloaded', trashedAt: now - 50 * DAY }, // wrong status: never
    stampless: { id: 'stampless', status: 'trashed' }, // no stamp: never (fail-safe)
  };
  assert.deepStrictEqual(store.selectExpiredTrashedEpisodes(episodes, 7, now).sort(), ['exact', 'old']);
  assert.deepStrictEqual(store.selectExpiredTrashedEpisodes(episodes, 0, now), [], '0 = keep forever');
  assert.deepStrictEqual(store.selectExpiredTrashedEpisodes(episodes, undefined, now), [], 'unset = keep forever');
  assert.deepStrictEqual(store.selectExpiredTrashedEpisodes(episodes, -3, now), [], 'negative = keep forever');
});

// ---- the cover fix (D1), through the pipeline with fakes ---------------------

const TOKEN = 'CoverFixTok123456';
let dataDir, db, deps, coverAttempts;

beforeEach(() => {
  podcasts.resetPodcastsStateForTests();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-podtrash-'));
  db = {};
  coverAttempts = 0;
  deps = {
    dataDir,
    now: () => 1754150000000,
    loadDatabase: () => db,
    getCachedDatabase: () => db,
    updateDatabase: async (m) => { m(db); },
    runExclusive: (fn) => Promise.resolve(fn()),
    userStore: { removePodcastEpisodeState: () => {} },
    fetchFeedImpl: async () => ({
      ok: true,
      body: '<rss><channel><title>Show</title><itunes:image href="https://cdn.example/art/big.png?x=1"></itunes:image>'
        + '<item><title>Ep</title><guid>g1</guid><pubDate>Sun, 02 Aug 2026 15:00:00 GMT</pubDate><enclosure url="https://cdn.example/1.mp3" type="audio/mpeg"/></item></channel></rss>',
    }),
    downloadEnclosureImpl: async (url, destDir, finalName) => {
      if (finalName.startsWith('cover.')) {
        coverAttempts += 1;
        // First attempt fails the way Dean's real 15.5MB cover did.
        if (coverAttempts === 1) return { ok: false, error: 'enclosure exceeds the size cap' };
        const p = path.join(destDir, finalName);
        fs.writeFileSync(p, 'PNGBYTES');
        return { ok: true, filePath: p, bytes: 8 };
      }
      const p = path.join(destDir, finalName);
      fs.writeFileSync(p, 'AUDIO');
      return { ok: true, filePath: p, bytes: 5 };
    },
  };
});
afterEach(() => {
  podcasts.resetPodcastsStateForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function addSub(backfill) {
  const input = store.validateAddInput({ feedUrl: `https://cdn.example/rss?auth=${TOKEN}`, backfill });
  const id = store.subscriptionIdFor(input.feed.url);
  secrets.setFeedSecret(dataDir, id, input.feed.url);
  await deps.updateDatabase((mdb) => store.reduceAddSubscription(store.ensurePodcasts(mdb),
    store.subscriptionRecordFrom({ id, feed: input.feed, name: '', backfill: input.backfill, nowMs: 1, order: 0 })));
  return id;
}

test('D1: a failed cover is REPORTED in the status and RETRIED next poll even with zero new downloads', async () => {
  const id = await addSub('all');
  await podcasts.runPodcastPoll(deps, id);
  let sub = store.readPodcasts(db).subscriptions[0];
  assert.match(sub.lastStatus, /cover art failed \(enclosure exceeds the size cap\)/, `the failure is no longer silent: ${sub.lastStatus}`);
  assert.strictEqual(coverAttempts, 1);

  // Second poll: nothing new to download - the cover must retry anyway
  // (this poll has targets.length === 0, the exact shape that used to make
  // one failure permanent).
  await podcasts.runPodcastPoll(deps, id);
  sub = store.readPodcasts(db).subscriptions[0];
  assert.strictEqual(coverAttempts, 2, 'retried on a zero-download cycle');
  assert.ok(!/cover art failed/.test(sub.lastStatus), `success clears the failure part: ${sub.lastStatus}`);
  assert.ok(fs.existsSync(path.join(dataDir, 'podcasts', 'Show', 'cover.png')), 'the art landed');

  // Third poll: art exists - no further attempts.
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(coverAttempts, 2, 'an existing cover is never re-fetched');
});

test('D1: a new-only sub with zero downloads still gets its cover (the dir is created for it)', async () => {
  coverAttempts = 1; // skip the fake's one planned failure
  const id = await addSub('new');
  await podcasts.runPodcastPoll(deps, id);
  assert.ok(fs.existsSync(path.join(dataDir, 'podcasts', 'Show', 'cover.png')), 'cover lands with no episode downloads at all');
  const eps = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.ok(eps.every((e) => e.status === 'skipped'), 'and the backfill policy was untouched');
});
