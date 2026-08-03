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

test('D1: a new-only sub with zero downloads still gets its cover (the root exists from the add)', async () => {
  coverAttempts = 1; // skip the fake's one planned failure
  const id = await addSub('new');
  // The ADD route creates the root (the one deliberate mkdir); this harness
  // seeds records directly, so stand it up the same way here.
  fs.mkdirSync(path.join(dataDir, 'podcasts'), { recursive: true });
  await podcasts.runPodcastPoll(deps, id);
  assert.ok(fs.existsSync(path.join(dataDir, 'podcasts', 'Show', 'cover.png')), 'cover lands with no episode downloads at all');
  const eps = store.episodesForSub(store.readPodcasts(db).episodes, id);
  assert.ok(eps.every((e) => e.status === 'skipped'), 'and the backfill policy was untouched');
});

// ---- gate fix round: the two CRITICALs + the unbound deliverables ----------

test('CRITICAL#1: isConfinedUnderRoot refuses every escape shape (both trash endpoints ride this)', () => {
  const root = '/data/podcasts';
  for (const ok of ['/data/podcasts/Show/ep.mp3', '/data/podcasts/.filetube-trash/1-a-ep.mp3', '/data/podcasts/a/b/c.mp3']) {
    assert.strictEqual(podcasts.isConfinedUnderRoot(ok, root), true, `inside: ${ok}`);
  }
  for (const bad of [
    '/etc/passwd', '/data/podcasts', '/data/podcasts-evil/x.mp3', '/data/podcasts/../secret',
    '/data/podcasts/Show/../../../etc/shadow', '', null, undefined, 42, '/data/session-secret',
  ]) {
    assert.strictEqual(podcasts.isConfinedUnderRoot(bad, root), false, `outside/invalid: ${String(bad)}`);
  }
});

test('CRITICAL#2: the sweep treats all-trash-files-missing as an unmount and purges NOTHING; a partial miss still purges', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const root = path.join(dataDir, 'podcasts');
  const trashDir = path.join(root, '.filetube-trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const mk = (id, name) => {
    const p = path.join(trashDir, name);
    fs.writeFileSync(p, 'BYTES');
    return { id, subId: 's1', guid: id, status: 'trashed', filePath: path.join(root, 'Show', `${id}.mp3`), trashPath: p, trashedAt: 1000 };
  };
  const purged = [];
  db = { settings: { trashRetentionDays: 7 }, podcasts: { subscriptions: [], episodes: {}, settings: {} } };
  for (const id of ['a', 'b', 'c']) db.podcasts.episodes[id] = mk(id, `${id}.mp3`);
  deps.now = () => 1000 + 30 * DAY; // all three are long expired
  deps.userStore = { removePodcastEpisodeState: (ids) => purged.push(...ids) };

  // The unmount shape: the mountpoint is present (and holds the trash dir),
  // but every tracked trash file has vanished at once.
  for (const id of ['a', 'b', 'c']) fs.unlinkSync(db.podcasts.episodes[id].trashPath);
  await podcasts.sweepExpiredTrash(deps);
  assert.deepStrictEqual(Object.values(db.podcasts.episodes).map((e) => e.status), ['trashed', 'trashed', 'trashed'], 'nothing tombstoned');
  assert.deepStrictEqual(purged, [], 'no per-user rows purged');
  assert.ok(db.podcasts.episodes.a.trashPath, 'the trash pointers survive for the remount');

  // One survivor defuses the signature: the genuinely-expired ones purge.
  fs.writeFileSync(db.podcasts.episodes.c.trashPath, 'BYTES');
  await podcasts.sweepExpiredTrash(deps);
  const statuses = Object.values(db.podcasts.episodes).map((e) => e.status);
  assert.deepStrictEqual(statuses, ['tombstone', 'tombstone', 'tombstone'], 'a real purge still works');
  assert.deepStrictEqual(purged.sort(), ['a', 'b', 'c'], 'and retires the per-user rows');
  assert.ok(!fs.existsSync(db.podcasts.episodes.c.trashPath), 'the surviving trash file is unlinked');
});

test('CRITICAL#2 (compounding half): the cover retry never RECREATES a vanished podcasts root', async () => {
  const id = await addSub('all');
  await podcasts.runPodcastPoll(deps, id); // establishes the root + cover
  const root = path.join(dataDir, 'podcasts');
  fs.rmSync(root, { recursive: true, force: true });
  coverAttempts = 0;
  deps.fetchFeedImpl = async () => ({
    ok: true,
    body: '<rss><channel><title>Show</title><itunes:image href="https://cdn.example/art/big.png"></itunes:image></channel></rss>',
  });
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(fs.existsSync(root), false, 'a vanished root stays vanished - mkdir must never resurrect it');
  assert.strictEqual(coverAttempts, 0, 'and no art fetch is attempted against a missing root');
});

test('WARNING#3: the cover fetch gets a 2-minute ceiling, never the episode hour', async () => {
  const id = await addSub('all');
  let seenOpts = null;
  deps.downloadEnclosureImpl = async (url, destDir, finalName, opts) => {
    if (finalName.startsWith('cover.')) { seenOpts = opts; return { ok: false, error: 'x' }; }
    const p = path.join(destDir, finalName);
    fs.writeFileSync(p, 'AUDIO');
    return { ok: true, filePath: p, bytes: 5 };
  };
  await podcasts.runPodcastPoll(deps, id);
  assert.strictEqual(seenOpts.totalTimeoutMs, podcasts.COVER_TOTAL_TIMEOUT_MS);
  assert.strictEqual(podcasts.COVER_TOTAL_TIMEOUT_MS, 120000, 'two minutes');
  assert.ok(seenOpts.totalTimeoutMs < 60 * 60 * 1000, 'strictly under the enclosure hour');
  // QA W3: the constant lock alone is the DECISION; this binds the USE.
  // An 8MB literal at the call site would pass every other test while
  // silently re-killing Dean's measured 15.5MB cover.
  assert.strictEqual(seenOpts.maxBytes, podcasts.COVER_MAX_BYTES, 'the cover call site passes the locked cap');
});

test('WARNING#4 (MV6): the cover cap constant is LOCKED above the measured real-world 15.5MB cover', () => {
  // Dean's real Patreon cover measured 15,494,765 bytes; the 8MB cap is what
  // silently killed it. A revert to 8MB must fail HERE.
  assert.strictEqual(podcasts.COVER_MAX_BYTES, 32 * 1024 * 1024);
  assert.ok(podcasts.COVER_MAX_BYTES > 15494765 * 2, 'at least 2x headroom over the measured real cover');
});

test('delta CRITICAL: the confinement ROOT is operator-controlled only - a bundle-supplied settings.downloadDir cannot move it', () => {
  // The delta round's attack: the fix hardened the record's path fields,
  // but the ROOT they are measured against also rode the backup bundle -
  // so a crafted bundle MOVED the root and confinement approved everything
  // under it (a live session-secret was round-tripped out and back and
  // streamed over /episode/:id). No route has ever written this field.
  const hostile = { podcasts: { subscriptions: [], episodes: {}, settings: { downloadDir: '/tmp/attacker-chosen' } } };
  const resolved = podcasts.resolvePodcastsRoot(hostile, { dataDir: '/data' });
  assert.strictEqual(resolved, path.resolve('/data/podcasts'), 'the db cannot relocate the filesystem boundary its own contents are checked against');
  assert.notStrictEqual(resolved, '/tmp/attacker-chosen');
});

test('delta WARNING#2: an expired trashed episode outside the current root is left ENTIRELY alone (bytes AND record)', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const root = path.join(dataDir, 'podcasts');
  fs.mkdirSync(path.join(root, '.filetube-trash'), { recursive: true });
  // A survivor inside the root keeps the unmount signature from firing.
  const insidePath = path.join(root, '.filetube-trash', 'inside.mp3');
  fs.writeFileSync(insidePath, 'BYTES');
  // The victim of an operator moving FILETUBE_PODCASTS_DIR: its trash file
  // lives under the OLD root.
  const oldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-oldroot-'));
  const outsidePath = path.join(oldRoot, 'orphan.mp3');
  fs.writeFileSync(outsidePath, 'ONLYCOPY');

  const purged = [];
  db = {
    settings: { trashRetentionDays: 7 },
    podcasts: {
      subscriptions: [],
      episodes: {
        inside: { id: 'inside', subId: 's1', guid: 'i', status: 'trashed', filePath: path.join(root, 'S', 'i.mp3'), trashPath: insidePath, trashedAt: 1000 },
        outside: { id: 'outside', subId: 's1', guid: 'o', status: 'trashed', filePath: path.join(oldRoot, 'S', 'o.mp3'), trashPath: outsidePath, trashedAt: 1000 },
      },
      settings: {},
    },
  };
  deps.now = () => 1000 + 30 * DAY;
  deps.userStore = { removePodcastEpisodeState: (ids) => purged.push(...ids) };

  await podcasts.sweepExpiredTrash(deps);
  assert.strictEqual(db.podcasts.episodes.inside.status, 'tombstone', 'the in-root expiry purges normally');
  assert.ok(!fs.existsSync(insidePath), 'and its bytes go');
  assert.strictEqual(db.podcasts.episodes.outside.status, 'trashed', 'the out-of-root record is NOT tombstoned');
  assert.strictEqual(db.podcasts.episodes.outside.trashPath, outsidePath, 'its pointer survives');
  assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), 'ONLYCOPY', 'and the only copy of its bytes is untouched');
  assert.deepStrictEqual(purged, ['inside'], 'only the genuinely-purged episode retires its per-user rows');
  fs.rmSync(oldRoot, { recursive: true, force: true });
});

test('delta S2 (sweep tombstone): the sweep\'s tombstone carries a FROM-state guard (a record that changed state is never retired)', () => {
  const ns = nsWith('downloaded'); // e.g. restored between selection and mutation
  assert.strictEqual(store.reduceEpisodeStatus(ns, 'ep1', 'tombstone', { from: 'trashed' }), false, 'refuses: not trashed any more');
  assert.strictEqual(ns.episodes.ep1.status, 'downloaded', 'and leaves it alone');
  const ns2 = nsWith('trashed', { trashPath: '/r/.filetube-trash/x', trashedAt: 1 });
  assert.strictEqual(store.reduceEpisodeStatus(ns2, 'ep1', 'tombstone', { from: 'trashed' }), true, 'allows the genuine case');
  assert.strictEqual(store.reduceEpisodeStatus(nsWith('downloaded'), 'ep1', 'deleted-on-disk'), true, 'unguarded callers are unaffected');
});

test('delta S1: rows and record purge in LOCKSTEP - a record the {from} guard saves keeps its per-user rows', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const root = path.join(dataDir, 'podcasts');
  fs.mkdirSync(path.join(root, '.filetube-trash'), { recursive: true });
  const mk = (id) => {
    const p = path.join(root, '.filetube-trash', `${id}.mp3`);
    fs.writeFileSync(p, 'BYTES');
    return { id, subId: 's1', guid: id, status: 'trashed', filePath: path.join(root, 'S', `${id}.mp3`), trashPath: p, trashedAt: 1000 };
  };
  const purged = [];
  db = { settings: { trashRetentionDays: 7 }, podcasts: { subscriptions: [], episodes: { keep: mk('keep'), go: mk('go') }, settings: {} } };
  deps.now = () => 1000 + 30 * DAY;
  deps.userStore = { removePodcastEpisodeState: (ids) => purged.push(...ids) };
  // Simulate the interleaving the {from} guard exists for: 'keep' is
  // restored between the sweep's selection and its mutation.
  const realUpdate = deps.updateDatabase;
  deps.updateDatabase = async (m) => { db.podcasts.episodes.keep.status = 'downloaded'; await realUpdate(m); };

  await podcasts.sweepExpiredTrash(deps);
  assert.strictEqual(db.podcasts.episodes.keep.status, 'downloaded', 'the guard saved the restored record');
  assert.strictEqual(db.podcasts.episodes.go.status, 'tombstone', 'the genuine expiry still retires');
  assert.deepStrictEqual(purged, ['go'], 'ONLY the actually-tombstoned episode loses its per-user rows');
});

test('delta S2 (cover retry): a missing root during the cover retry names the real incident in the status', async () => {
  const id = await addSub('all');
  await podcasts.runPodcastPoll(deps, id);
  fs.rmSync(path.join(dataDir, 'podcasts'), { recursive: true, force: true });
  deps.fetchFeedImpl = async () => ({
    ok: true,
    body: '<rss><channel><title>Show</title><itunes:image href="https://cdn.example/art/big.png"></itunes:image></channel></rss>',
  });
  await podcasts.runPodcastPoll(deps, id);
  const sub = store.readPodcasts(db).subscriptions[0];
  assert.match(sub.lastStatus, /podcasts folder is missing - is the volume mounted\?/,
    `the operator-facing line names the incident, not "unexpected": ${sub.lastStatus}`);
});
