'use strict';

// [UNIT] v1.69.0 gate fix round 1 - each test binds one adversarial finding
// so the fixed behavior cannot silently regress:
//   #1 the empty-but-present mountpoint signature (CRITICAL)
//   #2 feed-derived text redacted at the persist boundary
//   #3 the poll timer arms on the FIRST subscription
//   #5 orphaned feed secrets are reaped
//   #6 unsubscribe/pause stops a backfill at the episode boundary
//   #7 parser: CDATA-hosted comment/DOCTYPE markers are content
//   #8 podcast downloads serialize through the REAL heavy gate (binding,
//      not presence - the mutant that drops runExclusive must fail here)
//   #14 a coalesced explicit check keeps its target

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const podcasts = require('../../lib/podcasts');
const store = require('../../lib/podcasts/store');
const secrets = require('../../lib/podcasts/secrets');
const feed = require('../../lib/podcasts/feed');
const heavyGate = require('../../lib/heavyGate');

const TOKEN = 'SuperSecretAuthToken99';
const FEED_URL = `https://www.patreon.com/rss/show?auth=${TOKEN}`;

let dataDir, mediaRoot, db, deps, downloads;

beforeEach(() => {
  podcasts.resetPodcastsStateForTests();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-podfix-'));
  mediaRoot = path.join(dataDir, 'podcasts');
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
      downloads.push(finalName);
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
  const body = its.map((it) => `<item><title>${it.title}</title>${it.omitGuid ? '' : `<guid>${it.guid}</guid>`}<pubDate>${it.date}</pubDate>`
    + `${it.description ? `<description>${it.description}</description>` : ''}`
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

// ---- #1 the empty-but-present mountpoint signature -------------------------

test('#1: ALL episodes vanishing at once (root present + empty) tombstones NOTHING; a partial deletion still reconciles', async () => {
  const id = await addSub('all');
  await podcasts.runPodcastPoll(deps, id);
  const eps = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.strictEqual(eps.length, 3);

  // Simulate the unmount: empty the whole root but leave the mountpoint.
  const showDir = path.dirname(eps[0].filePath);
  for (const ep of eps) fs.unlinkSync(ep.filePath);
  for (const f of fs.readdirSync(showDir)) fs.unlinkSync(path.join(showDir, f));
  assert.ok(fs.existsSync(mediaRoot), 'the mountpoint survives the simulated unmount');

  await podcasts.reconcileDownloads(deps);
  let after = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.deepStrictEqual(after.map((e) => e.status), ['downloaded', 'downloaded', 'downloaded'],
    'the unmount signature tombstones nothing');
  assert.ok(after.every((e) => e.filePath !== ''), 'filePaths intact for the remount');

  // "Remount": put two of three files back - now ONE missing file is a
  // genuine deletion and reconciles normally (the signature is defused).
  fs.writeFileSync(after[1].filePath, 'FAKEAUDIO');
  fs.writeFileSync(after[2].filePath, 'FAKEAUDIO');
  await podcasts.reconcileDownloads(deps);
  after = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.deepStrictEqual(after.map((e) => e.status), ['deleted-on-disk', 'downloaded', 'downloaded'],
    'one survivor defuses the signature; the genuinely-deleted file tombstones');
});

// ---- #2 boundary redaction --------------------------------------------------

test('#2/D2: a guid-less item stores a 32-hex identity (guidKey, not redaction); the namespace stays token-free', async () => {
  const id = await addSub('all');
  deps.fetchFeedImpl = async () => ({
    ok: true,
    body: feedXml([
      { guid: 'gx', title: 'NoGuid Ep', date: 'Sun, 02 Aug 2026 15:00:00 GMT', omitGuid: true, description: `Your private feed: ${FEED_URL} - do not share.` },
    ]),
  });
  await podcasts.runPodcastPoll(deps, id);
  const ns = store.readPodcasts(db);
  const json = JSON.stringify(ns);
  assert.ok(!json.includes(TOKEN), `the token appears NOWHERE in the namespace: ${json.slice(0, 400)}`);
  const eps = store.episodesForSub(ns.episodes, id);
  assert.strictEqual(eps.length, 1);
  // Delta round D2: the stored identity is guidKey's md5 of the raw guid -
  // strictly stronger than asserting a redaction spelling, and independent
  // of the secrets map by construction.
  assert.match(eps[0].guid, /^[0-9a-f]{32}$/, `the guid fallback stores a 32-hex key: ${eps[0].guid}`);
  assert.strictEqual(eps[0].status, 'downloaded', 'the hashed guid still keys the download pipeline');
  assert.ok(eps[0].description.includes('<redacted>') || !eps[0].description.includes('auth='), `description scrubbed: ${eps[0].description}`);

  // Stability: a second poll of the same feed creates NO duplicate record
  // (the hashed guid is a stable archive key).
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(store.episodesForSub(store.readPodcasts(db).episodes, id).length, 1);
});

test('D2: episode identity is INDEPENDENT of the secrets map - an unrelated new subscription never re-keys another show', async () => {
  // Show A: permalink-style URL guids (the commonest shape in the wild).
  const inputA = store.validateAddInput({ feedUrl: 'https://showa.invalid/rss' });
  const idA = store.subscriptionIdFor(inputA.feed.url);
  secrets.setFeedSecret(dataDir, idA, inputA.feed.url);
  await deps.updateDatabase((mdb) => store.reduceAddSubscription(store.ensurePodcasts(mdb),
    store.subscriptionRecordFrom({ id: idA, feed: inputA.feed, name: 'Show A', backfill: 'all', nowMs: 1, order: 0 })));
  const feedA = '<rss><channel><title>Show A</title>'
    + [1, 2, 3].map((n) => `<item><title>Ep ${n}</title><guid>https://showa.invalid/podcast/episode-${n}</guid><pubDate>Sun, 0${n} Aug 2026 15:00:00 GMT</pubDate><enclosure url="https://showa.invalid/audio/${n}.mp3" type="audio/mpeg"/></item>`).join('')
    + '</channel></rss>';
  deps.fetchFeedImpl = async () => ({ ok: true, body: feedA, finalUrl: 'https://x' });
  await podcasts.runPodcastPoll(deps, idA);
  assert.strictEqual(downloads.length, 3);
  const guidsBefore = store.episodesForSub(store.readPodcasts(db).episodes, idA).map((e) => e.guid).sort();

  // The user subscribes to an UNRELATED feed whose URL carries a mundane
  // query value ('podcast') that substring-matches Show A's guids - the
  // exact trigger that re-keyed and re-downloaded Show A under redaction-
  // based identity.
  const inputB = store.validateAddInput({ feedUrl: 'https://showb.invalid/rss?format=podcast' });
  const idB = store.subscriptionIdFor(inputB.feed.url);
  secrets.setFeedSecret(dataDir, idB, inputB.feed.url);
  await deps.updateDatabase((mdb) => store.reduceAddSubscription(store.ensurePodcasts(mdb),
    store.subscriptionRecordFrom({ id: idB, feed: inputB.feed, name: 'Show B', backfill: 'all', nowMs: 2, order: 0 })));

  await podcasts.runPodcastPoll(deps, idA); // re-poll Show A with B's secret now in the map
  const after = store.episodesForSub(store.readPodcasts(db).episodes, idA);
  assert.strictEqual(after.length, 3, 'no duplicate records for the untouched show');
  assert.deepStrictEqual(after.map((e) => e.guid).sort(), guidsBefore, 'identities unchanged by the unrelated subscription');
  assert.strictEqual(downloads.length, 3, 'NO re-download of the untouched show');
});

test('D1: stripComments is linear - a many-comment in-cap document parses in bounded time, output shapes intact', () => {
  // 8000 comments / ~4.1MB, zero CDATA: the shape that was O(comments x
  // length). Sizing per the delta-round-2 measurement (E1 - the first
  // version of this lock did NOT fail the quadratic mutant): the linear
  // form runs this in 22-24ms (~42x headroom under the 1s ceiling); the
  // reverted quadratic form takes ~7.3s (7.3x OVER it). Both margins
  // measured, not extrapolated.
  const filler = 'x'.repeat(500);
  let doc = '<rss><channel><title>t</title>';
  for (let i = 0; i < 8000; i += 1) {
    doc += `<!-- c${i} -->${filler}`;
  }
  doc += '<item><title>Ep</title><guid>g1</guid><enclosure url="https://h.example/1.mp3" type="audio/mpeg"/></item></channel></rss>';
  const t0 = process.hrtime.bigint();
  const r = feed.parsePodcastFeed(doc);
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, 1, 'content survives the comment flood');
  assert.ok(elapsedMs < 1000, `linear-time parse (took ${elapsedMs.toFixed(0)}ms; the quadratic form measures ~7300ms here)`);
});

// ---- #3 timer arms on first subscription ------------------------------------

test('#3: armPodcastsTimer arms (and re-arms idempotently) from the add path state', () => {
  // Direct binding of the arming primitive against a db WITH a sub - the
  // add route calls armPodcastsTimer(d); this proves that call arms a real
  // interval for the default 60 minutes.
  const realSetInterval = global.setInterval;
  const armed = [];
  global.setInterval = (fn, ms) => { armed.push(ms); return { unref() {} }; };
  try {
    db = { podcasts: { subscriptions: [{ id: 's1' }], episodes: {}, settings: {} } };
    podcasts.armPodcastsTimer(deps);
    assert.deepStrictEqual(armed, [60 * 60 * 1000], 'armed at the default 60 minutes');
    podcasts.armPodcastsTimer(deps);
    assert.strictEqual(armed.length, 2, 're-arm is clear+arm, not a stack');
  } finally {
    global.setInterval = realSetInterval;
    podcasts.resetPodcastsStateForTests();
  }
});

// ---- #5 orphan secret sweep ---------------------------------------------------

test('#5/E2: sweepOrphanFeedSecrets ARCHIVES orphans (0600 .orphaned, recoverable), keeps live ones', async () => {
  const id = await addSub('all');
  secrets.setFeedSecret(dataDir, 'ffffffffffffffffffffffffffff0bad', 'https://gone.example/rss?auth=OrphanedTok123');
  podcasts.sweepOrphanFeedSecrets(deps);
  const map = secrets.loadFeedSecrets(dataDir);
  assert.strictEqual(map[id], FEED_URL, 'the live secret survives');
  assert.strictEqual(map['ffffffffffffffffffffffffffff0bad'], undefined, 'the orphan leaves the live map');
  // E2 lock (delta round 2, mutant MQ5): the credential is MOVED, not
  // destroyed - dropping the archive call must fail here.
  const archivePath = `${secrets.resolveSecretsPath(dataDir)}.orphaned`;
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  assert.strictEqual(archive['ffffffffffffffffffffffffffff0bad'], 'https://gone.example/rss?auth=OrphanedTok123', 'the orphan is recoverable from the archive');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(archivePath).mode & 0o777, 0o600, 'the archive is 0600');
  }
});

test('E3: a corrupt .orphaned archive is preserved aside, never silently overwritten', async () => {
  const id = await addSub('all');
  const archivePath = `${secrets.resolveSecretsPath(dataDir)}.orphaned`;
  fs.writeFileSync(archivePath, '{corrupt json');
  secrets.setFeedSecret(dataDir, 'ffffffffffffffffffffffffffff0bad', 'https://gone.example/rss?auth=Tok');
  podcasts.sweepOrphanFeedSecrets(deps);
  assert.ok(fs.existsSync(`${archivePath}.corrupt`), 'the corrupt archive is preserved as evidence');
  assert.strictEqual(fs.readFileSync(`${archivePath}.corrupt`, 'utf8'), '{corrupt json');
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  assert.ok(archive['ffffffffffffffffffffffffffff0bad'], 'the fresh archive carries the new orphan');
  assert.strictEqual(secrets.loadFeedSecrets(dataDir)[id], FEED_URL, 'the live secret is untouched throughout');
});

// ---- #6 unsubscribe/pause stops the backfill ---------------------------------

test('#6: an unsubscribe taken mid-backfill stops the loop at the next episode boundary', async () => {
  const id = await addSub('all');
  let calls = 0;
  deps.downloadEnclosureImpl = async (url, destDir, finalName) => {
    calls += 1;
    if (calls === 1) {
      // The user unsubscribes while episode 1 is in flight.
      await deps.updateDatabase((mdb) => store.reduceDeleteSubscription(store.ensurePodcasts(mdb), id) !== false);
    }
    const p = path.join(destDir, finalName);
    fs.writeFileSync(p, 'FAKEAUDIO');
    return { ok: true, filePath: p, bytes: 9 };
  };
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(calls, 1, 'no further episode downloads after the unsubscribe');
});

test('#6/E2: a pause taken mid-backfill stops the loop AND writes an honest terminal status', async () => {
  const id = await addSub('all');
  let calls = 0;
  deps.downloadEnclosureImpl = async (url, destDir, finalName) => {
    calls += 1;
    if (calls === 1) {
      await deps.updateDatabase((mdb) => store.reduceUpdateSubscription(store.ensurePodcasts(mdb), id, { paused: true }));
    }
    const p = path.join(destDir, finalName);
    fs.writeFileSync(p, 'FAKEAUDIO');
    return { ok: true, filePath: p, bytes: 9 };
  };
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(calls, 1, 'pause stops the backfill at the boundary');
  // E2 lock (delta round 2, mutant MQ4): the stop path must not strand
  // "pending first check" - deleting the status write must fail here.
  const sub = store.readPodcasts(db).subscriptions[0];
  assert.strictEqual(sub.lastStatus, 'paused mid-check: 1 downloaded, 2 still queued');
  assert.strictEqual(sub.lastCheckedAt, deps.now(), 'lastCheckedAt is stamped on the stop path');
});

// ---- #7 parser CDATA/comment interaction --------------------------------------

test('#7: comment markers inside CDATA are content - no items vanish, no enclosure mis-pairing', () => {
  const xml = '<rss><channel><title>t</title>'
    + '<item><title>Episode 1</title><guid>g1</guid><enclosure url="https://h.example/1.mp3" type="audio/mpeg"/></item>'
    + '<item><title>Episode 2</title><guid>g2</guid><description><![CDATA[notes with an open <!-- marker]]></description><enclosure url="https://h.example/2.mp3" type="audio/mpeg"/></item>'
    + '<item><title>Episode 3</title><guid>g3</guid><enclosure url="https://h.example/3.mp3" type="audio/mpeg"/></item>'
    + '<item><title>Episode 4</title><guid>g4</guid><enclosure url="https://h.example/4.mp3" type="audio/mpeg"/></item>'
    + '<item><title>Episode 5</title><guid>g5</guid><description><![CDATA[and a close --> marker]]></description><enclosure url="https://h.example/5.mp3" type="audio/mpeg"/></item>'
    + '<item><title>Episode 6</title><guid>g6</guid><enclosure url="https://h.example/6.mp3" type="audio/mpeg"/></item>'
    + '</channel></rss>';
  const r = feed.parsePodcastFeed(xml);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.items.map((i) => i.guid), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'], 'every item survives');
  for (const it of r.items) {
    assert.ok(it.enclosureUrl.endsWith(`/${it.guid.slice(1)}.mp3`), `enclosure pairs with its own item: ${it.guid} -> ${it.enclosureUrl}`);
  }
});

test('#7: an unterminated <!-- outside CDATA keeps the tail as literal text (no silent mass deletion)', () => {
  const xml = '<rss><channel><title>t</title>'
    + '<item><title>Before <!-- oops</title><guid>g1</guid><enclosure url="https://h.example/1.mp3" type="audio/mpeg"/></item>'
    + '<item><title>After</title><guid>g2</guid><enclosure url="https://h.example/2.mp3" type="audio/mpeg"/></item>'
    + '</channel></rss>';
  const r = feed.parsePodcastFeed(xml);
  assert.strictEqual(r.items.length, 2, 'the remainder of the document survives');
  assert.strictEqual(r.items[1].guid, 'g2');
});

test('#7: a <!DOCTYPE string inside the body is content; a prelude DOCTYPE still strips', () => {
  const body = '<rss><channel><title>t</title>'
    + '<item><title>Ep</title><guid>g1</guid><description><![CDATA[mentions <!DOCTYPE html [ stuff ]]]></description><enclosure url="https://h.example/1.mp3" type="audio/mpeg"/></item>'
    + '<item><title>Ep2</title><guid>g2</guid><enclosure url="https://h.example/2.mp3" type="audio/mpeg"/></item>'
    + '</channel></rss>';
  const r = feed.parsePodcastFeed(body);
  assert.deepStrictEqual(r.items.map((i) => i.guid), ['g1', 'g2'], 'body DOCTYPE text swallows nothing');
  const withPrelude = '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "AAAA">]>' + body;
  const r2 = feed.parsePodcastFeed(withPrelude);
  assert.deepStrictEqual(r2.items.map((i) => i.guid), ['g1', 'g2'], 'prelude DOCTYPE still stripped opaquely');
});

// ---- #8 the heavy-gate BINDING -------------------------------------------------

test('#8: podcast downloads serialize through the REAL heavy gate - a concurrent gate job never overlaps a download', async () => {
  const id = await addSub('all');
  const log = [];
  deps.runExclusive = heavyGate.runExclusive; // the REAL gate, not a passthrough
  // Deterministic handshake (delta-round suggestion #6): the test waits for
  // the FIRST download to signal it has started before enqueuing the
  // contender - no timing sleep, so `starts >= 1` can never flake.
  let signalFirstStart;
  const firstStart = new Promise((r) => { signalFirstStart = r; });
  deps.downloadEnclosureImpl = async (url, destDir, finalName) => {
    log.push(`start:${finalName}`);
    signalFirstStart();
    await new Promise((r) => setTimeout(r, 20));
    log.push(`end:${finalName}`);
    const p = path.join(destDir, finalName);
    fs.writeFileSync(p, 'FAKEAUDIO');
    return { ok: true, filePath: p, bytes: 9 };
  };

  const pollDone = podcasts.runPodcastPoll(deps, id);
  await firstStart; // the first download is provably IN FLIGHT
  const contender = heavyGate.runExclusive(() => { log.push('contender'); });
  await Promise.all([pollDone, contender]);

  const idx = log.indexOf('contender');
  assert.notStrictEqual(idx, -1);
  // The contender must sit at an episode BOUNDARY: every start before it
  // has its end before it. If downloads bypassed the gate (the surviving
  // mutant MG1), the contender lands inside a start..end span.
  const before = log.slice(0, idx);
  const starts = before.filter((l) => l.startsWith('start:')).length;
  const ends = before.filter((l) => l.startsWith('end:')).length;
  assert.strictEqual(starts, ends, `the contender never lands inside a download span: ${JSON.stringify(log)}`);
  assert.ok(starts >= 1, 'the gate was genuinely contended (a download ran first)');
});

// ---- #14 the coalesced rerun keeps its target ----------------------------------

test('#14: a check-now on a PAUSED sub arriving mid-poll still runs after the poll (target preserved)', async () => {
  const id = await addSub('all');
  await deps.updateDatabase((mdb) => store.reduceUpdateSubscription(store.ensurePodcasts(mdb), id, { paused: true }));

  let fetches = 0;
  let release;
  const hold = new Promise((r) => { release = r; });
  deps.fetchFeedImpl = async () => { fetches += 1; await hold; return { ok: true, body: feedXml(), finalUrl: 'https://x' }; };

  // A long-running EXPLICIT poll of the paused sub holds pollBusy...
  const first = podcasts.runPodcastPoll(deps, id);
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(fetches, 1, 'the first explicit check is in flight');
  // ...and a second explicit check-now arrives while it runs.
  await podcasts.runPodcastPoll(deps, id);
  release();
  await first;
  // The coalesced rerun fires on setImmediate - wait for it to complete.
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(fetches, 2, 'the coalesced rerun kept the explicit target (a rerun-all would have filtered the paused sub out)');
});
