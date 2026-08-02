'use strict';

// [UNIT] v1.69.0 T7 - the poll/download pipeline (lib/podcasts/index.js's
// processSubscription/runPodcastPoll/reconcileDownloads/sweepPartFiles)
// against a fully-faked deps bundle: in-memory db with real mutator
// semantics, injected feed/download transports, injected clock. No network,
// no server boot. Binds the redaction guarantee (a token NEVER reaches
// lastStatus), the backfill policies end-to-end, feed-failure backoff, the
// secretMissing lane, newest-first download order, the mount-loss guard,
// and the deleted-on-disk tombstone flow.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const podcasts = require('../../lib/podcasts');
const store = require('../../lib/podcasts/store');
const secrets = require('../../lib/podcasts/secrets');

const TOKEN = 'SuperSecretAuthToken99';
const FEED_URL = `https://www.patreon.com/rss/show?auth=${TOKEN}`;

let dataDir, mediaRoot, db, deps, downloads;

beforeEach(() => {
  podcasts.resetPodcastsStateForTests();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-podpoll-data-'));
  mediaRoot = path.join(dataDir, 'podcasts'); // the default root under dataDir
  db = {};
  downloads = [];
  deps = {
    dataDir,
    now: () => 1754150000000,
    loadDatabase: () => db,
    getCachedDatabase: () => db,
    updateDatabase: async (mutator) => { mutator(db); },
    runExclusive: (fn) => Promise.resolve(fn()),
    userStore: { removePodcastEpisodeState: () => {} },
    fetchFeedImpl: async () => ({ ok: true, body: feedXml(), finalUrl: 'https://x' }),
    downloadEnclosureImpl: async (url, destDir, finalName) => {
      downloads.push({ url, destDir, finalName });
      const p = path.join(destDir, finalName);
      fs.writeFileSync(p, 'FAKEAUDIO');
      return { ok: true, filePath: p, bytes: 9 };
    },
  };
});
afterEach(() => {
  podcasts.resetPodcastsStateForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function feedXml(items) {
  const its = items || [
    { guid: 'g3', title: 'Third', date: 'Sun, 02 Aug 2026 15:00:00 GMT' },
    { guid: 'g2', title: 'Second', date: 'Sat, 01 Aug 2026 15:00:00 GMT' },
    { guid: 'g1', title: 'First', date: 'Fri, 31 Jul 2026 15:00:00 GMT' },
  ];
  const body = its.map((it) => `<item><title>${it.title}</title><guid>${it.guid}</guid><pubDate>${it.date}</pubDate>`
    + `<enclosure url="https://www.patreon.com/api/rss/u/${TOKEN}/e/${it.guid}.mp3" length="1000" type="audio/mpeg"/></item>`).join('');
  return `<rss><channel><title>My Show</title><itunes:author>Auth Or</itunes:author>${body}</channel></rss>`;
}

async function addSub(backfill = 'all') {
  const input = store.validateAddInput({ feedUrl: FEED_URL, backfill });
  const id = store.subscriptionIdFor(input.feed.url);
  secrets.setFeedSecret(dataDir, id, input.feed.url);
  await deps.updateDatabase((mdb) => {
    const ns = store.ensurePodcasts(mdb);
    return store.reduceAddSubscription(ns, store.subscriptionRecordFrom({ id, feed: input.feed, name: '', backfill: input.backfill, nowMs: 1, order: 0 }));
  });
  return id;
}

test('backfill all: every episode downloads newest-first; metadata adopted; status honest and REDACTED', async () => {
  const id = await addSub('all');
  await podcasts.runPodcastPoll(deps, id);

  const ns = store.readPodcasts(db);
  const sub = ns.subscriptions[0];
  assert.strictEqual(sub.name, 'My Show', 'feed title adopted');
  assert.strictEqual(sub.author, 'Auth Or');
  assert.strictEqual(sub.showDirName, 'My Show');
  assert.match(sub.lastStatus, /ok: 3 new, 3 downloaded/);
  assert.ok(!JSON.stringify(ns).includes(TOKEN), 'the token appears NOWHERE in the namespace');

  assert.strictEqual(downloads.length, 3);
  assert.deepStrictEqual(downloads.map((d) => d.finalName), [
    'Third [rss=g3].mp3', 'Second [rss=g2].mp3', 'First [rss=g1].mp3',
  ], 'newest-first download order');
  assert.ok(downloads[0].destDir.endsWith(path.join('podcasts', 'My Show')), `show dir under the default root: ${downloads[0].destDir}`);

  const eps = store.episodesForSub(ns.episodes, id);
  assert.strictEqual(eps.length, 3);
  assert.ok(eps.every((e) => e.status === 'downloaded'));
  assert.ok(eps.every((e) => fs.existsSync(e.filePath)));
});

test('backfill new: first poll records everything as skipped, downloads nothing; the NEXT item downloads', async () => {
  const id = await addSub('new');
  await podcasts.runPodcastPoll(deps, id);
  let eps = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.strictEqual(eps.length, 3);
  assert.ok(eps.every((e) => e.status === 'skipped'));
  assert.strictEqual(downloads.length, 0);

  deps.fetchFeedImpl = async () => ({ ok: true, body: feedXml([
    { guid: 'g4', title: 'Fourth', date: 'Mon, 03 Aug 2026 15:00:00 GMT' },
    { guid: 'g3', title: 'Third', date: 'Sun, 02 Aug 2026 15:00:00 GMT' },
  ]) });
  await podcasts.runPodcastPoll(deps, id);
  eps = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.strictEqual(eps.length, 4);
  assert.strictEqual(eps.find((e) => e.guid === 'g4').status, 'downloaded', 'the genuinely-new episode downloads');
  assert.strictEqual(eps.find((e) => e.guid === 'g3').status, 'skipped', 'the skipped record is never resurrected');
  assert.deepStrictEqual(downloads.map((d) => d.finalName), ['Fourth [rss=g4].mp3']);
});

test('backfill latest-2: newest two download, the rest recorded as skipped', async () => {
  const id = await addSub(2);
  await podcasts.runPodcastPoll(deps, id);
  const eps = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.deepStrictEqual(eps.map((e) => [e.guid, e.status]), [
    ['g3', 'downloaded'], ['g2', 'downloaded'], ['g1', 'skipped'],
  ]);
});

test('feed fetch failure: backoff arms, failure count rises, status redacted; recovery clears both', async () => {
  const id = await addSub('all');
  deps.fetchFeedImpl = async () => ({ ok: false, error: `HTTP 403` });
  await podcasts.runPodcastPoll(deps, id);
  let sub = store.readPodcasts(db).subscriptions[0];
  assert.match(sub.lastStatus, /error: feed fetch failed \(HTTP 403\)/);
  assert.strictEqual(sub.checkFailures, 1);
  assert.ok(sub.backoffUntil > deps.now(), 'backoff armed');

  // While in backoff, a TIMER poll skips it entirely...
  deps.fetchFeedImpl = async () => { throw new Error('must not be called'); };
  await podcasts.runPodcastPoll(deps, null);
  // ...but an explicit per-sub check bypasses backoff and recovers.
  deps.fetchFeedImpl = async () => ({ ok: true, body: feedXml(), finalUrl: 'https://x' });
  await podcasts.runPodcastPoll(deps, id);
  sub = store.readPodcasts(db).subscriptions[0];
  assert.strictEqual(sub.checkFailures, 0);
  assert.strictEqual(sub.backoffUntil, 0);
});

test('a token-bearing error string is scrubbed before it reaches lastStatus', async () => {
  const id = await addSub('all');
  deps.fetchFeedImpl = async () => ({ ok: false, error: `request to https://www.patreon.com/rss/show?auth=${TOKEN} failed` });
  await podcasts.runPodcastPoll(deps, id);
  const sub = store.readPodcasts(db).subscriptions[0];
  assert.ok(!sub.lastStatus.includes(TOKEN), `token must not survive redaction: ${sub.lastStatus}`);
  assert.ok(sub.lastStatus.includes('error: feed fetch failed'), sub.lastStatus);
});

test('missing secret (post-restore): sub flagged secretMissing with an honest status, nothing fetched', async () => {
  const id = await addSub('all');
  secrets.deleteFeedSecret(dataDir, id);
  let fetched = false;
  deps.fetchFeedImpl = async () => { fetched = true; return { ok: true, body: feedXml() }; };
  await podcasts.runPodcastPoll(deps, id);
  const sub = store.readPodcasts(db).subscriptions[0];
  assert.strictEqual(sub.secretMissing, true);
  assert.match(sub.lastStatus, /needs re-entry/);
  assert.strictEqual(fetched, false);
});

test('a failed episode download marks failed (redacted) and retries on the next poll', async () => {
  const id = await addSub('all');
  let calls = 0;
  deps.downloadEnclosureImpl = async (url, destDir, finalName) => {
    calls += 1;
    if (finalName.includes('g2')) return { ok: false, error: `GET /u/${TOKEN}/e/g2.mp3 refused` };
    const p = path.join(destDir, finalName);
    fs.writeFileSync(p, 'FAKEAUDIO');
    return { ok: true, filePath: p, bytes: 9 };
  };
  await podcasts.runPodcastPoll(deps, id);
  let ns = store.readPodcasts(db);
  const g2 = store.episodesForSub(ns.episodes, id).find((e) => e.guid === 'g2');
  assert.strictEqual(g2.status, 'failed');
  assert.ok(!g2.lastError.includes(TOKEN), `episode error redacted: ${g2.lastError}`);
  assert.match(ns.subscriptions[0].lastStatus, /2 downloaded, 1 failed/);

  // Next poll: only the failed one re-downloads (the others are archived).
  deps.downloadEnclosureImpl = async (url, destDir, finalName) => {
    calls += 1;
    const p = path.join(destDir, finalName);
    fs.writeFileSync(p, 'FAKEAUDIO');
    return { ok: true, filePath: p, bytes: 9 };
  };
  const before = calls;
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(calls - before, 1, 'exactly the failed episode retried');
  ns = store.readPodcasts(db);
  assert.strictEqual(store.episodesForSub(ns.episodes, id).find((e) => e.guid === 'g2').status, 'downloaded');
});

test('reconcile: file deleted while root PRESENT -> deleted-on-disk tombstone; root ABSENT -> untouched (mount-loss guard)', async () => {
  const id = await addSub('all');
  await podcasts.runPodcastPoll(deps, id);
  const ns = store.readPodcasts(db);
  const eps = store.episodesForSub(ns.episodes, id);

  fs.unlinkSync(eps[0].filePath);
  await podcasts.reconcileDownloads(deps);
  let after = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.strictEqual(after[0].status, 'deleted-on-disk');
  assert.strictEqual(after[1].status, 'downloaded', 'siblings untouched');

  // Root vanishes wholesale (unmount): NOTHING else may be tombstoned.
  fs.rmSync(mediaRoot, { recursive: true, force: true });
  await podcasts.reconcileDownloads(deps);
  after = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.strictEqual(after[1].status, 'downloaded', 'mount loss never tombstones');

  // And the tombstoned episode is NEVER re-downloaded by a later poll.
  const countBefore = downloads.length;
  fs.mkdirSync(mediaRoot, { recursive: true });
  await podcasts.runPodcastPoll(deps, id);
  const redownloaded = downloads.slice(countBefore).filter((d) => d.finalName.includes('g3'));
  assert.deepStrictEqual(redownloaded, [], 'deleted stays gone');
});

test('sweepPartFiles: removes .ptpart leftovers inside show dirs, touches nothing else', async () => {
  const id = await addSub('all');
  await podcasts.runPodcastPoll(deps, id);
  const showDir = path.join(mediaRoot, 'My Show');
  fs.writeFileSync(path.join(showDir, '.Ep [rss=gx].mp3.ptpart'), 'partial');
  fs.writeFileSync(path.join(showDir, 'keeper.txt'), 'keep');
  podcasts.sweepPartFiles(deps);
  const left = fs.readdirSync(showDir).sort();
  assert.ok(!left.some((f) => f.endsWith('.ptpart')), 'ptparts swept');
  assert.ok(left.includes('keeper.txt'), 'unrelated files kept');
  assert.strictEqual(store.readPodcasts(db).subscriptions[0].id, id, 'db untouched by the sweep');
});

test('paused subs are skipped by the timer poll but honored on explicit check', async () => {
  const id = await addSub('all');
  await deps.updateDatabase((mdb) => store.reduceUpdateSubscription(store.ensurePodcasts(mdb), id, { paused: true }));
  await podcasts.runPodcastPoll(deps, null);
  assert.strictEqual(downloads.length, 0, 'timer poll skips paused');
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(downloads.length, 3, 'explicit check downloads anyway');
});

test('the show cover downloads once as cover.jpg/png alongside the first episodes', async () => {
  const id = await addSub('all');
  deps.fetchFeedImpl = async () => ({
    ok: true,
    body: feedXml().replace('<itunes:author>', '<itunes:image href="https://cdn.example/art/1.png?token-hash=x"></itunes:image><itunes:author>'),
  });
  await podcasts.runPodcastPoll(deps, id);
  const cover = downloads.find((d) => d.finalName === 'cover.png');
  assert.ok(cover, 'cover requested with the png name (URL is .png)');
});
