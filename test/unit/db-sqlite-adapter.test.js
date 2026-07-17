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
//   - the WAL-safe db.json import: fidelity through the REAL rename path,
//     byte-identical db.json, the viewCounts extraction transform (AC1),
//     legacy-shape input (review F3), strict-parse corrupt abort (AC9 /
//     review F2), lossy-import refusal, crashed-import leftovers
//   - openAdapter boot rules 1-3 incl. the stranded-import fingerprint
//   - exclusiveReplace (restore): rollback-on-throw + snapshot rebuild

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  SQLITE_FILENAME,
  SqliteAdapter,
  openAdapter,
  importDbJson,
  readPersistedDatabase,
} = require('../../lib/db/sqlite');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sqlite-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const dbPath = () => path.join(dir, SQLITE_FILENAME);
const jsonPath = () => path.join(dir, 'db.json');

// A realistic full-shape db.json fixture: prod-shaped top-level keys plus
// the newer namespaces, with viewCount embedded on items exactly where the
// import must extract it from.
function fullFixture() {
  return {
    folders: ['/media/videos', '/media/music'],
    folderSettings: { '/media/videos': { name: 'Videos', hidden: false } },
    progress: { vid1: 42.5, vid2: 918 },
    metadata: {
      vid1: { id: 'vid1', name: 'clip.mp4', title: 'Clip', filePath: '/media/videos/clip.mp4', viewCount: 7, chaptersManual: [{ t: 0, title: 'Intro' }] },
      vid2: { id: 'vid2', name: 'song.mp3', title: 'Song', filePath: '/media/music/song.mp3' },
      vid3: { id: 'vid3', name: 'zero.mp4', title: 'Zero views', viewCount: 0 },
    },
    liked: ['vid1'],
    deleteTombstones: { gone1: { filePath: '/media/videos/gone.mp4', deletedAt: 1752600000000, youtubeId: 'abc123def45' } },
    settings: { defaultView: 'grid', defaultSort: 'newest', customLogoMime: 'image/png' },
    books: {
      folders: ['/media/books'],
      items: { bk1: { id: 'bk1', title: 'A Book', filePath: '/media/books/a.epub' } },
      progress: { bk1: { spineIndex: 3, offset: 0.5 } },
      pins: [{ id: 'pin1', dir: '/media/books', label: 'Shelf', order: 0 }],
      settings: {},
      audio: { bk1: { 0: { status: 'ready', key: 'k0' } } },
    },
    ytdlp: {
      allowMembersOnly: false,
      subscriptions: [{ id: 'sub1', channelUrl: 'https://youtube.com/@x', name: 'X', paused: false }],
      downloadMeta: { yt1: { channelName: 'X', capturedAt: 1752600000000 } },
      pins: [],
      channelAvatars: { UC123: { avatarUrl: 'https://a/b.jpg', fetchedAt: 1752600000000 } },
    },
  };
}

test('fresh open creates the full v1 schema with empty user tables', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.deepStrictEqual(a.load(), {}, 'fresh DB assembles to an empty object');
    for (const table of ['users', 'user_progress', 'user_liked', 'user_book_progress', 'user_book_pins', 'user_channel_pins']) {
      const { c } = a.sql.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
      assert.strictEqual(c, 0, `${table} exists and is empty (born-complete schema, exec plan)`);
    }
    assert.strictEqual(a.sql.prepare('PRAGMA user_version').get().user_version, 1);
  } finally {
    a.close();
  }
});

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

    // absent namespace: a mutator tick that never ensured books must not
    // delete the books rows (absence = "not loaded", not "deleted")
    const db3 = a.load();
    delete db3.books;
    const s3 = a.save(db3);
    assert.deepStrictEqual(s3, { rowsWritten: 0, rowsDeleted: 0 });
    assert.ok(readPersistedDatabase(dir).books.items.bk1, 'books rows survive an absent-namespace save');

    // present-but-empty: a deliberate wipe deletes rows. NOTE the documented
    // normalization: an EMPTY doc_kv namespace has zero rows, so it assembles
    // as ABSENT — indistinguishable from never-ensured. That is safe because
    // server.js's load-time backfills (top-level keys) and the lazy ensure*
    // creators (books/ytdlp) re-supply `{}` before any consumer touches it,
    // making the post-load object identical either way.
    const db4 = a.load();
    db4.deleteTombstones = {};
    const s4 = a.save(db4);
    assert.deepStrictEqual(s4, { rowsWritten: 0, rowsDeleted: 1 });
    assert.strictEqual(readPersistedDatabase(dir).deleteTombstones, undefined,
      'empty kv namespace normalizes to absent at the adapter layer (backfill restores {} at load)');
  } finally {
    a.close();
  }
});

test('unknown keys throw instead of being silently dropped (top-level and container sub-key)', () => {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try {
    assert.throws(() => a.save({ folders: [], mystery: {} }), /unknown top-level db key 'mystery'/);
    assert.throws(() => a.save({ ytdlp: { tombstones: {} } }), /unknown db key 'ytdlp\.tombstones'/);
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

test('import: fidelity through the real rename, byte-identical db.json, viewCounts extraction (AC1/AC2 shape)', () => {
  const fixture = fullFixture();
  fs.writeFileSync(jsonPath(), JSON.stringify(fixture, null, 2), 'utf8');
  const bytesBefore = crypto.createHash('sha256').update(fs.readFileSync(jsonPath())).digest('hex');

  const summary = importDbJson(jsonPath(), dbPath(), { log: () => {} });
  assert.strictEqual(summary.metadata, 3);
  assert.strictEqual(summary.viewCounts, 1, 'vid1 extracted; vid3\'s viewCount:0 is dropped (missing reads as 0)');

  const bytesAfter = crypto.createHash('sha256').update(fs.readFileSync(jsonPath())).digest('hex');
  assert.strictEqual(bytesAfter, bytesBefore, 'db.json is byte-for-byte untouched (parallel-run contract)');

  // Fidelity read AFTER the rename (the WAL-trap regression leg: these rows
  // must be readable at the FINAL path, post close+fsync+rename).
  const db = readPersistedDatabase(dir);
  const expected = fullFixture();
  delete expected.metadata.vid1.viewCount;
  delete expected.metadata.vid3.viewCount;
  expected.viewCounts = { vid1: 7 };
  assert.deepStrictEqual(db, expected, 'deep-equal modulo the documented viewCounts transform');
  assert.strictEqual(db.metadata.vid1.viewCount, undefined, 'items carry no viewCount');
  assert.deepStrictEqual(db.metadata.vid1.chaptersManual, [{ t: 0, title: 'Intro' }], 'user data on items migrates verbatim');
  assert.ok(db.deleteTombstones.gone1, 'deleteTombstones migrates (drift correction #1)');

  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.deepStrictEqual(leftovers, [], 'no tmp/sidecar leftovers after a clean import');
});

test('import: legacy-shape db.json (no liked/deleteTombstones/books/ytdlp) assembles to the same partial object', () => {
  const legacy = {
    folders: ['/media/videos'],
    folderSettings: {},
    progress: { vid1: 10 },
    metadata: { vid1: { id: 'vid1', name: 'clip.mp4' } },
    settings: { defaultView: 'grid' },
  };
  fs.writeFileSync(jsonPath(), JSON.stringify(legacy, null, 2), 'utf8');
  importDbJson(jsonPath(), dbPath(), { log: () => {} });
  const db = readPersistedDatabase(dir);
  assert.deepStrictEqual(db, legacy, 'raw import: no invented keys — backfill stays load-time-owned (review F3)');
  assert.strictEqual(db.liked, undefined);
  assert.strictEqual(db.books, undefined);
});

test('import: corrupt db.json aborts loudly and creates NOTHING; a repaired file then imports fully (AC9)', () => {
  fs.writeFileSync(jsonPath(), '{ this is not valid json', 'utf8');
  assert.throws(() => importDbJson(jsonPath(), dbPath(), { log: () => {} }), /FATAL: .*not parseable JSON.*NOT been modified/s);
  assert.ok(!fs.existsSync(dbPath()), 'no filetube.db after a corrupt-input abort');
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes(SQLITE_FILENAME)), [], 'no tmp leftovers either');

  fs.writeFileSync(jsonPath(), JSON.stringify(fullFixture(), null, 2), 'utf8');
  importDbJson(jsonPath(), dbPath(), { log: () => {} });
  assert.strictEqual(Object.keys(readPersistedDatabase(dir).metadata).length, 3, 'repaired boot imports the full set');
});

test('import: unknown key in db.json refuses a lossy import', () => {
  const withUnknown = { ...fullFixture(), futureFeature: { x: 1 } };
  fs.writeFileSync(jsonPath(), JSON.stringify(withUnknown), 'utf8');
  assert.throws(() => importDbJson(jsonPath(), dbPath(), { log: () => {} }), /unknown top-level key 'futureFeature'.*newer FileTube/s);
  assert.ok(!fs.existsSync(dbPath()));
});

test('import: leftovers from a crashed prior import are swept before the retry', () => {
  fs.writeFileSync(`${dbPath()}.tmp`, 'garbage-from-a-crashed-import', 'utf8');
  fs.writeFileSync(`${dbPath()}.tmp-wal`, 'garbage', 'utf8');
  fs.writeFileSync(jsonPath(), JSON.stringify(fullFixture()), 'utf8');
  importDbJson(jsonPath(), dbPath(), { log: () => {} });
  assert.strictEqual(Object.keys(readPersistedDatabase(dir).metadata).length, 3);
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp')), []);
});

test('openAdapter boot rules: import-on-first-boot, then use-and-ignore, stranded fingerprint, fresh', () => {
  // rule 2: json only → import
  fs.writeFileSync(jsonPath(), JSON.stringify(fullFixture()), 'utf8');
  const lines = [];
  const first = openAdapter(dir, { log: (m) => lines.push(m) });
  assert.ok(first.importSummary, 'first boot imports');
  assert.ok(lines.some((l) => l.includes('Imported db.json')), 'import summary logged');
  first.adapter.close();

  // rule 1: both exist, sqlite non-empty → used, json ignored
  lines.length = 0;
  const second = openAdapter(dir, { log: (m) => lines.push(m) });
  assert.strictEqual(second.importSummary, null, 'no re-import');
  assert.ok(lines.some((l) => l.includes('ignored')), 'ignored-db.json line logged');
  assert.strictEqual(Object.keys(second.adapter.load().metadata).length, 3);
  second.adapter.close();

  // rule 1 exception: schema-empty sqlite beside a non-empty json → loud fingerprint
  fs.unlinkSync(dbPath());
  for (const f of fs.readdirSync(dir)) if (f.startsWith(SQLITE_FILENAME)) fs.unlinkSync(path.join(dir, f));
  const empty = new SqliteAdapter(dbPath(), { log: () => {} });
  empty.close();
  lines.length = 0;
  const third = openAdapter(dir, { log: (m) => lines.push(m) });
  assert.ok(lines.some((l) => l.includes('stranded import')), 'stranded-import fingerprint warning logged (AC9)');
  third.adapter.close();

  // rule 3: neither → fresh empty
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sqlite-fresh-'));
  try {
    const fresh = openAdapter(dir2, { log: () => {} });
    assert.deepStrictEqual(fresh.adapter.load(), {});
    fresh.adapter.close();
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
    a.exclusiveReplace(({ insertKv, insertSingle }) => {
      insertSingle('folders', ['/restored']);
      insertKv('metadata', 'r1', { id: 'r1', name: 'restored.mp4' });
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
    assert.throws(() => a.exclusiveReplace(({ insertKv }) => insertKv('nope', 'k', 1)), /unknown doc_kv namespace/);
  } finally {
    a.close();
  }
});
