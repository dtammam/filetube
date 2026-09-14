'use strict';

// [UNIT] Wave 5 of the relational-migration arc (2026-09-14), fifth and last
// feature - the ytdlp namespace (`ytdlp.subscriptions/pins/downloadMeta/
// channelAvatars/allowMembersOnly`) leaves the document model for
// ytdlp_subscriptions + ytdlp_pins (ORDERED record lists), ytdlp_download_meta
// (the download->scan identity bridge, one row per capture), ytdlp_channel_avatars
// and ytdlp_settings (the internal home of the allowMembersOnly value) behind
// lib/ytdlp/store.js's feature store (FEATURE, createYtdlpStore). After this
// block no doc_single name is left and `metadata` is the last doc_kv
// namespace. Binds the same axes as the sibling suites: the v30 -> v31
// migration (verbatim incl. order + the flag, an id-less legacy subscription
// gets its id minted, doc rows deleted, stamp inside the block, re-run
// idempotent, corrupt row rollback incl. all five CREATE TABLEs), the
// save-lock (the last container gone), the import route, exclusiveReplace, the
// test read, the value-part semantics, and the source locks on server.js AND
// the module (every store writer through ytdlpDb.mutate; the scan's bridge
// consumption rides the doc commit).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, FEATURE_DEFS, readPersistedDatabase, importParsedJson,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const sqliteModule = require('../../lib/db/sqlite');
const { ensureLegacyDocTables, countLegacyDocTables } = require('../helpers/legacy-doc-tables');
const { routeSurfaceSource } = require('../helpers/route-surface'); // Wave 7b: the source locks read server.js + its registerRoutes modules
const ytdlpStore = require('../../lib/ytdlp/store');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-feature-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const sub = (id, over) => ({ id, channelUrl: `https://www.youtube.com/@${id}`, name: id, format: 'video', quality: 'best', paused: false, order: 0, ...over });
const pin = (id, over) => ({ id, channelDir: `/dl/${id}`, label: id, pinnedAt: 1, order: 0, ...over });
const TABLES = ['ytdlp_subscriptions', 'ytdlp_pins', 'ytdlp_download_meta', 'ytdlp_channel_avatars', 'ytdlp_settings'];
const EMPTY = { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [], channelAvatars: {} };

function rewindToV30(rows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec(TABLES.map((t) => `DROP TABLE ${t};`).join(' ') + ' PRAGMA user_version = 30');
  ensureLegacyDocTables(raw);
  const kv = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  const single = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  for (const [kind, a, b, c] of rows) (kind === 'kv' ? kv.run(a, b, c) : single.run(a, b));
  raw.close();
}
const reopen = () => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }); return adapter; };

test('migration v31: every part moves verbatim (the ORDER of both lists, the flag, a spaced universal key); an id-less legacy subscription gets md5(channelUrl) minted; doc rows deleted; stamp 31; the doc lists and tables are gone (Wave 7)', () => {
  assert.ok(SCHEMA_VERSION >= 31);
  assert.ok(FEATURE_DEFS.some((d) => d.name === 'ytdlp'));
  const subs = [sub('b', { order: 1 }), sub('a', { order: 0 })];
  const legacy = { channelUrl: 'https://www.youtube.com/@legacy', name: 'Legacy (no id)', order: 2 }; // a pre-id record a hand-edited legacy file could carry
  const pins = [pin('p2', { order: 1 }), pin('p1', { order: 0 })];
  rewindToV30([
    ['single', 'ytdlp.subscriptions', JSON.stringify([...subs, legacy])],
    ['single', 'ytdlp.pins', JSON.stringify(pins)],
    ['single', 'ytdlp.allowMembersOnly', 'true'],
    ['kv', 'ytdlp.downloadMeta', 'dQw4w9WgXcQ', JSON.stringify({ channelUrl: 'https://www.youtube.com/@x', capturedAt: 5 })],
    ['kv', 'ytdlp.downloadMeta', 'reddit abc123', JSON.stringify({ universal: true, capturedAt: 6 })],
    ['kv', 'ytdlp.channelAvatars', 'UCaaaaaaaaaaaaaaaaaaaaaa', JSON.stringify({ avatarUrl: 'https://yt3.ggpht.com/a.jpg', fetchedAt: 7 })],
  ]);
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const ytdlp = ytdlpStore.createYtdlpStore(adapter);
  const got = ytdlp.read();
  assert.deepStrictEqual(got.subscriptions.slice(0, 2), subs, 'verbatim, in array order');
  assert.strictEqual(got.subscriptions[2].id, require('node:crypto').createHash('md5').update(ytdlpStore.normalizeChannelUrl(legacy.channelUrl)).digest('hex'), 'the legacy record got the id addSubscription would mint (md5 of the NORMALIZED url - a later re-add hits the existing branch, never a duplicate)');
  assert.strictEqual(got.subscriptions[2].name, 'Legacy (no id)');
  assert.deepStrictEqual(got.pins, pins);
  assert.strictEqual(got.allowMembersOnly, true, 'the flag moved into ytdlp_settings and reads back as the value part');
  assert.deepStrictEqual(Object.keys(got.downloadMeta).sort(), ['dQw4w9WgXcQ', 'reddit abc123'], 'the spaced universal key survives as its own row');
  assert.deepStrictEqual(got.channelAvatars, { UCaaaaaaaaaaaaaaaaaaaaaa: { avatarUrl: 'https://yt3.ggpht.com/a.jpg', fetchedAt: 7 } });
  assert.ok(!('settings' in got), 'the internal table is never a namespace key');
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
  assert.strictEqual(sqliteModule.DOC_KV_NAMESPACES, undefined, 'Wave 7: the doc lists are gone from the adapter\'s exports');
  assert.strictEqual(sqliteModule.SINGLETON_NAMES, undefined);
  assert.strictEqual(sqliteModule.CONTAINER_KEYS, undefined);
  const db = adapter.load();
  assert.strictEqual(db.ytdlp, undefined, 'no doc-model ytdlp key');
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(ytdlpStore.ensureYtdlp(ytdlp.holder()).channelAvatars, got.channelAvatars, 'the module\'s normaliser over the holder sees the same snapshot');
});

test('migration v31: re-run is a no-op; a corrupt avatar row rolls the whole block back to a re-runnable v30 (all five CREATE TABLEs included)', () => {
  rewindToV30([]);
  reopen();
  ytdlpStore.createYtdlpStore(adapter).replaceAll({ subscriptions: [sub('kept')], allowMembersOnly: true });
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 30');
  ensureLegacyDocTables(raw);
  raw.close();
  reopen();
  const again = ytdlpStore.createYtdlpStore(adapter).read();
  assert.deepStrictEqual(again.subscriptions, [sub('kept')], 'a re-run neither wipes nor duplicates');
  assert.strictEqual(again.allowMembersOnly, true, 'nor resets the flag');
  rewindToV30([['single', 'ytdlp.pins', JSON.stringify([pin('good')])], ['kv', 'ytdlp.channelAvatars', 'UCbad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 30, 'the stamp is the last committed floor');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name = 'ytdlp.pins'").get().c, 1, 'doc rows untouched');
  assert.strictEqual(raw.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name IN (${TABLES.map((t) => `'${t}'`).join(',')})`).get().c, 0, 'every table creation rolled back');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'UCbad'").run(JSON.stringify({ avatarUrl: 'https://yt3.ggpht.com/b.jpg' }));
  raw.close();
  reopen();
  assert.deepStrictEqual(ytdlpStore.createYtdlpStore(adapter).read().pins, [pin('good')], 'repaired and re-run');
});

test('save-lock: a stray `ytdlp` container on the doc object is REFUSED; the doc lock is metadata-only now', () => {
  assert.throws(() => adapter.save({ metadata: {}, ytdlp: { subscriptions: [] } }), /unknown top-level db key 'ytdlp'/);
  assert.doesNotThrow(() => adapter.save({ metadata: {} }));
});

test('importParsedJson: `ytdlp` routes whole through replaceFeature (never doc rows); refused without the handle / on an unknown part / a bad shape / a URL map', () => {
  const features = [];
  const h = { insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: () => {}, replaceFolders: () => {}, insertFolderSetting: () => {}, insertFolderDisplayName: () => {}, replaceLiked: () => {}, replaceFeature: (name, ns) => features.push([name, ns]) };
  const ns = { allowMembersOnly: true, subscriptions: [sub('s1')], downloadMeta: { v1: { channelUrl: 'https://www.youtube.com/@x' } }, pins: [pin('p1')], channelAvatars: {} };
  const summary = importParsedJson({ metadata: {}, ytdlp: ns }, h);
  assert.deepStrictEqual(features, [['ytdlp', ns]]);
  assert.strictEqual(summary['ytdlp.subscriptions'], 1);
  assert.strictEqual(summary['ytdlp.downloadMeta'], 1);
  const noHandle = { ...h };
  delete noHandle.replaceFeature;
  assert.throws(() => importParsedJson({ ytdlp: ns }, noHandle), /no replaceFeature handle/);
  assert.throws(() => importParsedJson({ ytdlp: ['x'] }, h), /'ytdlp' is not an object/);
  assert.throws(() => importParsedJson({ ytdlp: { tombstones: {} } }, h), /unknown key 'ytdlp\.tombstones'/);
  assert.throws(() => importParsedJson({ ytdlp: { settings: {} } }, h), /unknown key 'ytdlp\.settings'/, 'the internal table is not a bundle key');
  // gate pass B (adversarial W4): a legacy id-less subscription with a channelUrl is MINTED at the import seam, never a refusal
  features.length = 0;
  importParsedJson({ ytdlp: { subscriptions: [{ channelUrl: 'https://YouTube.com/@Legacy', name: 'L' }] } }, h);
  assert.strictEqual(features[0][1].subscriptions[0].id, require('node:crypto').createHash('md5').update(ytdlpStore.normalizeChannelUrl('https://YouTube.com/@Legacy')).digest('hex'), 'minted like the v31 block');
});

test('exclusiveReplace: wipes all five tables (the flag included), repopulates through replaceFeature inside its transaction, rolls back whole on a bad row', () => {
  const ytdlp = ytdlpStore.createYtdlpStore(adapter);
  ytdlp.replaceAll({ allowMembersOnly: true, subscriptions: [sub('old')], downloadMeta: { old: { a: 1 } }, pins: [pin('old')], channelAvatars: { UCold: { avatarUrl: 'https://yt3.ggpht.com/o.jpg' } } });
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual(ytdlp.read(), EMPTY, 'restore = the bundle and nothing else - the flag falls back to its default');
  adapter.exclusiveReplace((h) => { h.replaceFeature('ytdlp', { subscriptions: [sub('b'), sub('a')], allowMembersOnly: true }); });
  assert.deepStrictEqual(ytdlp.read(), { ...EMPTY, subscriptions: [sub('b'), sub('a')], allowMembersOnly: true });
  assert.throws(() => adapter.exclusiveReplace((h) => { h.replaceFeature('ytdlp', { pins: [{ noId: true }] }); }), /non-empty string id/);
  assert.deepStrictEqual(ytdlp.read().subscriptions, [sub('b'), sub('a')], 'rolled back whole');
});

test('readPersistedDatabase: surfaces `ytdlp` in its container shape when any part has rows OR the flag is set; never the internal `settings` key', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const ytdlp = ytdlpStore.createYtdlpStore(adapter);
  ytdlp.replaceAll({ allowMembersOnly: true });
  assert.deepStrictEqual(readPersistedDatabase(dir), { ytdlp: { ...EMPTY, allowMembersOnly: true } }, 'a set flag alone is state worth surfacing (a db.json round-trip must keep it)');
  ytdlp.replaceAll({ allowMembersOnly: false });
  assert.deepStrictEqual(readPersistedDatabase(dir), { ytdlp: { ...EMPTY } }, 'an explicitly-written default is still a row');
  ytdlp.replaceAll(null);
  assert.deepStrictEqual(readPersistedDatabase(dir), {}, 'nothing written = absent');
});

test('mutate: the module\'s own writers run on the holder and the value part writes ONLY when it changes; a `false` return writes nothing', () => {
  const ytdlp = ytdlpStore.createYtdlpStore(adapter);
  const writes = [];
  const spied = ytdlpStore.createYtdlpStore(adapter, { inSaveTransaction: (fn) => writes.push(fn()) });
  spied.mutate((h) => { const ns = ytdlpStore.ensureYtdlp(h); ns.subscriptions.push(sub('s1')); ytdlpStore.ensureYtdlp(h); return true; }); // (normalised once, so the next tick's ensureYtdlp is a no-op)
  assert.deepStrictEqual(writes, [{ rowsWritten: 1, rowsDeleted: 0 }], 'ensureYtdlp\'s allowMembersOnly=false default is NOT a write (an unset value IS its default)');
  assert.deepStrictEqual(ytdlp.read().subscriptions.map((s) => s.id), ['s1']);
  assert.strictEqual(adapter.sql.prepare('SELECT COUNT(*) AS c FROM ytdlp_settings').get().c, 0, 'no settings row for a default');
  spied.mutate((h) => { ytdlpStore.ensureYtdlp(h).allowMembersOnly = true; return true; });
  assert.deepStrictEqual(writes[1], { rowsWritten: 1, rowsDeleted: 0 }, 'the flag flip is one row');
  assert.strictEqual(ytdlp.read().allowMembersOnly, true);
  assert.strictEqual(spied.mutate(() => false), false, 'the skip contract');
  assert.strictEqual(writes.length, 2);
  spied.mutate((h) => { const ns = ytdlpStore.ensureYtdlp(h); ns.downloadMeta.v1 = { channelUrl: 'https://www.youtube.com/@x' }; delete ns.downloadMeta.v1; return true; });
  assert.deepStrictEqual(writes[2], { rowsWritten: 0, rowsDeleted: 0 }, 'a consumed-in-the-same-tick capture is a zero diff');
});

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: the route surface never names the ytdlp tables or the dead doc spellings in CODE; the reads take the store; the scan consumes the bridge on a holder and queues its diff into the commit; the module writes ONLY through ytdlpDb.mutate', () => {
  // Wave 7b (the monolith split, slice S1a): the notification and history
  // routes took their per-request `ytdlpDb.holder(...)` reads with them. The
  // lock reads the whole ROUTE SURFACE - server.js plus every registerRoutes
  // module it registers, derived from server.js's own requires - so the counts
  // follow the code and the never-name-the-table checks now cover the modules.
  const surface = routeSurfaceSource((p) => stripComments(fs.readFileSync(p, 'utf8')));
  for (const t of TABLES) assert.ok(!surface.includes(t), t);
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|mdb|loaded|persisted|snapshot|handoffDb|srcMeta|dbSnapshot|getCachedDatabase\(\)|loadDatabase\(\))\.ytdlp\b/.test(surface), 'no doc-model ytdlp access survives');
  assert.ok(!/ytdlp\.ensureYtdlp\(|ytdlp\.readYtdlpNamespace\(/.test(surface), 'server.js never normalises the namespace itself');
  assert.ok((surface.match(/ytdlpDb\.readPart\('subscriptions'\)/g) || []).length >= 6, 'the subscription-name reads');
  assert.ok((surface.match(/ytdlpDb\.holder\(/g) || []).length >= 11, 'the per-request holders (avatar resolver, relocation joins, the scan)');
  assert.ok(/bundle\.ytdlp = ytdlpDb\.read\(\)/.test(surface), 'the bundle reads the tables');
  // Wave 7b (S1a, then S1b): 11 across the surface - server.js's seven (the
  // user-state, notification, identity and Liked deps bundles, lib/ytdlp's
  // registerRoutes bundle, startBackground, the export) and the four
  // destructures that receive them in lib/user/routes.js,
  // lib/notifications/routes.js, lib/auth/routes.js (S1b: POST
  // /api/auth/setup adopts the frozen pre-auth channel pins) and
  // lib/media/user-routes.js (S1b: GET /api/liked's avatar holder). Still an
  // EXACT count: a new crossing has to be a deliberate edit here, not a
  // silent one. Wave 7b (slice S10a) took it from 11 to 15: the browse routes
  // (GET /api/videos + GET /api/channels, the subscription-derived channel
  // identity) and the attribution cluster moved to lib/media/routes.js, so
  // their two call sites in server.js and the two destructures that receive
  // them there are four new crossings of the SAME store. Wave 7b (R3) merged two
  // slices at once: slice S6 moved the import-relocation planners to
  // lib/ytdlp/relocation.js (planImportRelocation's subscription holder and the
  // executor's channelId backfill) - the factory call site's dep entry in
  // server.js plus the module's destructure, two more; and slice S7 moved the
  // backup bundle's `ytdlpDb.read()` (asserted above) to lib/admin/backup.js -
  // server.js's one new deps-bundle entry plus the one destructure there, two
  // more. 15 -> 19 re-measured on the merged tree (each slice was 15 -> 17 in
  // isolation), all crossings of the SAME store, no new store anywhere. Wave 7b
  // (slice S9) moved the scan orchestrator (runScanDirectories) to
  // lib/scan/orchestrator.js, which joins the surface via the marker sentence:
  // the factory hands it ytdlpDb (server.js's new deps-object entry plus the
  // module's own destructure), one net new crossing of the SAME store, so
  // 19 -> 20. The scan's per-request `ytdlpDb.holder(...)` read rode along into
  // the same surface, so the holder count below stays 12.
  assert.strictEqual((surface.match(/\bytdlpDb,/g) || []).length, 20, 'every crossing carries the store, never the doc namespace');
  assert.strictEqual((surface.match(/ytdlp\.consumeDownloadChannelMeta\(ytScan, /g) || []).length, 2, 'both YouTube consume sites run on the scan holder');
  assert.strictEqual((surface.match(/ytdlp\.consumeUniversalDownloadMeta\(ytScan, /g) || []).length, 1);
  assert.strictEqual((surface.match(/ytdlp\.backfillChannelIdentityFromFolder\(ytScan, /g) || []).length, 1);
  assert.ok(/inSaveTransaction\(\(\) => ytdlpDb\.syncFrom\(ytScan\.ytdlp\)\)/.test(surface), 'the consumed entries ride the scan commit');
  assert.strictEqual((surface.match(/ytdlpDb\.mutate\(\(yh\) => refreshPinLabelsForBackfilledChannel\(db, /g) || []).length, 2, 'both fanout writers relabel the pins through a nested feature mutate (items from the doc, pins from the holder)');
  assert.ok(!/const dbForLookup = /.test(surface), 'the deep-clone dance is gone (a holder is a fresh snapshot)');
  assert.ok(!/podcastsDb\.read\(\)\.episodes\[|const ns = podcastsDb\.read\(\);\n\s*const ep = /.test(surface), 'gate pass B: no per-item whole-table read of the episodes map is left (point queries)');
  assert.ok((surface.match(/podcastsDb\.parts\.episodes\.get\(/g) || []).length >= 5 && (surface.match(/musicDb\.parts\.tracks\.get\(/g) || []).length >= 4 && (surface.match(/booksDb\.parts\.(items|audio)\.get\(/g) || []).length >= 6, 'the single-lookup sites are point queries');
  const lib = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'store.js'), 'utf8'));
  assert.strictEqual((lib.match(/deps\.updateDatabase\(/g) || []).length, 13, 'the store module\'s 13 writers');
  assert.strictEqual((lib.match(/deps\.updateDatabase\(\(\) => deps\.ytdlpDb\.mutate\(\(db\) =>/g) || []).length, 13, 'every one of them runs on the holder');
  assert.ok(!/deps\.loadDatabase\(\)/.test(lib), 'no doc read left in the store module');
  assert.strictEqual((lib.match(/deps\.ytdlpDb\.holder\(/g) || []).length, 3, 'listSubscriptions / getAllowMembersOnly / listPins read the snapshot');
  const index = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'index.js'), 'utf8'));
  assert.ok(!/store\.ensureYtdlp\(deps\.loadDatabase\(\)\)|findSubscriptionForChannel\(deps\.loadDatabase\(\)/.test(index), 'no namespace read over the doc object');
  assert.ok((index.match(/ytdlpHolder\(deps/g) || []).length >= 4 && (index.match(/withYtdlp\(deps, deps\.loadDatabase\(\)\)/g) || []).length >= 3, 'the holder / view helpers carry the reads');
});
