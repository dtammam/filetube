'use strict';

// [UNIT] v1.42 T1 — the SQLite persistence adapter (lib/db/sqlite.js).
//
// Adapter-level coverage for the exec plan's storage contract, ahead of the
// server.js seam swap (T2):
//   - schema creation incl. the v1.43/44 user tables born complete (empty)
//   - load/save round-trip fidelity (singletons + doc_kv namespaces)
//   - diff-save write granularity, verified via a SECOND read-only
//     connection (AC5's "not via the adapter's own accounting")
//   - absent-vs-empty namespace semantics (absent = not ensured, keep rows;
//     empty = deliberate wipe, delete rows)
//   - the unknown-key persistence lock (silent row-drop is the persist-gate
//     class; the adapter must throw instead)
//   - the bundle classifier through the restore seam (Wave 7: the one
//     import seam left): fidelity, the viewCounts extraction transform
//     (AC1), legacy-shape input (review F3), lossy-import refusal with the
//     wipe rolled back
//   - openAdapter (Wave 7): use-or-create, a legacy file never read
//   - exclusiveReplace (restore): rollback-on-throw + snapshot rebuild

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SQLITE_FILENAME,
  SqliteAdapter,
  openAdapter,
  importParsedJson,
  readPersistedDatabase,
  SCHEMA_VERSION,
} = require('../../lib/db/sqlite');
const podcastStore = require('../../lib/podcasts/store');
const { ensureLegacyDocTables } = require('../helpers/legacy-doc-tables');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sqlite-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const dbPath = () => path.join(dir, SQLITE_FILENAME);
const jsonPath = () => path.join(dir, 'db.json');

// A realistic full-shape doc-object fixture: prod-shaped top-level keys plus
// the newer namespaces, with viewCount embedded on items exactly where the
// import must extract it from.
function fullFixture() {
  return {
    // (folders / folderSettings / folderDisplayNames: relational since Wave 4 - see importFixture)
    // (progress / deleteTombstones: relational since Wave 2 - see importFixture)
    metadata: {
      vid1: { id: 'vid1', name: 'clip.mp4', title: 'Clip', filePath: '/media/videos/clip.mp4', viewCount: 7, chaptersManual: [{ t: 0, title: 'Intro' }] },
      vid2: { id: 'vid2', name: 'song.mp3', title: 'Song', filePath: '/media/music/song.mp3' },
      vid3: { id: 'vid3', name: 'zero.mp4', title: 'Zero views', viewCount: 0 },
    },
    // (settings / liked: relational since Wave 4 - see importFixture)
    // (books / music / podcasts / ytdlp: relational since Wave 5 - see importFixture)
  };
}

// The IMPORT-side fixture: a bundle (or, until v1.295, a legacy file) also carries the
// namespaces that are relational tables since Waves 1-2 (progress and
// deleteTombstones as first-class keys; viewCount embedded on items). The
// importer routes them to their tables and readPersistedDatabase surfaces
// them under the same keys, so the fidelity deep-equal below still holds.
function importFixture() {
  return {
    ...fullFixture(),
    settings: { defaultView: 'grid', defaultSort: 'newest', customLogoMime: 'image/png' }, // Wave 4: one row per key
    liked: ['vid1'], // Wave 4: an ordered list (the frozen pre-auth likes)
    folders: ['/media/videos', '/media/music'], // Wave 4: an ordered list
    ytdlp: { // Wave 5: a feature container (the tables) - the LAST container to leave the doc model
      allowMembersOnly: true,
      subscriptions: [{ id: 'sub1', channelUrl: 'https://youtube.com/@x', name: 'X', paused: false, order: 0 }],
      downloadMeta: { yt1: { channelName: 'X', capturedAt: 1752600000000 }, 'reddit abc123': { universal: true } },
      pins: [{ id: 'pin1', channelDir: '/media/videos/X', label: 'X', pinnedAt: 't', order: 0 }],
      channelAvatars: { UC123: { avatarUrl: 'https://a/b.jpg', fetchedAt: 1752600000000 } },
    },
    podcasts: { // Wave 5: a feature container (the tables); no feed URLs, ever
      subscriptions: [{ id: 'psub1', name: 'Show', feedUrlDisplay: 'https://x.example/rss', feedHost: 'x.example', order: 1, paused: false, backfill: 'all' }],
      episodes: { pep1: { id: 'pep1', subId: 'psub1', guid: 'g1', title: 'One', status: 'downloaded' } },
      settings: { pollMinutes: 45 },
    },
    books: { // Wave 5: a feature container (the tables)
      folders: ['/media/books'],
      items: { bk1: { id: 'bk1', title: 'A Book', filePath: '/media/books/a.epub' } },
      progress: { bk1: { spineIndex: 3, offset: 0.5 } },
      pins: [{ id: 'pin1', dir: '/media/books', label: 'Shelf', order: 0 }],
      settings: {},
      audio: { bk1: { 0: { status: 'ready', key: 'k0' } } },
    },
    music: { // Wave 5: a feature container (the tables)
      folders: ['/media/tunes'],
      tracks: { trk1: { id: 'trk1', title: 'Song One', artist: 'A', album: 'Debut', filePath: '/media/tunes/A/Debut/01 Song One.flac', rootFolder: '/media/tunes' } },
      settings: {},
      // Wave G: per-folder "show in Music" marks (singleton, folderName-keyed,
      // like folderDisplayNames). Exercised through the round-trip + every
      // upgrade test (both consume this fixture) - proving the namespace is
      // registered and save()/load() preserve it byte-equal.
      channels: { NESTALGIA: 'on', Zarchivo: 'off' },
    },
    folderSettings: { '/media/videos': { name: 'Videos', hidden: false } },
    // v1.126/v1.127: the per-channel-folder display-name map (the namespace
    // whose missing fixture coverage external review round 2 flagged).
    folderDisplayNames: { NESTALGIA: 'Nestalgia Music' },
    progress: { vid1: 42.5, vid2: 918 },
    deleteTombstones: { gone1: { filePath: '/media/videos/gone.mp4', deletedAt: 1752600000000, youtubeId: 'abc123def45' } },
  };
}

test('fresh open creates the full v1 schema with empty user tables', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.deepStrictEqual(a.load(), {}, 'fresh DB assembles to an empty object');
    for (const table of ['users', 'user_progress', 'user_liked', 'user_book_progress', 'user_book_pins', 'user_channel_pins',
      // v1.44 schema v3: the three per-user music tables, born empty.
      'user_music_liked', 'user_music_progress', 'user_music_state',
      // v1.50 schema v4: the per-user watched latch, born empty.
      'user_watched',
      // v1.51 schema v5: the notification feed + per-user seen/read state.
      'notifications', 'user_notification_state', 'user_notification_reads',
      // v1.63 schema v6: the per-user playback queue + pointer state.
      'user_queue', 'user_queue_state',
      // v1.66 schema v7: push subscriptions. v1.68 schema v8: per-user
      // notification dismissals. (QA gate: this born-complete list had
      // rotted - the v1.64 hand-enumerated-list class - missing v7's table
      // and about to miss v8's.)
      'push_subscriptions', 'user_notification_dismissals',
      // v1.69 schema v9: per-user podcast resume + played latch.
      'user_podcast_progress', 'user_podcast_played',
      // The list had ROTTED again (the v1.64/v1.66 hand-enumerated-list class,
      // adversarial gate v1.85): these existing tables were never added here.
      // v1.71 podcast likes/pins; v1.37 book likes/finished; v1.80 restrictions.
      'user_podcast_liked', 'user_podcast_pins', 'user_book_liked', 'user_book_finished', 'user_restrictions',
      // v1.85 schema v16: per-user search history, born empty.
      'user_search_history',
      // v1.97 schema v17: per-user "Hide from feed" prune, born empty.
      'user_feed_hidden']) {
      const { c } = a.sql.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
      assert.strictEqual(c, 0, `${table} exists and is empty (born-complete schema, exec plan)`);
    }
    assert.strictEqual(a.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    // v1.43 schema v2: users.id is AUTOINCREMENT (never reuses a reaped id —
    // design-delta SUGGESTION-6). sqlite_autoindex/sqlite_sequence presence
    // is the fingerprint.
    const usersSql = a.sql.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
    assert.match(usersSql, /AUTOINCREMENT/, 'users.id is AUTOINCREMENT');
  } finally {
    a.close();
  }
});

test('v3 -> v4 upgrade: an existing populated schema gains the empty user_watched table and loses nothing', () => {
  // Simulate a v1.44-v1.49 instance: full schema, then rewind the version
  // stamp and drop the v4 table, as if v4 never ran.
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  a.save(fullFixtureForUpgrade());
  a.sql.exec('DROP TABLE user_watched');
  a.sql.exec('PRAGMA user_version = 3');
  a.close();

  const b = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.strictEqual(b.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'forward-only migration ran (to the CURRENT version)');
    assert.strictEqual(b.sql.prepare('SELECT COUNT(*) AS c FROM user_watched').get().c, 0, 'latch table born empty');
    // v1.51 schema v5 rides the same forward run.
    assert.strictEqual(b.sql.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, 0, 'notification feed born empty');
    // v1.63 schema v6 rides it too.
    assert.strictEqual(b.sql.prepare('SELECT COUNT(*) AS c FROM user_queue').get().c, 0, 'queue born empty');
    assert.deepStrictEqual(b.load(), fullFixtureForUpgrade(), 'every pre-existing namespace survives the migration untouched');
  } finally {
    b.close();
  }
});

test('v14 -> v15 upgrade: an existing populated users table gains can_modify_library DEFAULT 0, losing no rows', () => {
  // Simulate a v1.80 instance (schema v14): a users table WITHOUT the v15
  // column, populated, then rewind the version stamp as if v15 never ran.
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  a.sql.exec("INSERT INTO users (username, display_name, password_hash, role, can_manage_subscriptions, settings_json, token_version, disabled, created_at) VALUES ('dean', 'Dean', 'h', 'admin', 1, '{}', 0, 0, '2026-08-01T00:00:00.000Z')");
  a.sql.exec("INSERT INTO users (username, display_name, password_hash, role, can_manage_subscriptions, settings_json, token_version, disabled, created_at) VALUES ('kid', 'Kid', 'h', 'member', 0, '{}', 0, 0, '2026-08-01T00:00:00.000Z')");
  a.sql.exec('ALTER TABLE users DROP COLUMN can_modify_library'); // as if the column never existed (v14 shape)
  a.sql.exec('PRAGMA user_version = 14');
  a.close();

  const b = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.strictEqual(b.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'forward-only migration ran');
    const hasCol = b.sql.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'can_modify_library'").get().n;
    assert.strictEqual(hasCol, 1, 'the ALTER added the column');
    // Every pre-existing row defaults to 0 (OFF) — existing members lose
    // destructive actions until an admin grants it (Dean-approved).
    const rows = b.sql.prepare('SELECT username, can_modify_library FROM users ORDER BY username').all()
      .map((r) => ({ username: r.username, can_modify_library: r.can_modify_library }));
    assert.deepStrictEqual(rows, [
      { username: 'dean', can_modify_library: 0 },
      { username: 'kid', can_modify_library: 0 },
    ], 'both rows survive; the new column defaults to 0');
  } finally {
    b.close();
  }
});

test('v15 -> v16 upgrade: an existing populated db gains the empty user_search_history table, losing no rows', () => {
  // Simulate a v1.84 instance (schema v15): full schema, then rewind the stamp
  // and drop the v16 table, as if v16 never ran.
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  a.save(fullFixtureForUpgrade());
  a.sql.exec('DROP TABLE user_search_history');
  a.sql.exec('PRAGMA user_version = 15');
  a.close();

  const b = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.strictEqual(b.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'forward-only migration ran');
    assert.strictEqual(b.sql.prepare('SELECT COUNT(*) AS c FROM user_search_history').get().c, 0, 'search-history table born empty');
    // its shape: (user_id, term, searched_at, PK(user_id, term))
    const cols = b.sql.prepare("SELECT name FROM pragma_table_info('user_search_history') ORDER BY name").all().map((r) => r.name);
    assert.deepStrictEqual(cols, ['searched_at', 'term', 'user_id']);
    assert.deepStrictEqual(b.load(), fullFixtureForUpgrade(), 'every pre-existing namespace survives untouched');
  } finally {
    b.close();
  }
});

test('v16 -> v17 upgrade: an existing populated db gains the empty user_feed_hidden table, losing no rows', () => {
  // Simulate a v1.85-v1.96 instance (schema v16): full schema, then rewind the
  // stamp and drop the v17 table, as if v17 never ran.
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  a.save(fullFixtureForUpgrade());
  a.sql.exec('DROP TABLE user_feed_hidden');
  a.sql.exec('PRAGMA user_version = 16');
  a.close();

  const b = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.strictEqual(b.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'forward-only migration ran');
    assert.strictEqual(b.sql.prepare('SELECT COUNT(*) AS c FROM user_feed_hidden').get().c, 0, 'feed-hidden table born empty');
    // its shape: (user_id, media_id, hidden_at, PK(user_id, media_id)) -- mirrors user_liked
    const cols = b.sql.prepare("SELECT name FROM pragma_table_info('user_feed_hidden') ORDER BY name").all().map((r) => r.name);
    assert.deepStrictEqual(cols, ['hidden_at', 'media_id', 'user_id']);
    assert.deepStrictEqual(b.load(), fullFixtureForUpgrade(), 'every pre-existing namespace survives untouched');
  } finally {
    b.close();
  }
});

// The round-trip fixture minus the importer-transform fields (same shape the
// round-trip test below saves).
function fullFixtureForUpgrade() {
  const db = fullFixture();
  delete db.metadata.vid1.viewCount;
  delete db.metadata.vid3.viewCount;
  return db;
}

test('save/load round-trip preserves every namespace across a re-open', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  const db = fullFixture();
  delete db.metadata.vid1.viewCount; // adapter-level test: viewCount extraction is the IMPORTER's transform
  delete db.metadata.vid3.viewCount;
  a.save(db);
  a.close();

  const b = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.deepStrictEqual(b.load(), db, 'assembled object survives close/re-open byte-equal');
  } finally {
    b.close();
  }
});

test('diff-save writes exactly the changed row (verified via a second read-only connection)', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    const db = fullFixture();
    delete db.metadata.vid1.viewCount;
    delete db.metadata.vid3.viewCount;
    a.save(db);

    const before = readPersistedDatabase(dir);

    const db2 = a.load();
    db2.metadata.vid2.title = 'Song (remaster)';
    const stats = a.save(db2);
    assert.deepStrictEqual(stats, { rowsWritten: 1, rowsDeleted: 0 }, 'one-item mutation = one row written');

    const after = readPersistedDatabase(dir);
    assert.strictEqual(after.metadata.vid2.title, 'Song (remaster)');
    // Everything except the mutated item is byte-identical.
    before.metadata.vid2 = after.metadata.vid2;
    assert.deepStrictEqual(after, before, 'no other row changed');
  } finally {
    a.close();
  }
});

test('a no-change save touches zero rows', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    const db = fullFixture();
    delete db.metadata.vid1.viewCount;
    delete db.metadata.vid3.viewCount;
    a.save(db);
    const stats = a.save(a.load());
    assert.deepStrictEqual(stats, { rowsWritten: 0, rowsDeleted: 0 });
  } finally {
    a.close();
  }
});

test('deleting a key deletes its row; absent namespace keeps rows; empty namespace wipes them', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    const db = fullFixture();
    delete db.metadata.vid1.viewCount;
    delete db.metadata.vid3.viewCount;
    a.save(db);

    // key delete
    const db2 = a.load();
    delete db2.metadata.vid3;
    const s2 = a.save(db2);
    assert.deepStrictEqual(s2, { rowsWritten: 0, rowsDeleted: 1 });
    assert.strictEqual(readPersistedDatabase(dir).metadata.vid3, undefined);

    // absent namespace: a mutator tick that never touched the namespace must
    // not delete its rows (absence = "not loaded", not "deleted"). (books,
    // then ytdlp, carried this case until Wave 5 moved them to their tables;
    // `metadata` - the media index - is the one key left on the object.)
    const db3 = a.load();
    delete db3.metadata;
    const s3 = a.save(db3);
    assert.deepStrictEqual(s3, { rowsWritten: 0, rowsDeleted: 0 });
    assert.ok(readPersistedDatabase(dir).metadata.vid1, 'metadata rows survive an absent-namespace save');

    // present-but-empty: a deliberate wipe deletes rows. NOTE the documented
    // normalization: an EMPTY index has zero rows, so it assembles
    // as ABSENT — indistinguishable from never-ensured. That is safe because
    // server.js's load-time backfills (top-level keys) and the lazy ensure*
    // creators (books/ytdlp) re-supply `{}` before any consumer touches it,
    // making the post-load object identical either way.
    // (Wave 2: deleteTombstones is relational; Wave 5: so is ytdlp - the
    // two media items left play the namespace here.)
    const db4 = a.load();
    db4.metadata = {};
    const s4 = a.save(db4);
    assert.deepStrictEqual(s4, { rowsWritten: 0, rowsDeleted: 2 });
    assert.strictEqual(readPersistedDatabase(dir).metadata, undefined,
      'empty kv namespace normalizes to absent at the adapter layer (backfill restores {} at load)');
  } finally {
    a.close();
  }
});

test('unknown keys throw instead of being silently dropped (top-level and container sub-key)', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.throws(() => a.save({ metadata: {}, mystery: {} }), /unknown top-level db key 'mystery'/);
    assert.throws(() => a.save({ podcasts: { subscriptions: [] } }), /unknown top-level db key 'podcasts'/, 'Wave 5: the podcasts container left the lock');
    assert.throws(() => a.save({ ytdlp: { subscriptions: [] } }), /unknown top-level db key 'ytdlp'/, 'Wave 5: the last container left the lock - no sub-key walk is left');
  } finally {
    a.close();
  }
});

test('Wave 5: the podcasts namespace round-trips through its feature store (ordered subscriptions + per-episode rows + settings)', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    const ns = {
      subscriptions: [
        { id: 'p2', name: 'Second', feedUrlDisplay: 'https://y.example/rss', feedHost: 'y.example', order: 2, paused: false, backfill: 'all' },
        { id: 'p1', name: 'Show', feedUrlDisplay: 'https://x.example/rss', feedHost: 'x.example', order: 1, paused: false, backfill: 'all' },
      ],
      episodes: {
        ep1: { id: 'ep1', subId: 'p1', guid: 'g1', title: 'One', status: 'downloaded' },
        ep2: { id: 'ep2', subId: 'p1', guid: 'g2', title: 'Two', status: 'pending' },
      },
      settings: { pollMinutes: 60 },
    };
    podcastStore.createPodcastsStore(a).replaceAll(ns);
    const back = readPersistedDatabase(dir);
    assert.deepStrictEqual(back.podcasts, ns, 'verbatim, the array ORDER included (position column, not a sort)');
  } finally {
    a.close();
  }
});

test('save: a MID-TRANSACTION statement failure rolls back every row of that save (snapshot not advanced)', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    const db = fullFixture();
    delete db.metadata.vid1.viewCount;
    delete db.metadata.vid3.viewCount;
    a.save(db);
    const before = readPersistedDatabase(dir);

    // Stub the kv upsert so it fails on the SECOND row of the same save -
    // the first row has already executed inside the open transaction, and
    // the rollback must discard it too; the diff snapshot must not advance.
    // (Until Wave 5 a doc_single write played the "row before the poison";
    // two media items carry the lesson since.)
    // (Wave 6: the metadata rows are media_items; the items store's upsert is
    // the statement the diff runs - stub it through the store's own seam.)
    const itemStmts = a.items.__diffStmts;
    const realUpsert = itemStmts.upsertJson;
    let upserts = 0;
    itemStmts.upsertJson = { run: (...args) => { if (++upserts === 2) throw new Error('simulated statement failure'); return realUpsert.run(...args); } };
    const db2 = a.load();
    db2.metadata.vid1.title = 'never'; // the row before the poison
    db2.metadata.vid2.title = 'never'; // the poison
    try {
      assert.throws(() => a.save(db2), /simulated statement failure/);
    } finally {
      itemStmts.upsertJson = realUpsert;
    }

    assert.deepStrictEqual(readPersistedDatabase(dir), before,
      'EVERY row of the failed transaction rolled back — including the row written before the poison');

    // Snapshot must still reflect disk: the same change saved cleanly now
    // must write BOTH rows (had the snapshot advanced, the diff would skip them).
    const db3 = a.load();
    db3.metadata.vid1.title = 'never';
    db3.metadata.vid2.title = 'never';
    const stats = a.save(db3);
    assert.deepStrictEqual(stats, { rowsWritten: 2, rowsDeleted: 0 });
  } finally {
    a.close();
  }
});

test('save: SPACED keys round-trip and delete correctly; NUL-bearing keys are REFUSED (the snapshot-separator lock)', () => {
  // Two lessons locked at once:
  // 1. Universal downloadMeta keys are '<extractor> <id>' — WITH a space. A
  //    space-separated snapshot key truncated these in the delete-sweep
  //    (wrong row targeted; the real row survived on disk and RESURRECTED on
  //    the next load). The separator is U+0000 now — spaced keys must
  //    round-trip and delete exactly.
  // 2. node:sqlite READS a NUL-bearing TEXT back truncated on Node 24.14 and
  //    older (verbatim from 24.20 - tech-debt #225; the bind stores the bytes
  //    on every version), so such a key would read back as a colliding
  //    prefix — the adapter must REFUSE it loudly.
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    // (Wave 5: ytdlp.downloadMeta - the namespace whose keys carry spaces - is
    // a feature-store table now; `metadata` is the one key left, and the
    // separator lesson is the ADAPTER's, so media ids carry it.)
    a.save({
      metadata: { 'reddit abc123': { universal: true }, plain: { p: 1 } },
    });
    assert.deepStrictEqual(
      Object.keys(readPersistedDatabase(dir).metadata).sort(),
      ['plain', 'reddit abc123'],
      'the spaced key persisted as its own distinct row'
    );

    const db = a.load();
    delete db.metadata['reddit abc123'];
    const stats = a.save(db);
    assert.deepStrictEqual(stats, { rowsWritten: 0, rowsDeleted: 1 });
    assert.deepStrictEqual(Object.keys(readPersistedDatabase(dir).metadata), ['plain'],
      'exactly the right row deleted — no truncated-key mistargeting');
    assert.deepStrictEqual(Object.keys(a.load().metadata), ['plain'],
      'and the next load agrees (no resurrect)');

    // NUL-bearing key (escape sequence, per the source-hygiene lock):
    // refused loudly, nothing persisted from the save.
    const db2 = a.load();
    db2.metadata['evil\u0000key'] = { h: 1 };
    assert.throws(() => a.save(db2), /contains U\+0000.*truncated on Node 24\.14/s); // (#225: the message states the measured read-side premise)
    assert.deepStrictEqual(Object.keys(readPersistedDatabase(dir).metadata), ['plain'],
      'the refused save persisted nothing');
  } finally {
    a.close();
  }
});

// Wave 7: the ONE import seam left is the bundle restore - the classifier
// runs inside exclusiveReplace's transaction exactly as server.js's restore
// route wires it (a refusal rolls the wipe back). Until v1.295 the same
// classifier also served the one-time boot import of a legacy db.json.
function restoreInto(a, parsed) {
  let summary;
  a.exclusiveReplace((handles) => { summary = importParsedJson(parsed, handles, { source: 'bundle' }); });
  return summary;
}

test('a __proto__ row key round-trips as INERT OWN DATA — no prototype pollution, no silent row loss (gate CRITICAL)', () => {
  // JSON.parse materializes '__proto__' as an own key; plain-assignment
  // assembly would turn it into a prototype WRITE (row vanishes from
  // Object.keys; misses on the namespace return planted fields). Assembly
  // uses defineProperty, so it stays plain data.
  // Splice the hostile key into the JSON TEXT directly — JSON.stringify
  // would drop a '__proto__' own-key from an ordinary object, but
  // JSON.parse (a bundle's reader) happily materializes one.
  const parsed = JSON.parse(JSON.stringify(fullFixture()).replace('"metadata":{', '"metadata":{"__proto__":{"id":"planted","polluted":true},'));
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    restoreInto(a, parsed);
    const db = readPersistedDatabase(dir);
    assert.ok(Object.prototype.hasOwnProperty.call(db.metadata, '__proto__'), 'the hostile key survives as an OWN key (no silent loss)');
    assert.equal(db.metadata['__proto__'].id, 'planted', 'readable as plain data');
    assert.equal(Object.getPrototypeOf(db.metadata).polluted, undefined, 'namespace prototype NOT polluted');
    assert.equal(({}).polluted, undefined, 'global Object.prototype NOT polluted');
    assert.equal(db.metadata.someMissingId, undefined, 'a miss returns undefined, never planted fields');
    // And the adapter's own load() (the app path) is equally safe.
    const loaded = a.load();
    assert.ok(Object.prototype.hasOwnProperty.call(loaded.metadata, '__proto__'));
    assert.equal(({}).polluted, undefined, 'still clean after load()');
  } finally {
    a.close();
  }
});

test('restore: a bundle with a NUL-bearing media id is refused loudly and the wipe rolls back (no silent key corruption)', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    a.save({ metadata: { kept: { id: 'kept' } } });
    const fixture = fullFixture();
    fixture.metadata[`bad${String.fromCharCode(0)}id`] = { id: 'bad' };
    assert.throws(() => restoreInto(a, fixture), /contains U\+0000/);
    assert.deepStrictEqual(readPersistedDatabase(dir).metadata, { kept: { id: 'kept' } }, 'the refusal rolled the wipe back - the prior rows survive');
  } finally {
    a.close();
  }
});

test('save: an undefined value is dropped silently — matching JSON.stringify\'s legacy-file semantics', () => {
  // Pre-v1.42, JSON.stringify(db) simply OMITTED keys whose value was
  // undefined; the diff-save preserves that exact behavior (stringify yields
  // undefined on both sides of the compare, so no row is written). Locked
  // here so a future refactor doesn't accidentally turn it into a NOT NULL
  // crash or a literal "undefined" string row.
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    a.save({ metadata: { real: { id: 'real' }, ghost: undefined } });
    assert.deepStrictEqual(readPersistedDatabase(dir).metadata, { real: { id: 'real' } });
  } finally {
    a.close();
  }
});

test('re-entrant transaction guard throws the adapter error, not SQLite\'s', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    a.begin();
    assert.throws(() => a.begin(), /re-entrant transaction/);
    a.rollback();
  } finally {
    a.close();
  }
});

test('restore: bundle fidelity through the classifier - the viewCounts extraction is the one transform (AC1 shape)', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    const summary = restoreInto(a, importFixture());
    assert.strictEqual(summary.metadata, 3);
    assert.strictEqual(summary.viewCounts, 1, 'vid1 extracted; vid3\'s viewCount:0 is dropped (missing reads as 0)');
    const db = readPersistedDatabase(dir);
    const expected = importFixture();
    delete expected.metadata.vid1.viewCount;
    delete expected.metadata.vid3.viewCount;
    expected.viewCounts = { vid1: 7 };
    assert.deepStrictEqual(db, expected, 'deep-equal modulo the documented viewCounts transform');
    assert.strictEqual(db.metadata.vid1.viewCount, undefined, 'items carry no viewCount');
    assert.deepStrictEqual(db.metadata.vid1.chaptersManual, [{ t: 0, title: 'Intro' }], 'user data on items lands verbatim');
    assert.ok(db.deleteTombstones.gone1, 'deleteTombstones lands (drift correction #1)');
  } finally {
    a.close();
  }
});

test('restore: a legacy-shape source (no liked/deleteTombstones/books/ytdlp - a pre-v1.42 export) assembles to the same partial object', () => {
  const legacy = {
    folders: ['/media/videos'],
    folderSettings: {},
    progress: { vid1: 10 },
    metadata: { vid1: { id: 'vid1', name: 'clip.mp4' } },
    settings: { defaultView: 'grid' },
  };
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    restoreInto(a, legacy);
    const db = readPersistedDatabase(dir);
    const expected = { ...legacy };
    delete expected.folderSettings; // Wave 4: an empty map has no rows (surfaced only when rows exist)
    assert.deepStrictEqual(db, expected, 'raw import: no invented keys — backfill stays load-time-owned (review F3)');
    assert.strictEqual(db.liked, undefined);
    assert.strictEqual(db.books, undefined);
  } finally {
    a.close();
  }
});

test('restore: an unknown top-level key refuses a lossy import and the wipe rolls back', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    a.save({ metadata: { kept: { id: 'kept' } } });
    const withUnknown = { ...fullFixture(), futureFeature: { x: 1 } };
    assert.throws(() => restoreInto(a, withUnknown), /unknown top-level key 'futureFeature'.*newer FileTube/s);
    assert.deepStrictEqual(readPersistedDatabase(dir).metadata, { kept: { id: 'kept' } }, 'nothing was wiped');
  } finally {
    a.close();
  }
});

test('openAdapter (Wave 7): an existing database is used as-is; a missing one is created fresh; a legacy JSON file beside either is never read and never changes the outcome', () => {
  const GARBAGE = '{ this is not JSON - a read of me would have been fatal by design';
  // an existing database with a legacy file beside it
  const seeded = new SqliteAdapter(dbPath(), { log: () => {} });
  seeded.save(fullFixtureForUpgrade());
  seeded.close();
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const lines = [];
  const first = openAdapter(dir, { log: (m) => lines.push(m) });
  try {
    assert.strictEqual(Object.keys(first.adapter.load().metadata).length, 3, 'the existing rows are what boots');
  } finally {
    first.adapter.close();
  }
  assert.strictEqual(fs.readFileSync(jsonPath(), 'utf8'), GARBAGE, 'the legacy file is untouched');
  assert.ok(!lines.some((l) => /db\.json|import|stranded/i.test(l)), `boot never mentions a legacy file: ${lines.join(' | ') || '(no lines)'}`);

  // no database, the same legacy file beside: a FRESH empty schema - never an
  // import (boot rule 2 left with Wave 7), never a throw, the file untouched
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sqlite-fresh-'));
  try {
    fs.writeFileSync(path.join(dir2, 'db.json'), GARBAGE, 'utf8');
    const fresh = openAdapter(dir2, { log: () => {} });
    try {
      assert.deepStrictEqual(fresh.adapter.load(), {}, 'a fresh empty schema');
      assert.strictEqual(fresh.adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    } finally {
      fresh.adapter.close();
    }
    assert.ok(fs.existsSync(path.join(dir2, SQLITE_FILENAME)), 'the database was created');
    assert.strictEqual(fs.readFileSync(path.join(dir2, 'db.json'), 'utf8'), GARBAGE, 'and the legacy file is still untouched');
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test('exclusiveReplace: rollback-on-throw preserves prior data; success rebuilds the diff snapshot', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    const db = fullFixture();
    delete db.metadata.vid1.viewCount;
    delete db.metadata.vid3.viewCount;
    a.save(db);

    // rollback leg
    assert.throws(() => a.exclusiveReplace(() => { throw new Error('bundle validation failed'); }), /bundle validation failed/);
    assert.strictEqual(Object.keys(readPersistedDatabase(dir).metadata).length, 3, 'wipe rolled back');

    // success leg + snapshot rebuild: after replace, a save() diff must be
    // computed against the RESTORED rows, not the pre-restore snapshot.
    a.exclusiveReplace(({ insertItem, replaceFolders }) => {
      replaceFolders(['/restored']); // Wave 4: the root list is a table
      insertItem('r1', { id: 'r1', name: 'restored.mp4' }); // Wave 6: the media index is a table
    });
    assert.deepStrictEqual(readPersistedDatabase(dir), {
      folders: ['/restored'],
      metadata: { r1: { id: 'r1', name: 'restored.mp4' } },
    });
    const post = a.load();
    post.metadata.r1.title = 'Restored';
    const stats = a.save(post);
    assert.deepStrictEqual(stats, { rowsWritten: 1, rowsDeleted: 0 }, 'diff base is the restored state (snapshot rebuilt)');
    // unknown namespace refused inside a replace too
    // Wave 7: no doc handles are offered at all (the document model is gone)
    a.exclusiveReplace((handles) => { assert.strictEqual(handles.insertKv, undefined); assert.strictEqual(handles.insertSingle, undefined); });
  } finally {
    a.close();
  }
});

// ---- v1.127 Wave A (T4): the v18 marker + the future-version refusal --------
//
// External review round 2 (HIGH): v1.126 added the `folderDisplayNames`
// doc_single namespace at an UNCHANGED user_version 17, so a downgraded
// <=v1.125 adapter loads the row and then refuses every save
// (assertNoUnknownKeys) - a rollback-wide write outage. Released adapters
// can't be repaired; these tests bind the two forward fixes: the v18 stamp
// and the loud refusal of any database from the future.

test('v17 -> v18 marker migration: a v1.126-shaped database (folderDisplayNames at v17) upgrades; Wave 4 then carries the doc row into its table', () => {
  // Simulate exactly what a v1.126 instance leaves behind: the namespace
  // persisted as a doc row (planted raw - the save-lock refuses the key since
  // Wave 4), the version stamp still 17.
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  a.save(fullFixtureForUpgrade());
  ensureLegacyDocTables(a.sql); // Wave 7 dropped the doc tables; a v17 file still had them
  a.sql.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)').run('folderDisplayNames', JSON.stringify({ NESTALGIA: 'Nestalgia Music' }));
  a.sql.exec('PRAGMA user_version = 17');
  a.close();

  const b = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.strictEqual(b.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION,
      'the marker migration stamps the current version (no structural change to run)');
    assert.strictEqual(b.load().folderDisplayNames, undefined, 'Wave 4: no longer a doc key');
    assert.deepStrictEqual(readPersistedDatabase(dir).folderDisplayNames, { NESTALGIA: 'Nestalgia Music' },
      'the v1.126 namespace survives the marker migration - carried into channel_folder_display_names by v25');
    // And the file is still WRITABLE end-to-end after the stamps (the exact
    // axis the downgrade outage broke).
    require('../../lib/config/folderDisplayNames')(b).set('NEWDIR', 'New Display Name');
    assert.strictEqual(readPersistedDatabase(dir).folderDisplayNames.NEWDIR, 'New Display Name', 'durable write after the migrations');
  } finally {
    b.close();
  }
});

test('a database stamped NEWER than this build is REFUSED at open, never silently accepted', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  a.save(fullFixtureForUpgrade());
  a.sql.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  a.close();

  assert.throws(
    () => new SqliteAdapter(dbPath(), { log: () => {} }),
    new RegExp(`schema is v${SCHEMA_VERSION + 1}, but this build understands only v${SCHEMA_VERSION}`),
    'the refusal names both versions and happens at open, before any write'
  );
});
