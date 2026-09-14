'use strict';

// [UNIT] Wave 5 of the relational-migration arc (2026-09-14), fourth feature -
// the podcasts namespace (`podcasts.subscriptions/episodes/settings`) leaves
// the document model for podcasts_subscriptions (an ORDERED record list - the
// array order the routes sort by) / podcasts_episodes (one row per episode -
// the download ARCHIVE, tombstones included) / podcasts_settings behind
// lib/podcasts/store.js's feature store (FEATURE, createPodcastsStore). Binds
// the same axes as the tv / music / books suites: the v29 -> v30 migration
// (verbatim incl. the subscription ORDER, doc rows deleted, stamp inside the
// block, re-run idempotent, corrupt row rollback incl. all three CREATE
// TABLEs), the save-lock, the import route, exclusiveReplace, the test read,
// and the source locks on server.js AND the module (every one of its 21
// mutators writes through podcastsDb.mutate; every read is the snapshot).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, DOC_KV_NAMESPACES, SINGLETON_NAMES, FEATURE_DEFS, readPersistedDatabase, importParsedJson,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const podcastStore = require('../../lib/podcasts/store');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcasts-feature-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const sub = (id, over) => ({ id, name: id, feedUrlDisplay: `https://x.example/${id}`, feedHost: 'x.example', order: 0, paused: false, backfill: 'all', ...over });
const ep = (id, over) => ({ id, subId: 's1', guid: id, title: id, status: 'downloaded', ...over });
const TABLES = ['podcasts_subscriptions', 'podcasts_episodes', 'podcasts_settings'];
const EMPTY = { subscriptions: [], episodes: {}, settings: {} };

function rewindToV29(rows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec(TABLES.map((t) => `DROP TABLE ${t};`).join(' ') + ' PRAGMA user_version = 29');
  const kv = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  const single = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  for (const [kind, a, b, c] of rows) (kind === 'kv' ? kv.run(a, b, c) : single.run(a, b));
  raw.close();
}
const reopen = () => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }); return adapter; };
const docRows = () => adapter.sql.prepare("SELECT (SELECT COUNT(*) FROM doc_kv WHERE namespace LIKE 'podcasts.%') + (SELECT COUNT(*) FROM doc_single WHERE name LIKE 'podcasts.%') AS c").get().c;

test('migration v30: every part moves verbatim (the subscription ORDER included - the array, not a sort); doc rows deleted; stamp 30; load() has no podcasts key; save() works', () => {
  assert.ok(SCHEMA_VERSION >= 30);
  assert.ok(!DOC_KV_NAMESPACES.some((n) => n.startsWith('podcasts.')));
  assert.ok(!SINGLETON_NAMES.some((n) => n.startsWith('podcasts.')));
  assert.ok(FEATURE_DEFS.some((d) => d.name === 'podcasts'));
  const subs = [sub('s2', { order: 2 }), sub('s1', { order: 1 }), sub('s3', { order: 0, paused: true })];
  rewindToV29([
    ['single', 'podcasts.subscriptions', JSON.stringify(subs)],
    ['single', 'podcasts.settings', JSON.stringify({ pollMinutes: 45 })],
    ['kv', 'podcasts.episodes', 'e1', JSON.stringify(ep('e1', { filePath: '/p/Show/e1.mp3' }))],
    ['kv', 'podcasts.episodes', 'e2', JSON.stringify(ep('e2', { status: 'tombstone' }))],
  ]);
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const podcasts = podcastStore.createPodcastsStore(adapter);
  assert.deepStrictEqual(podcasts.read(), { subscriptions: subs, episodes: { e1: ep('e1', { filePath: '/p/Show/e1.mp3' }), e2: ep('e2', { status: 'tombstone' }) }, settings: { pollMinutes: 45 } });
  assert.strictEqual(docRows(), 0, 'every doc row is gone');
  const db = adapter.load();
  assert.strictEqual(db.podcasts, undefined, 'no doc-model podcasts key');
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(podcastStore.readPodcasts(podcasts.holder()), podcasts.read(), 'the module\'s read view over the holder is the same snapshot');
});

test('migration v30: re-run is a no-op; a corrupt episode row rolls the whole block back to a re-runnable v29 (all three CREATE TABLEs included)', () => {
  rewindToV29([]);
  reopen();
  podcastStore.createPodcastsStore(adapter).replaceAll({ subscriptions: [sub('kept')] });
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 29');
  raw.close();
  reopen();
  assert.deepStrictEqual(podcastStore.createPodcastsStore(adapter).read().subscriptions, [sub('kept')], 'a re-run neither wipes nor duplicates');
  rewindToV29([['single', 'podcasts.subscriptions', JSON.stringify([sub('good')])], ['kv', 'podcasts.episodes', 'bad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 29, 'the stamp is the last committed floor');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'podcasts.episodes'").get().c, 1, 'doc rows untouched');
  assert.strictEqual(raw.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name IN (${TABLES.map((t) => `'${t}'`).join(',')})`).get().c, 0, 'every table creation rolled back');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'bad'").run(JSON.stringify(ep('bad')));
  raw.close();
  reopen();
  assert.deepStrictEqual(Object.keys(podcastStore.createPodcastsStore(adapter).read().episodes), ['bad'], 'repaired and re-run');
});

test('save-lock: a stray `podcasts` container on the doc object is REFUSED (the container left the lock)', () => {
  assert.throws(() => adapter.save({ metadata: {}, podcasts: { subscriptions: [] } }), /unknown top-level db key 'podcasts'/);
});

test('importParsedJson: `podcasts` routes whole through replaceFeature (never doc rows); refused without the handle / on an unknown part / a bad shape', () => {
  const kv = [];
  const singles = [];
  const features = [];
  const h = { insertKv: (ns, k, v) => kv.push([ns, k, v]), insertSingle: (n, v) => singles.push([n, v]), insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: () => {}, replaceFolders: () => {}, insertFolderSetting: () => {}, insertFolderDisplayName: () => {}, replaceLiked: () => {}, replaceFeature: (name, ns) => features.push([name, ns]) };
  const ns = { subscriptions: [sub('s1')], episodes: { e1: ep('e1') }, settings: { pollMinutes: 0 } };
  const summary = importParsedJson({ metadata: {}, podcasts: ns }, h, { source: 'bundle' });
  assert.deepStrictEqual(features, [['podcasts', ns]]);
  assert.strictEqual(summary['podcasts.episodes'], 1);
  assert.strictEqual(summary['podcasts.subscriptions'], 1);
  assert.ok(!kv.some(([n]) => n.startsWith('podcasts.')) && !singles.some(([n]) => n.startsWith('podcasts.')), 'never a doc row');
  const noHandle = { ...h };
  delete noHandle.replaceFeature;
  assert.throws(() => importParsedJson({ podcasts: ns }, noHandle), /no replaceFeature handle/);
  assert.throws(() => importParsedJson({ podcasts: ['x'] }, h), /'podcasts' is not an object/);
  assert.throws(() => importParsedJson({ podcasts: { feedUrls: {} } }, h), /unknown key 'podcasts\.feedUrls'/, 'a feed-URL map is refused at the import too - the secret never enters the db');
});

test('exclusiveReplace: wipes all three tables, repopulates through replaceFeature inside its transaction, rolls back whole on a bad row', () => {
  const podcasts = podcastStore.createPodcastsStore(adapter);
  podcasts.replaceAll({ subscriptions: [sub('old')], episodes: { old: ep('old') }, settings: { pollMinutes: 5 } });
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual(podcasts.read(), EMPTY, 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.replaceFeature('podcasts', { subscriptions: [sub('b'), sub('a')], episodes: { e1: ep('e1') } }); });
  assert.deepStrictEqual(podcasts.read(), { ...EMPTY, subscriptions: [sub('b'), sub('a')], episodes: { e1: ep('e1') } });
  assert.throws(() => adapter.exclusiveReplace((h) => { h.replaceFeature('podcasts', { subscriptions: [{ noId: true }] }); }), /non-empty string id/);
  assert.deepStrictEqual(podcasts.read().subscriptions, [sub('b'), sub('a')], 'rolled back whole');
});

test('readPersistedDatabase: surfaces `podcasts` in its container shape only when some part has rows', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const podcasts = podcastStore.createPodcastsStore(adapter);
  podcasts.replaceAll({ settings: { pollMinutes: 0 } });
  assert.deepStrictEqual(readPersistedDatabase(dir), { podcasts: { ...EMPTY, settings: { pollMinutes: 0 } } });
  podcasts.replaceAll(null);
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

test('mutate: the module\'s reducers run on the holder and only the CHANGED rows are written; a `false` return writes nothing', () => {
  const podcasts = podcastStore.createPodcastsStore(adapter);
  podcasts.replaceAll({ subscriptions: [sub('s1'), sub('s2')], episodes: { e1: ep('e1'), e2: ep('e2') } });
  const writes = [];
  const spied = podcastStore.createPodcastsStore(adapter, { inSaveTransaction: (fn) => writes.push(fn()) });
  assert.strictEqual(spied.mutate((h) => podcastStore.reduceSetSubscriptionStatus(podcastStore.ensurePodcasts(h), 's2', { lastStatus: 'ok' })), true);
  assert.deepStrictEqual(writes, [{ rowsWritten: 2, rowsDeleted: 0 }], 'a record-list part rewrites whole (the doc row was the whole list); the untouched map + kv parts write nothing');
  assert.strictEqual(spied.mutate((h) => podcastStore.reduceSetSubscriptionStatus(podcastStore.ensurePodcasts(h), 'nope', { lastStatus: 'x' })), false, 'no such subscription = the skip contract');
  assert.strictEqual(writes.length, 1, 'nothing queued');
  spied.mutate((h) => podcastStore.reduceEpisodeStatus(podcastStore.ensurePodcasts(h), 'e2', 'tombstone'));
  assert.deepStrictEqual(writes[1], { rowsWritten: 1, rowsDeleted: 0 }, 'one episode row, the diff');
  assert.strictEqual(podcasts.read().episodes.e2.status, 'tombstone');
  assert.strictEqual(podcasts.read().subscriptions[1].lastStatus, 'ok');
});

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never names the podcasts tables or the dead doc spellings in CODE; the reads take podcastsDb.read(); the bundle + the restore preservation read the tables; the module writes ONLY through podcastsDb.mutate', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  for (const t of TABLES) assert.ok(!server.includes(t), t);
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|mdb|loaded|persisted|snapshot|handoffDb|getCachedDatabase\(\)|loadDatabase\(\))\.podcasts\b/.test(server), 'no doc-model podcasts access survives');
  assert.ok(!/podcastStore\.readPodcasts\(/.test(server), 'every read view moved to podcastsDb.read()');
  assert.ok(!/podcastStore\.ensurePodcasts\(/.test(server), 'server.js never mutates the namespace itself');
  assert.ok((server.match(/podcastsDb\.read\(\)/g) || []).length >= 14, 'the reads');
  assert.ok(/bundle\.podcasts = podcastsDb\.read\(\)/.test(server), 'the bundle reads the tables');
  assert.ok(/podcastsNs: \(\) => podcastsDb\.read\(\)/.test(server), 'search reaches the namespace through the dep');
  assert.strictEqual((server.match(/\bpodcastsDb,/g) || []).length, 3, 'the two deps bundles (routes + startBackground) and the export carry the store');
  const lib = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'podcasts', 'index.js'), 'utf8'));
  assert.strictEqual((lib.match(/\.updateDatabase\(/g) || []).length, 21, 'the module\'s 21 writers');
  assert.strictEqual((lib.match(/\.updateDatabase\(\(\) => (deps|d)\.podcastsDb\.mutate\(\(mdb\) =>/g) || []).length, 21, 'every one of them runs its reducers through the store');
  assert.ok(!/store\.readPodcasts\(/.test(lib), 'every read is the snapshot (readNs)');
  assert.ok(!/(deps|d)\.loadDatabase\(\)/.test(lib), 'no doc read left in the module (the external yt-dlp listers take getCachedDatabase; that is the only doc use)');
  assert.ok((lib.match(/readNs\((deps|d)\)/g) || []).length >= 25, 'the reads');
  const registry = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'search', 'registry.js'), 'utf8'));
  assert.ok(!/deps\.db\.podcasts/.test(registry), 'the search registry no longer reads the doc container');
});
