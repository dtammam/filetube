'use strict';

// ---- SQLite persistence adapter (v1.42) ------------------------------------
//
// The ONLY module in this repo allowed to `require('node:sqlite')` — enforced
// by test/unit/db-sqlite-source-lock.test.js. node:sqlite is experimental on
// both project Node versions (v22.23.1, v24.14.0; re-verified 2026-07-17), so
// every API touch lives here: if the API shifts across a Node major, this is
// a one-file fix. The documented fallback trigger (exec plan §v1.42) is
// better-sqlite3.
//
// Design contract (docs/exec-plans/completed/2026-07-14-v1.42-multiuser-tranche.md):
// - The in-memory DB object shape, `updateDatabase`'s synchronous-mutator
//   mutex, and `saveDatabase`'s replace-by-reference cache-set all survive
//   unchanged in server.js; this module only swaps WHAT load/save do.
// - Wave 7 of the relational-migration arc (schema v33,
//   docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md): the
//   DOCUMENT MODEL IS GONE. v1.42 persisted the legacy object into two
//   document tables (`doc_kv`, one row per key of a collection namespace;
//   `doc_single`, one row per small whole-value namespace); Waves 1-6
//   (v21-v32) drained them one namespace per wave into relational tables
//   owned by store modules, and v33 DROPPED them. What load()/save() still
//   carry is the media index - `metadata`, the one key of the doc object
//   (DOC_OBJECT_KEYS) - as the media_items table behind lib/media/items.js.
// - `save()` diffs the index's per-row serialized JSON against the store's
//   snapshot of the last commit and writes only changed/inserted/deleted
//   rows in ONE transaction, with every carrier effect (`alsoInTransaction`).
// - The v1.43/v1.44 user tables are born complete (empty) in schema v1 so
//   later releases are additive `user_version` migrations, never restructures.
// - The module-level node:sqlite `backup()` API is deliberately NOT used
//   anywhere: empirically (2026-07-17, both binaries) it is unsafe under
//   concurrent same-process writes (silent 2-row snapshot of a 1002-row
//   source in one run; `ERR_SQLITE_ERROR: not an error` rejection in
//   another). The instance-backup bundle is SELECT-assembled instead.

const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const { normalizeChannelUrl } = require('../ytdlp/store');

// Wave 5 (gate pass B, adversarial W4): a yt-dlp subscription record without an
// id gets the id addSubscription would have minted - md5 of the NORMALIZED
// channelUrl (lib/ytdlp/store.js) - at EVERY entry seam (the v31 migration
// and the bundle restore), rather than dropping the channel or refusing the
// whole import. A record with neither id nor
// channelUrl is unaddressable by every route and falls through the record
// list's own floor (logged there). Returns the number minted.
function mintLegacyYtdlpSubscriptionIds(list) {
  if (!Array.isArray(list)) return 0;
  let minted = 0;
  for (const rec of list) {
    if (rec && typeof rec === 'object' && !Array.isArray(rec) && (typeof rec.id !== 'string' || rec.id === '') && typeof rec.channelUrl === 'string' && rec.channelUrl !== '' && !rec.channelUrl.includes('\u0000')) {
      const normalized = normalizeChannelUrl(rec.channelUrl);
      rec.id = crypto.createHash('md5').update(typeof normalized === 'string' && normalized !== '' ? normalized : rec.channelUrl).digest('hex');
      minted += 1;
    }
  }
  return minted;
}
const path = require('node:path');

const SQLITE_FILENAME = 'filetube.db';

// U+0000, written as an ESCAPE SEQUENCE - never a raw byte (the v1.37.5
// lesson: raw control bytes in source render invisibly and break text
// tooling; ugrep binary-sniffed this very file while it carried them). The
// row-key guard below refuses it (tech-debt #225: it reads back truncated on
// Node 24.14 and older).
const NUL = '\u0000';

// The keys the doc OBJECT (what load() returns / save() takes) may carry.
// THIS LIST IS A LOCK: `save()` throws on any db-object key outside it (see
// assertNoUnknownKeys) so a namespace can never be silently dropped by the
// diff - adding one is a deliberate schema conversation (a store module, a
// migration block, a test), exactly the posture the repo's other lock tests
// enforce.
//
// History (the relational-migration arc): from v1.42 this file carried the
// persisted-namespace census as two lists, DOC_KV_NAMESPACES (collection
// namespaces, one `doc_kv` row per key) and SINGLETON_NAMES (small whole
// values, one `doc_single` row each), plus CONTAINER_KEYS for the feature
// containers' sub-keys. Waves 1-6 (schema v21-v32) moved every namespace
// into its own table - the lib/media and lib/config store modules, then the
// feature stores in FEATURE_DEFS - each migration backfilling the table and
// deleting the doc rows in one transaction, the save-lock refusing the dead
// key from then on, the import classifier routing the bundle key to the
// table (RELATIONAL_IMPORT_KEYS). With both lists empty, Wave 7 (v33)
// dropped the two tables and the lists. `metadata` - the media index - is
// the one key left on the object: the media_items table behind
// lib/media/items.js, assembled by load() and diffed back by save().
const DOC_OBJECT_KEYS = ['metadata'];
const KNOWN_TOP_LEVEL = new Set(DOC_OBJECT_KEYS);
// Wave 5: the content modules' namespaces as feature stores (lib/db/featureStore.js).
// Each one's tables are wiped + repopulated by exclusiveReplace, imported whole
// through `replaceFeature`, surfaced by readPersistedDatabase, and backfilled by
// its own migration block (which keeps the CREATE TABLEs literal).
const FEATURE_DEFS = [
  require('../tv/store').FEATURE, // v27
  require('../music/store').FEATURE, // v28
  require('../books/store').FEATURE, // v29
  require('../podcasts/store').FEATURE, // v30
  require('../ytdlp/store').FEATURE, // v31
];
const FEATURE_BY_NAME = new Map(FEATURE_DEFS.map((d) => [d.name, d]));

// Wave 1 (relational-migration arc): keys a backup bundle may carry that are
// NOT keys of the doc object - the import classifier accepts them and routes
// each to its relational table via a dedicated handle (`insertViewCount`),
// while assertNoUnknownKeys (the SAVE lock) keeps refusing them on the
// mega-object. The store module owns the table's SQL; the bulk seam in this
// file (exclusiveReplace) reuses its upsert text so there is one statement,
// not a drifting copy.
const itemsDef = require('../media/items'); // Wave 6: the media index's table
const RELATIONAL_IMPORT_KEYS = new Set(['viewCounts', 'progress', 'deleteTombstones', 'trash', 'settings', 'folders', 'folderSettings', 'folderDisplayNames', 'liked', 'tv', 'music', 'books', 'podcasts', 'ytdlp']);
const { TABLE: VIEW_COUNTS_TABLE, UPSERT_SQL: VIEW_COUNT_UPSERT_SQL, usableCount } = require('../media/viewCounts');
// Waves 2-3: the id-keyed RECORD namespaces (verbatim JSON rows). Each module
// exports its table, its upsert text and the row-params builder, so the typed
// columns (a tombstone's deleted_at, a trash record's trashed_at) can never
// drift from the json. `isPersistableId` is the shared id rule the migrations
// apply to legacy doc keys.
const { isPersistableId } = require('../media/jsonRowStore');
const progressDef = require('../media/progress');
const tombstoneDef = require('../media/deleteTombstones');
const trashDef = require('../media/trashRecords'); // Wave 3
// Wave 4: the config singletons. `settings` is a { key: value } object and
// routes through the same map machinery as a record namespace (one row per
// key); its store merges DEFAULT_SETTINGS on read, so the rows hold only
// what was set.
const settingsDef = require('../config/settings');
// Wave 4 (second group): the folder config. `folders` is an ORDERED LIST
// (its own import route below - not a map); the two maps route like records.
const foldersDef = require('../config/folders');
const folderSettingsDef = require('../config/folderSettings');
const folderDisplayNamesDef = require('../config/folderDisplayNames');
// Wave 4 (third group): the frozen pre-auth likes - an ORDERED LIST like folders.
const likedDef = require('../media/liked');
const RECORD_IMPORT_ROUTES = [
  { key: 'progress', handle: 'insertProgress', table: progressDef.TABLE },
  { key: 'deleteTombstones', handle: 'insertTombstone', table: tombstoneDef.TABLE },
  { key: 'trash', handle: 'insertTrash', table: trashDef.TABLE },
  { key: 'settings', handle: 'insertSetting', table: settingsDef.TABLE }, // Wave 4
  { key: 'folderSettings', handle: 'insertFolderSetting', table: folderSettingsDef.TABLE }, // Wave 4
  { key: 'folderDisplayNames', handle: 'insertFolderDisplayName', table: folderDisplayNamesDef.TABLE }, // Wave 4
];

// node:sqlite STORES a NUL-bearing TEXT bind verbatim but, on Node 24.14 and
// older, READS it back truncated at the NUL (measured 2026-09-14 on 22.23.1 /
// 24.14.0 / 24.20.0 - tech-debt #225; the 2026-07-17 observation of 'evil' +
// U+0000 + 'key' persisting as 'evil' was the READ, not the write). A key that
// reads back as a colliding prefix is silent identity corruption — the wrong
// row gets written, diffed, and deleted — so NUL-bearing row keys are REFUSED
// loudly at every
// write boundary (save, restore). No legitimate key carries NUL (media ids
// are md5 hex); only a hostile or corrupt source could, and honest refusal
// beats silent truncation. JSON VALUES are safe without a guard:
// JSON.stringify escapes all control characters, so the json column never
// carries a raw NUL.
function assertRowKeySafe(ns, key) {
  if (typeof key === 'string' && key.includes(NUL)) {
    throw new Error(`SqliteAdapter: a row key in '${ns}' contains U+0000 — node:sqlite reads a NUL-bearing TEXT back truncated on Node 24.14 and older (verbatim from 24.20 - tech-debt #225), so a persisted NUL-bearing key would read back as a colliding prefix and silently corrupt the key. Refusing (fix or remove the offending key).`);
  }
}

// Row-key assembly MUST NOT use plain assignment: a row keyed '__proto__'
// (JSON.parse happily materializes one; reachable via a crafted restore
// bundle or a hand-edited row) would make `obj[key] = value` a PROTOTYPE
// ASSIGNMENT — the row silently vanishes from Object.keys (data loss) and
// every miss on the namespace returns attacker-planted fields (prototype
// pollution). Object.defineProperty creates a plain OWN property for any
// key, so hostile keys round-trip as inert data instead (gate CRITICAL,
// adversarial seat, runnable repro).
function defineRowProperty(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

// ---- schema ----------------------------------------------------------------

// Forward-only migration runner keyed on PRAGMA user_version. v1 creates
// everything v1.42 needs PLUS the v1.43/44 user tables. v2 (v1.43) recreates
// the users table with AUTOINCREMENT — a rare RESTRUCTURE, forced by a real
// correctness bug the design-delta review caught: plain INTEGER PRIMARY KEY
// REUSES the highest deleted rowid, so deleting a user and creating another
// gives the reaped id back, and a stale ~30-day cookie carrying that uid
// could inherit the new account. Safe to recreate: v1.42 shipped these
// tables EMPTY and v1.43 is the first release to populate them, so no
// instance has any user row to lose (the schema-empty check in openAdapter
// confirms this is only ever run against empty user tables in practice).
//
// v3 (v1.44 music): ADDITIVE — three new per-user music tables born empty.
// Never edits the v1/v2 blocks (forward-only doctrine); an already-shipped
// schema gets new tables via a fresh `if (current < N)` block, never a
// restructure. The `IF NOT EXISTS` makes it idempotent under WAL replay.
//
// v4 (v1.50 watched filter): ADDITIVE — one per-user completion-latch table,
// born empty. A row means "this user has played this media past the watched
// threshold at least once"; it is STICKY (playback never deletes it), which
// is what keeps a looping/rewatched video from un-watching itself when its
// live timestamp cycles back toward 0.
//
// v5 (v1.51 notification bell): ADDITIVE — a global download-notification
// feed plus two per-user state tables, all born empty. `notifications` is
// deliberately NOT per-user: one download is one event, and each user gets
// their own seen/read/cleared view of the same feed (YouTube-per-account).
// `media_id` is the same md5(path) id the other carriers key by, so the
// feed is a full id-keyed-carrier citizen: delete/prune/move re-key must
// carry it (lib/auth/store.js removeMediaState/rekeyMediaState).
//
// v7 (v1.66 web push): ADDITIVE - one per-user push-subscription table, born
// empty. Keyed by the push-service endpoint URL (the browser's identity for
// a subscription); `last_pushed_id` is the per-subscription cursor into the
// notifications feed's AUTOINCREMENT ids (the seam the v5 comment reserved).
// NOT media-keyed (removeMediaState/rekeyMediaState do not apply) and
// DELIBERATELY absent from backup bundles: `auth` is a shared secret and the
// endpoint is capability-bearing (secrets don't ride bundles - the session-
// secret rule), and rows are cryptographically bound to THIS instance's
// VAPID key, so restored rows could never deliver anyway. The client-side
// boot reconcile re-registers devices after a users-restore wipes rows via
// cascade (exec plan v1.66 D2).
// v9 (v1.69 podcasts): ADDITIVE - two per-user tables, born empty, keyed by
// podcast EPISODE id (md5 of subId+guid, lib/podcasts/store.js - NOT a media
// id, so removeMediaState/rekeyMediaState do not apply; the podcasts module
// wires its own delete carrier, removePodcastEpisodeState, and there is no
// re-key by construction: episode ids derive from guid, not file path).
// `user_podcast_progress` mirrors user_music_progress; `user_podcast_played`
// is the watched-latch lane (manual toggle + >=95% auto-latch). Both ride
// the per-user backup bundle halves.
// v10 (v1.71 podcasts-everywhere): ADDITIVE - (a) `user_podcast_liked`,
// keyed by podcast EPISODE id like the v9 pair (guid-derived, no re-key;
// delete carrier = removePodcastEpisodeState, joined in the birth commit;
// rides the per-user backup bundle halves). (b) `user_queue.entry_kind`
// ('media' | 'podcast', default 'media' so every pre-v10 row reads back
// as media): podcast episode ids are md5 hex EXACTLY like media ids, so
// the kind must be CARRIED, never inferred (the v1.69 id-space lesson).
// A podcast-kind row's media_id holds an episode id; those rows are
// retired by removePodcastEpisodeState (delQueueByEpisode), while
// media-kind rows keep riding removeMediaState/rekeyMediaState untouched.
// v11 (v1.72 first-class parity): ADDITIVE - two per-user tables, born
// empty, keyed by BOOK id (the books scanner's id space - NOT a media id,
// so removeMediaState/rekeyMediaState do not apply; the books module's own
// delete carrier removeBookState retires them alongside user_book_progress,
// and like that table there is no re-key lane by construction).
// `user_book_liked` is capability 4's carrier (books join the mixed-kind
// Liked playlist); `user_book_finished` is capability 6's manual latch
// (mark-finished on the read page - no auto threshold: a text position's
// "end" is format-dependent, disclosed in the v1.72 exec plan). Both ride
// the per-user backup bundle halves (TWELFTH carrier strike).
// v12 (v1.72, same wave): ADDITIVE - `user_podcast_pins` (a podcast SHOW in
// the Playlists surface - Dean's intake ruling 5; the user_book_pins shape,
// pin_id = the show's subscription id, retired on unsubscribe by
// removePodcastShowPins). This was FIRST added by editing the
// already-executed v11 block - the classic migration sin - and it bit
// within hours: any db stamped 11 by an interim build skipped the edited
// block and statementsFor threw on the missing table (found as a
// deterministic full-suite hang in readonly-mode.test.js, whose default
// DATA_DIR db was exactly such a victim). Migration blocks are
// APPEND-ONLY once any run has executed them, version-gated blocks
// included; a late table gets a new version, full stop.
// v13 (v1.73 podcast push): ADDITIVE - `notifications.kind`
// ('media' default | 'podcast'), presence-checked ALTER like v10's
// entry_kind. Episode ids are md5 hex exactly like media ids, so the feed
// carries the kind explicitly; NOTE the pre-existing UNIQUE(media_id)
// stays - a cross-kind md5 collision REPLACES the row (the feed's
// documented replace semantics, benign: a notification, never user data)
// rather than coexisting. Podcast rows retire with the episode purge
// carrier (removePodcastEpisodeState); removeMediaState's kind-blind
// delNotificationByMedia can only ever see the row that WON the replace
// (adversarial S1: under UNIQUE(media_id) exactly one row exists per id).
// v18 (v1.127 Wave A): a MARKER version, no structural change. v1.126 added
// the `folderDisplayNames` doc_single namespace WITHOUT bumping this number,
// which silently broke the downgrade contract: a <=v1.125 adapter load()s
// every doc_single row by name, then assertNoUnknownKeys REFUSES every
// subsequent save - boots, reads, and then every durable write fails
// (external review round 2, HIGH; verified against the v1.122.0 tag). Released
// adapters cannot be repaired retroactively (they SKIP, rather than refuse,
// any user_version >= their own), so the fix is a documented ROLLBACK FLOOR
// (databases touched by >=v1.126 are not writable by <=v1.125 - see
// docs/RELEASING.md "Schema versions and the rollback floor") plus two rules
// this bump instates:
//   1. Any commit that adds a persisted namespace bumps SCHEMA_VERSION in
//      that SAME commit, so the change is visible in the file itself.
//   2. migrateSchema REFUSES a database from the future (below) - loudly,
//      at boot, before any write could touch namespaces this build does not
//      understand.
// v21 (v1.291, relational-migration arc Wave 1): `media_view_counts` - the
// FIRST media namespace to leave the document model. ADDITIVE table, then a
// one-time backfill: every `doc_kv` row of the `viewCounts` namespace is
// copied into the table and the doc rows are DELETED in the same
// transaction (leaving them would make load() assemble a `db.viewCounts`
// the save-lock now refuses - boot would break on the first write). This is
// the rollback floor for the arc: a <=v1.290 build refuses a v21 database
// (the refusal rule above) rather than losing the counts; the backup bundle
// carries `viewCounts` in the same { id: count } shape as before, so a
// bundle restores on either side of the line.
// v22 (v1.292, relational-migration arc Wave 2): `media_progress` (the frozen
// pre-auth positions, adopted once by the first admin) and
// `media_delete_tombstones` (the deferred-delete records). Both keep the
// record VERBATIM as json; tombstones carry a typed `deleted_at` beside it
// for the growth-bound query. Same discipline as v21: backfill + delete the
// doc rows in ONE transaction, then the save-lock refuses the dead keys. The
// third rollback floor (RELEASING.md).
// v23 (v1.293, relational-migration arc Wave 3): `media_trash` - the
// trashed-item records (the only way back for a trashed file). Verbatim
// json + a typed `trashed_at` the retention sweep queries. Same discipline:
// backfill + delete the doc rows in ONE transaction, save-lock refuses the
// dead key, the import classifier routes it. The fourth rollback floor.
// v24 / v25 / v26 (v1.294, relational-migration arc Wave 4): `app_settings`
// (one row per setting key), `library_folders` + `library_folder_settings` +
// `channel_folder_display_names` (the folder config), `media_liked` (the frozen
// pre-auth likes) - the fifth, sixth and seventh rollback floors. From v24 on
// each block stamps its OWN floor inside its commit (a later block failing
// leaves the last committed floor, never a partial state an older build would
// boot and default over).
// v27-v32 (v1.294-v1.295, Waves 5-6): the feature containers and the media
// index - the eighth to thirteenth floors; after v32 both document tables are
// empty by construction.
// v33 (v1.296, Wave 7): the two document tables are DROPPED - the fourteenth
// floor. A v33 database opens on no build before v1.296 (the refusal rule
// above); nothing is backfilled because nothing is left to carry, and the
// block REFUSES (leaving v32) if a row is nonetheless there.
const SCHEMA_VERSION = 33;

// The document tables' DDL, as the v1 block spells it (kept literal there:
// an executed migration block is never edited). Two callers: migrateSchema's
// below-v33 guard, and the test helper that plants legacy doc rows before a
// migration rewind (test/helpers/legacy-doc-tables.js).
const LEGACY_DOC_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS doc_kv (
    namespace TEXT NOT NULL,
    key       TEXT NOT NULL,
    json      TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
  );
  CREATE TABLE IF NOT EXISTS doc_single (
    name TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
`;

function migrateSchema(sql) {
  const current = sql.prepare('PRAGMA user_version').get().user_version;
  // v1.127: a database stamped NEWER than this build is refused, never
  // silently accepted - writing to it could drop or corrupt namespaces this
  // build does not know exist (exactly the v1.126/v1.122 failure, but with
  // data loss instead of a clean write-refusal).
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `FileTube database schema is v${current}, but this build understands only v${SCHEMA_VERSION}. `
      + 'Refusing to open it - run the FileTube version that created this database, '
      + 'or upgrade this one (rollback floor: docs/RELEASING.md).'
    );
  }
  if (current >= SCHEMA_VERSION) return;
  // Wave 7: the drains (v21-v32) read the two document tables that v33 drops.
  // A real database below v33 always still has them (the v1 block created
  // them); this re-creates them ONLY for a file stamped back below v33 after
  // the drop - the migration tests' rewinds - so every block below runs
  // against the schema it was written for. Same DDL as the v1 block.
  if (current < 33) sql.exec(LEGACY_DOC_TABLES_DDL);
  if (current < 1) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS doc_kv (
        namespace TEXT NOT NULL,
        key       TEXT NOT NULL,
        json      TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      );
      CREATE TABLE IF NOT EXISTS doc_single (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT,
        role TEXT CHECK(role IN ('admin','member')),
        can_manage_subscriptions INTEGER DEFAULT 0,
        settings_json TEXT DEFAULT '{}',
        token_version INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        timestamp REAL,
        duration REAL,
        updated_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS user_liked (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        liked_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS user_book_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL,
        position_json TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (user_id, book_id)
      );
      CREATE TABLE IF NOT EXISTS user_book_pins (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pin_id TEXT NOT NULL,
        pin_json TEXT NOT NULL,
        pin_order INTEGER,
        PRIMARY KEY (user_id, pin_id)
      );
      CREATE TABLE IF NOT EXISTS user_channel_pins (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pin_id TEXT NOT NULL,
        pin_json TEXT NOT NULL,
        pin_order INTEGER,
        PRIMARY KEY (user_id, pin_id)
      );
    `);
  }
  if (current < 2) {
    // v1.43: users.id must NEVER be reused (design-delta SUGGESTION-6).
    // Recreate with AUTOINCREMENT. The child tables are dropped and
    // recreated too (their FK targets the users rowid); all five are empty
    // on every instance that reaches here, so this loses nothing. Guard:
    // refuse the restructure if a users row somehow exists (belt for a
    // future where v1.43+ already populated them — never silently drop
    // real accounts).
    const existingUsers = sql.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (existingUsers > 0) {
      throw new Error(`FATAL: schema v2 migration would recreate a non-empty users table (${existingUsers} rows) — refusing to drop real accounts. This should be impossible (v2 predates any populated users table).`);
    }
    sql.exec(`
      DROP TABLE IF EXISTS user_channel_pins;
      DROP TABLE IF EXISTS user_book_pins;
      DROP TABLE IF EXISTS user_book_progress;
      DROP TABLE IF EXISTS user_liked;
      DROP TABLE IF EXISTS user_progress;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT,
        role TEXT CHECK(role IN ('admin','member')),
        can_manage_subscriptions INTEGER DEFAULT 0,
        settings_json TEXT DEFAULT '{}',
        token_version INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at TEXT
      );
      CREATE TABLE user_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        timestamp REAL,
        duration REAL,
        updated_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE user_liked (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        liked_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE user_book_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL,
        position_json TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (user_id, book_id)
      );
      CREATE TABLE user_book_pins (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pin_id TEXT NOT NULL,
        pin_json TEXT NOT NULL,
        pin_order INTEGER,
        PRIMARY KEY (user_id, pin_id)
      );
      CREATE TABLE user_channel_pins (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pin_id TEXT NOT NULL,
        pin_json TEXT NOT NULL,
        pin_order INTEGER,
        PRIMARY KEY (user_id, pin_id)
      );
    `);
  }
  if (current < 3) {
    // v1.44 music: three per-user music tables, born empty. Additive — no
    // existing table is touched. `user_music_liked` mirrors `user_liked`;
    // `user_music_progress` carries per-track resume position (feeds the
    // >10-min smart-resume rule); `user_music_state` is ONE row per user (the
    // "resume where I left off" pointer: last track + its queue context).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_music_liked (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        liked_at TEXT,
        PRIMARY KEY (user_id, track_id)
      );
      CREATE TABLE IF NOT EXISTS user_music_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        position_seconds REAL,
        duration_seconds REAL,
        updated_at TEXT,
        PRIMARY KEY (user_id, track_id)
      );
      CREATE TABLE IF NOT EXISTS user_music_state (
        user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_track_id TEXT,
        queue_ctx_json TEXT,
        position_seconds REAL,
        updated_at TEXT
      );
    `);
  }
  if (current < 4) {
    // v1.50: per-user watched latch (media_id is the same md5(path) id
    // user_progress/user_liked key by — a full id-keyed-carrier citizen:
    // delete/prune/move re-key, backup/restore, and the test reset all
    // carry it, same as its siblings).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_watched (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
    `);
  }
  if (current < 5) {
    // v1.51 notification bell. Times are epoch-ms INTEGERs (not the TEXT
    // ISO convention of the older tables) because every comparison the
    // feature makes — created_at > last_seen_at, > cleared_at — is numeric,
    // and item.addedAt (the created_at source) is already epoch ms.
    // `media_id` UNIQUE: a re-download of the same on-disk path replaces
    // its old row (delete-then-insert, so the row re-sorts to the top with
    // a fresh id). AUTOINCREMENT ids are the push-wave seam: a future push
    // sender can deliver "rows with id > last-pushed" without re-reading
    // per-user state.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_notification_state (
        user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_seen_at INTEGER NOT NULL DEFAULT 0,
        cleared_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS user_notification_reads (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_id INTEGER NOT NULL,
        read_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, notification_id)
      );
    `);
  }
  if (current < 6) {
    // v1.63 playback queue (Dean: "think YouTube"). One ephemeral-by-
    // spirit, durable-by-storage queue per user. entry_uid (not media_id)
    // is the row identity so the same video can be queued twice and
    // reorder/remove stay unambiguous; entry_order is the queue position
    // (rewritten wholesale on reorder - queues are small). The pointer
    // (now-playing entry) lives in its own one-row-per-user table so
    // clearing items and moving the pointer are independent writes.
    // media_id is the NINTH id-keyed carrier: it joins removeMediaState
    // and rekeyMediaState in lib/auth/store.js IN THIS SAME COMMIT (the
    // v1.42 lesson - a new id-keyed namespace updates every carrier seam
    // the day it is born).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_queue (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entry_uid TEXT NOT NULL,
        media_id TEXT NOT NULL,
        entry_order INTEGER NOT NULL,
        PRIMARY KEY (user_id, entry_uid)
      );
      CREATE TABLE IF NOT EXISTS user_queue_state (
        user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        pointer_uid TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
    `);
  }
  if (current < 7) {
    // v1.66 web push. One row per (device x user) subscription; endpoint is
    // the primary key because it IS the subscription's identity - the same
    // browser re-subscribing replaces its row, and a device that switches
    // account re-binds via the upsert. Epoch-ms INTEGER times (the v5
    // convention: every comparison is numeric). cooldown_until implements
    // the 429 Retry-After honor (intake ruling P3). See the v7 paragraph
    // above for why this table never rides backup bundles.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT NOT NULL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        last_pushed_id INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
  }
  if (current < 8) {
    // v1.68 per-user notification DISMISSAL lane (Dean's rulings 1-3): a
    // dismissed row leaves THAT user's panel and badge but survives
    // globally (the clear-all discipline, made per-row). Shape mirrors
    // user_notification_reads exactly; rides the same carrier seams (cap
    // eviction, replace-on-same-media, media-delete purge, backup user
    // bundles, the raw-feed restore's by-media re-resolve).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_notification_dismissals (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_id INTEGER NOT NULL,
        dismissed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, notification_id)
      );
    `);
  }
  if (current < 9) {
    // v1.69 podcasts (see the SCHEMA_VERSION comment above).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_podcast_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        position_seconds REAL,
        duration_seconds REAL,
        updated_at TEXT,
        PRIMARY KEY (user_id, episode_id)
      );
      CREATE TABLE IF NOT EXISTS user_podcast_played (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        played_at TEXT,
        PRIMARY KEY (user_id, episode_id)
      );
    `);
  }
  if (current < 10) {
    // v1.71 podcasts-everywhere (see the SCHEMA_VERSION comment above).
    // ADD COLUMN is additive and cheap; the DEFAULT backfills every
    // existing queue row as 'media' in the same statement. ALTER has no
    // IF-NOT-EXISTS form, so the presence check keeps this block
    // re-runnable like every CREATE TABLE IF NOT EXISTS above it.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_podcast_liked (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        liked_at TEXT,
        PRIMARY KEY (user_id, episode_id)
      );
    `);
    const hasKind = sql.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('user_queue') WHERE name = 'entry_kind'").get().n > 0;
    if (!hasKind) {
      sql.exec("ALTER TABLE user_queue ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'media'");
    }
  }
  if (current < 11) {
    // v1.72 first-class parity (see the SCHEMA_VERSION comment above).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_book_liked (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL,
        liked_at TEXT,
        PRIMARY KEY (user_id, book_id)
      );
      CREATE TABLE IF NOT EXISTS user_book_finished (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL,
        finished_at TEXT,
        PRIMARY KEY (user_id, book_id)
      );
    `);
  }
  if (current < 12) {
    // v1.72 podcast show pins (see the SCHEMA_VERSION comment above - and
    // its append-only lesson; this block heals dbs an interim branch build
    // stamped 11 without the table).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_podcast_pins (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pin_id TEXT NOT NULL,
        pin_json TEXT NOT NULL,
        pin_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, pin_id)
      );
    `);
  }
  if (current < 13) {
    // v1.73 podcast push (see the SCHEMA_VERSION comment above). ALTER has
    // no IF-NOT-EXISTS form - the presence check keeps the block
    // re-runnable (the v10 entry_kind ritual).
    const hasKind = sql.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('notifications') WHERE name = 'kind'").get().n > 0;
    if (!hasKind) {
      sql.exec("ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'media'");
    }
  }
  if (current < 14) {
    // v1.80 RBAC: per-user library RESTRICTIONS (blocklist). A member sees
    // everything EXCEPT the units listed here; admin has no rows and sees all.
    // kind in {path, folder, show, library}; see lib/auth/visibility.js. Rows
    // cascade-delete with the user. (Append-only migration - the v11 lesson.)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_restrictions (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, kind, value)
      );
    `);
  }
  if (current < 15) {
    // v1.81 write-RBAC: the per-user WRITE capability. v1.80 controlled what a
    // member may SEE (user_restrictions); this controls what a member may DO -
    // delete/move/edit library content, run scans, clear the cache. Default 0
    // (OFF) so existing members lose destructive actions until an admin grants
    // it (Dean-approved); admin ALWAYS bypasses (role check, never this column).
    // Sibling to can_manage_subscriptions. ALTER has no IF-NOT-EXISTS form -
    // the presence check keeps the block re-runnable (the v10/v13 ritual).
    // Append-only migration (the v11 lesson).
    const hasCol = sql.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'can_modify_library'").get().n > 0;
    if (!hasCol) {
      sql.exec('ALTER TABLE users ADD COLUMN can_modify_library INTEGER DEFAULT 0');
    }
  }
  if (current < 16) {
    // v1.85 #1: per-user search history (the mobile magnifier's recent-searches
    // list). term is the natural key so a re-search updates recency rather than
    // duplicating; searched_at drives DESC recency + the client cap. Mirrors
    // user_liked's shape/cascade. Append-only migration (the v11 lesson).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_search_history (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        term TEXT NOT NULL,
        searched_at TEXT,
        PRIMARY KEY (user_id, term)
      );
    `);
  }
  if (current < 17) {
    // v1.97 "Hide from feed": a per-user, MANUAL prune of the MODERN home feed.
    // media_id-keyed membership, mirroring user_liked's shape/cascade EXACTLY
    // (point add/remove + by-media delete + OR-REPLACE re-key). DELIBERATELY
    // SEPARATE from the admin/global visibility flag (metadata.hidden /
    // user_restrictions, v1.80-1.81): this hides an item from ONE user's modern
    // feed only - it is never a permission, never a leak surface, and the item
    // stays fully findable everywhere else. Append-only migration (the v11 lesson).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_feed_hidden (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        hidden_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
    `);
  }
  // v18 is a MARKER (see the SCHEMA_VERSION comment): no structural block -
  // a v17 database reaches here having run nothing and is stamped 18, which
  // is exactly the point (the stamp is what records "this file may carry the
  // folderDisplayNames namespace" for the refusal check above).
  if (current < 19) {
    // v1.195 TV Shows: three per-user tables, born empty (additive - no existing
    // table is touched). Shapes mirror user_music_*/user_podcast_* exactly.
    // episode_id is md5(filePath) - a full id-keyed carrier: its delete carrier
    // removeTvEpisodeState and re-key ride the same seams in lib/auth/store.js the
    // day the routes land (the v1.42 lesson). `user_tv_progress` carries resume
    // position + duration (Continue-Watching + the 90%-watched auto-mark, O2);
    // `user_tv_played` is the manual/threshold watched latch; `user_tv_liked` is
    // optional membership. This block ALSO records the tv.* namespace bump (rule 1
    // in the SCHEMA_VERSION comment: adding a persisted namespace bumps the number
    // in the SAME commit).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_tv_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        position_seconds REAL,
        duration_seconds REAL,
        updated_at TEXT,
        PRIMARY KEY (user_id, episode_id)
      );
      CREATE TABLE IF NOT EXISTS user_tv_played (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        played_at TEXT,
        PRIMARY KEY (user_id, episode_id)
      );
      CREATE TABLE IF NOT EXISTS user_tv_liked (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        liked_at TEXT,
        PRIMARY KEY (user_id, episode_id)
      );
    `);
  }
  if (current < 20) {
    // v1.265 cross-device preference sync: one per-user KV row per SYNCED
    // localStorage key (the exec-plan allowlist; the server route enforces it).
    // updated_at is Date.now() ms - the LWW authority (the upsert's WHERE guard
    // in lib/auth/store.js drops stale writes). Additive; born empty; rides the
    // per-user backup entries from THIS commit (the fourteenth-strike carrier).
    sql.exec(`
      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `);
  }
  if (current < 21) {
    // Relational-migration arc Wave 1 (see the SCHEMA_VERSION comment): the
    // table is born, the doc_kv `viewCounts` rows move into it, and the doc
    // rows are deleted - ONE transaction, so a crash mid-way leaves either the
    // old doc rows (and a v20 stamp, retried next boot) or the finished move.
    // The value filter mirrors the v1.42 extraction: a finite positive number
    // is a count; anything else (junk, 0, null) is dropped as "reads as 0".
    // Append-only from here (the v11/v12 lesson): never edit this block.
    sql.exec('BEGIN');
    try {
      // The table name is a LITERAL here on purpose: docs-diagrams-census
      // derives the relational-table roster from the CREATE TABLE statements
      // in this file, so an interpolated name would be invisible to it.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS media_view_counts (
          media_id TEXT PRIMARY KEY,
          count INTEGER NOT NULL
        );
      `);
      const upsert = sql.prepare(VIEW_COUNT_UPSERT_SQL);
      for (const row of sql.prepare("SELECT key, json FROM doc_kv WHERE namespace = 'viewCounts'").all()) {
        let value;
        try { value = JSON.parse(row.json); } catch (_) { value = null; }
        const n = usableCount(value);
        // (The NUL check is belt-and-braces: assertRowKeySafe guards every
        // doc_kv writer, so such a row cannot exist - gate M27, harmless.)
        if (n !== null && !row.key.includes('\u0000')) upsert.run(row.key, n);
      }
      sql.exec("DELETE FROM doc_kv WHERE namespace = 'viewCounts'");
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 22) {
    // Relational-migration arc Wave 2 (see the SCHEMA_VERSION comment): two
    // id-keyed RECORD tables, born + backfilled + doc rows deleted in ONE
    // transaction (the v21 shape). The json is copied VERBATIM (a legacy
    // record of any shape survives); a tombstone's deleted_at is derived
    // from the record by the store's own row builder. A row whose json does
    // not parse cannot exist (every doc_kv writer serialised it) - refused
    // loudly rather than skipped, so a corrupt row rolls the whole block
    // back and boot names the problem. Literal table names on purpose (the
    // diagrams census reads them). Append-only from here.
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS media_progress (
          media_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS media_delete_tombstones (
          media_id TEXT PRIMARY KEY,
          deleted_at INTEGER,
          json TEXT NOT NULL
        );
      `);
      const moves = [
        { ns: 'progress', upsert: sql.prepare(progressDef.UPSERT_SQL), rowParams: progressDef.rowParams },
        { ns: 'deleteTombstones', upsert: sql.prepare(tombstoneDef.UPSERT_SQL), rowParams: tombstoneDef.rowParams },
      ];
      const docRows = sql.prepare('SELECT key, json FROM doc_kv WHERE namespace = ?');
      for (const { ns, upsert, rowParams } of moves) {
        for (const row of docRows.all(ns)) {
          if (row.key.includes('\u0000')) continue; // cannot exist (assertRowKeySafe) - belt-and-braces
          upsert.run(...rowParams(row.key, JSON.parse(row.json)));
        }
        sql.prepare('DELETE FROM doc_kv WHERE namespace = ?').run(ns);
      }
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 23) {
    // Relational-migration arc Wave 3: the trashed-item records (the v22
    // shape - table born, doc rows copied verbatim with trashed_at derived,
    // doc rows deleted, ONE transaction; a corrupt row rolls the whole block
    // back to a re-runnable v22). Literal table name (the diagrams census).
    // Append-only from here.
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS media_trash (
          media_id TEXT PRIMARY KEY,
          trashed_at INTEGER,
          json TEXT NOT NULL
        );
      `);
      const upsert = sql.prepare(trashDef.UPSERT_SQL);
      for (const row of sql.prepare("SELECT key, json FROM doc_kv WHERE namespace = 'trash'").all()) {
        // A key that fails the store's id rule (empty / NUL-bearing - a
        // <=v1.292 restore accepted `trash: { '': rec }`) was never addressable
        // by any route; moving it would make it an unpurgeable row that aborts
        // the retention sweep (gate W1). Skip it, say so; its bytes stay for
        // the orphan pass.
        if (!isPersistableId(row.key)) {
          console.error(`[db] migration v23: skipping a trash record with an unaddressable key (${JSON.stringify(row.key)}) - it was never restorable; its bytes remain for the orphan sweep`);
          continue;
        }
        upsert.run(...trashDef.rowParams(row.key, JSON.parse(row.json)));
      }
      sql.exec("DELETE FROM doc_kv WHERE namespace = 'trash'");
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 24) {
    // Relational-migration arc Wave 4 (first group): the app settings leave
    // doc_single for app_settings - ONE ROW PER KEY. The doc row's object is
    // split into rows verbatim (values as they were; DEFAULT_SETTINGS is
    // merged by the store on read, exactly as loadDatabase() merged it), the
    // doc row deleted, ONE transaction; a corrupt row rolls the whole block
    // back to a re-runnable v23. A settings row that is not an object (a hand
    // edit) is dropped with a log line - the defaults apply, nothing else
    // could have read it. Literal table name (the diagrams census).
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      const row = sql.prepare("SELECT json FROM doc_single WHERE name = 'settings'").get();
      if (row) {
        const obj = JSON.parse(row.json);
        if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
          const upsert = sql.prepare(settingsDef.UPSERT_SQL);
          for (const key of Object.keys(obj)) {
            if (!isPersistableId(key)) {
              console.error(`[db] migration v24: skipping a settings key that no route could ever have written (${JSON.stringify(key)})`);
              continue;
            }
            upsert.run(key, JSON.stringify(obj[key]));
          }
        } else if (obj !== null && obj !== undefined) {
          console.error('[db] migration v24: the settings row was not an object - dropped; the defaults apply');
        }
      }
      sql.exec("DELETE FROM doc_single WHERE name = 'settings'");
      // The stamp rides THIS block's commit (adversarial pass A W1): a later
      // block failing must leave the stamp at the last COMMITTED floor, so a
      // <=v1.293 build refuses the partial database instead of booting it,
      // defaulting the settings it no longer finds and overwriting these rows.
      sql.exec('PRAGMA user_version = 24');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 25) {
    // Relational-migration arc Wave 4 (second group): the folder config
    // leaves doc_single. `folders` (the root list, operator order) becomes
    // library_folders rows numbered by array index (exact duplicates - a
    // hand edit; the route dedupes - collapse keep-first); `folderSettings`
    // and `folderDisplayNames` become one row per key, values verbatim. A
    // doc row of the wrong shape is dropped with a log line (no route could
    // have read it: loadDatabase() backfilled a fresh value in its place); a
    // key failing the id rule is skipped. ONE transaction; a corrupt row
    // rolls the whole block back to a re-runnable v24. Literal table names
    // (the diagrams census).
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS library_folders (
          path TEXT PRIMARY KEY,
          position INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS library_folder_settings (
          root_path TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channel_folder_display_names (
          folder_name TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      const readSingle = (name) => {
        const row = sql.prepare('SELECT json FROM doc_single WHERE name = ?').get(name);
        return row ? JSON.parse(row.json) : undefined;
      };
      const folders = readSingle('folders');
      if (Array.isArray(folders)) {
        const upsert = sql.prepare(foldersDef.UPSERT_SQL);
        const kept = [];
        const seen = new Set();
        for (const entry of folders) {
          if (!isPersistableId(entry)) {
            console.error(`[db] migration v25: skipping a library folder entry no route could have written (${JSON.stringify(entry)})`);
            continue;
          }
          if (seen.has(entry)) {
            console.error(`[db] migration v25: collapsing a duplicate library folder entry (${JSON.stringify(entry)}) - the list has set semantics`);
            continue;
          }
          seen.add(entry);
          kept.push(entry);
        }
        kept.forEach((p, i) => upsert.run(p, i));
      } else if (folders !== undefined) {
        console.error('[db] migration v25: the folders row was not an array - dropped (an empty root list; loadDatabase() had been reading it as one)');
      }
      for (const [name, def] of [['folderSettings', folderSettingsDef], ['folderDisplayNames', folderDisplayNamesDef]]) {
        const map = readSingle(name);
        if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
          const upsert = sql.prepare(def.UPSERT_SQL);
          for (const key of Object.keys(map)) {
            if (!isPersistableId(key)) {
              console.error(`[db] migration v25: skipping a ${name} key no route could have written (${JSON.stringify(key)})`);
              continue;
            }
            upsert.run(...def.rowParams(key, map[key]));
          }
        } else if (map !== undefined) {
          console.error(`[db] migration v25: the ${name} row was not an object - dropped (loadDatabase() had been reading it as an empty map)`);
        }
      }
      sql.exec("DELETE FROM doc_single WHERE name IN ('folders', 'folderSettings', 'folderDisplayNames')");
      sql.exec('PRAGMA user_version = 25'); // this block's floor rides its own commit
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 26) {
    // Relational-migration arc Wave 4 (third group): the frozen pre-auth
    // likes leave doc_single for media_liked - one row per id, numbered by
    // array index (like order; a duplicate collapses keep-first, an
    // unaddressable entry is skipped with a log line). ONE transaction; a
    // corrupt row rolls the whole block back to a re-runnable v25. Literal
    // table name (the diagrams census).
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS media_liked (
          media_id TEXT PRIMARY KEY,
          position INTEGER NOT NULL
        );
      `);
      const row = sql.prepare("SELECT json FROM doc_single WHERE name = 'liked'").get();
      if (row) {
        const liked = JSON.parse(row.json);
        if (Array.isArray(liked)) {
          const upsert = sql.prepare(likedDef.UPSERT_SQL);
          const seen = new Set();
          let position = 0;
          for (const id of liked) {
            if (!isPersistableId(id)) {
              console.error(`[db] migration v26: skipping a liked entry no route could have written (${JSON.stringify(id)})`);
              continue;
            }
            if (seen.has(id)) {
              console.error(`[db] migration v26: collapsing a duplicate liked entry (${JSON.stringify(id)}) - the list has set semantics`);
              continue;
            }
            seen.add(id);
            upsert.run(id, position++);
          }
        } else if (liked !== null && liked !== undefined) {
          console.error('[db] migration v26: the liked row was not an array - dropped (loadDatabase() had been reading it as an empty list)');
        }
      }
      sql.exec("DELETE FROM doc_single WHERE name = 'liked'");
      sql.exec('PRAGMA user_version = 26'); // this block's floor rides its own commit
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 27) {
    // Relational-migration arc Wave 5 (tv): the Shows namespace leaves the
    // document model - tv_folders (the root list), tv_episodes (one row per
    // episode, verbatim), tv_settings (one row per key). The feature store's
    // backfill copies the doc rows (a wrong-shaped single dropped, an
    // unaddressable key skipped - each with a log line) and deletes them; ONE
    // transaction, the stamp inside it. Literal table names (the census).
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS tv_folders (
          path TEXT PRIMARY KEY,
          position INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tv_episodes (
          episode_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tv_settings (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      FEATURE_BY_NAME.get('tv').migrateFromDoc(sql, (m) => console.error(m.replace('[db] migration:', '[db] migration v27:')));
      sql.exec('PRAGMA user_version = 27');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 28) {
    // Relational-migration arc Wave 5 (music): music_folders, music_tracks,
    // music_settings, music_channels (the "show in Music" marks - a doc_single
    // MAP split into one row per folder). Same discipline as v27.
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS music_folders (
          path TEXT PRIMARY KEY,
          position INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS music_tracks (
          track_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS music_settings (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS music_channels (
          folder_name TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      FEATURE_BY_NAME.get('music').migrateFromDoc(sql, (m) => console.error(m.replace('[db] migration:', '[db] migration v28:')));
      sql.exec('PRAGMA user_version = 28');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 29) {
    // Relational-migration arc Wave 5 (books): books_folders, books_items,
    // books_progress (the frozen pre-auth reading positions), books_pins (the
    // frozen pre-auth shelf pins - an ordered record list), books_settings,
    // books_audio (TTS status). Same discipline as v27.
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS books_folders (
          path TEXT PRIMARY KEY,
          position INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS books_items (
          book_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS books_progress (
          book_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS books_pins (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS books_settings (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS books_audio (
          book_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      FEATURE_BY_NAME.get('books').migrateFromDoc(sql, (m) => console.error(m.replace('[db] migration:', '[db] migration v29:')));
      sql.exec('PRAGMA user_version = 29');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 30) {
    // Relational-migration arc Wave 5 (podcasts): podcasts_subscriptions (an
    // ordered record list - the array order the routes sort by), podcasts_episodes
    // (one row per episode: the download ARCHIVE, tombstones included - the
    // "deleted stays gone" law rides the rows now), podcasts_settings. Same
    // discipline as v27. Feed URLs were never in the db and are not now.
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS podcasts_subscriptions (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS podcasts_episodes (
          episode_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS podcasts_settings (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      FEATURE_BY_NAME.get('podcasts').migrateFromDoc(sql, (m) => console.error(m.replace('[db] migration:', '[db] migration v30:')));
      sql.exec('PRAGMA user_version = 30');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 31) {
    // Relational-migration arc Wave 5 (ytdlp - the last container):
    // ytdlp_subscriptions and ytdlp_pins (ordered record lists), ytdlp_download_meta
    // (the download->scan channel-identity bridge, one row per capture; its
    // keys are video ids, '<extractor> <id>' composites or rendered basenames),
    // ytdlp_channel_avatars (one row per channel id), ytdlp_settings (the
    // allowMembersOnly flag's home - an internal table, never a namespace key).
    // Same discipline as v27. After this block no doc_single name and only
    // the `metadata` doc_kv namespace remain.
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS ytdlp_subscriptions (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ytdlp_pins (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ytdlp_download_meta (
          meta_key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ytdlp_channel_avatars (
          channel_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ytdlp_settings (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      // A subscription record without an id would fall through the record
      // list's id floor. Every route-written record has carried
      // `id = md5(normalizedChannelUrl)` since v1.20, but a hand-edited
      // legacy file could not; mint the id addSubscription would have (the SAME
      // normalisation, so a later re-add of the channel hits the `existing`
      // branch instead of creating a duplicate), rather than drop the channel.
      const subsRow = sql.prepare("SELECT json FROM doc_single WHERE name = 'ytdlp.subscriptions'").get();
      if (subsRow) {
        const list = JSON.parse(subsRow.json);
        const minted = mintLegacyYtdlpSubscriptionIds(list);
        if (minted > 0) {
          sql.prepare("UPDATE doc_single SET json = ? WHERE name = 'ytdlp.subscriptions'").run(JSON.stringify(list));
          console.error(`[db] migration v31: minted ids for ${minted} yt-dlp subscription record(s) that had none`);
        }
      }
      // The flag is a boolean everywhere it is read (ensureYtdlp coerces); a
      // non-boolean doc row (a hand edit) is coerced HERE so the table never
      // carries a shape the bundle validator would refuse on the way back in.
      const flagRow = sql.prepare("SELECT json FROM doc_single WHERE name = 'ytdlp.allowMembersOnly'").get();
      if (flagRow && flagRow.json !== 'true' && flagRow.json !== 'false') {
        sql.prepare("UPDATE doc_single SET json = ? WHERE name = 'ytdlp.allowMembersOnly'").run(JSON.parse(flagRow.json) === true ? 'true' : 'false');
        console.error('[db] migration v31: the yt-dlp allowMembersOnly flag was not a boolean - coerced');
      }
      FEATURE_BY_NAME.get('ytdlp').migrateFromDoc(sql, (m) => console.error(m.replace('[db] migration:', '[db] migration v31:')));
      sql.exec('PRAGMA user_version = 31');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 32) {
    // Relational-migration arc Wave 6: the media index - `metadata`, the LAST
    // doc_kv namespace - moves to media_items (media_id, json), one row per
    // indexed file, the json VERBATIM and in rowid order (lib/media/items.js).
    // Same discipline as v27: the block creates the table, copies the rows,
    // deletes the doc rows and stamps its own floor inside ONE transaction; a
    // corrupt row rolls it back whole to a re-runnable v31. After this block
    // doc_kv and doc_single are both EMPTY (Wave 7 drops them).
    sql.exec('BEGIN');
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS media_items (
          media_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      const moved = itemsDef.migrateFromDoc(sql, (m) => console.error(m.replace('[db] migration:', '[db] migration v32:')));
      if (moved > 0) console.error(`[db] migration v32: moved ${moved} media item(s) into media_items`);
      sql.exec('PRAGMA user_version = 32');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  if (current < 33) {
    // Relational-migration arc Wave 7: the document model's two tables are
    // DROPPED. Every namespace left them one wave at a time (v21-v32, each
    // block backfilling its table and deleting its doc rows in ONE
    // transaction), so at v32 both are empty by construction. A row that is
    // nonetheless here is bytes no build since its namespace's wave could
    // read - and bytes this block will not destroy unseen: it REFUSES, names
    // what it found, and leaves the database at v32 (re-runnable), so the
    // operator can export or delete the rows deliberately. The v1 block still
    // CREATES the two tables (append-only: a fresh database runs every block
    // in order, the drains included), so they exist between v1 and here.
    const strays = [
      ...sql.prepare('SELECT namespace AS name, COUNT(*) AS n FROM doc_kv GROUP BY namespace ORDER BY namespace').all()
        .map((r) => `doc_kv namespace '${r.name}' (${r.n} row(s))`),
      ...sql.prepare('SELECT name, COUNT(*) AS n FROM doc_single GROUP BY name ORDER BY name').all()
        .map((r) => `doc_single name '${r.name}' (${r.n} row(s))`),
    ];
    if (strays.length > 0) {
      throw new Error(
        `FileTube database migration v33 refuses to drop the document tables while they still hold rows: ${strays.join('; ')}. `
        + 'No FileTube build reads these rows any more (every namespace moved to its own table in v21-v32). Export or delete them with '
        + 'the sqlite3 CLI (tables doc_kv and doc_single in filetube.db), then start FileTube again. The database is unchanged and '
        + 'still opens on v1.295.x.'
      );
    }
    sql.exec('BEGIN');
    try {
      sql.exec('DROP TABLE IF EXISTS doc_kv');
      sql.exec('DROP TABLE IF EXISTS doc_single');
      sql.exec('PRAGMA user_version = 33');
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }
  sql.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// WAL is persistent in the file. On a filesystem without shared-memory
// semantics (network FS) the pragma comes back non-'wal'; fall back to
// DELETE with one honest log line — DATA_DIR is expected to be local
// storage (exec plan, import step 6).
// Adversarial CRITICAL-1 (measured on both Node 22 and 24): SQLite returns
// SQLITE_BUSY for a journal-mode CHANGE **without invoking the busy handler**,
// so `PRAGMA busy_timeout` - which covers every other statement on this
// connection - does NOT cover this one. It fails instantly at 0 ms. That is
// reachable in PRODUCTION, not just tests: any boot where the db is not already
// WAL (a first boot on a fresh DATA_DIR, or every boot on a filesystem where the
// DELETE fallback below sticks) would throw out of openAdapter and the server
// would never start. So the retry is explicit here, bounded by the same budget.
// The wait is a real SLEEP, not a spin: my own probe caught the first cut
// hot-looping (100% CPU for the whole budget). Atomics.wait on a throwaway
// SharedArrayBuffer is the standard synchronous sleep - node:sqlite is
// synchronous anyway, so the calling thread is already the one waiting.
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    return true;
  } catch (_) {
    // Adversarial S (carry): swallowing this would reinstate the hot spin we just
    // removed - burning a core for the whole budget. If we cannot sleep, we do not
    // retry at all; the caller rethrows the original SQLITE_BUSY.
    return false;
  }
}

function switchJournalMode(sql, pragma, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      return sql.prepare(pragma).get();
    } catch (err) {
      // (err.errcode & 0xff) === 5 catches the EXTENDED busy codes too
      // (SQLITE_BUSY_SNAPSHOT 517, SQLITE_BUSY_RECOVERY 261) - a plain === 5 would
      // silently make this retry inert if node:sqlite ever surfaces them (QA S1).
      if (!err || (err.errcode & 0xff) !== 5 || Date.now() >= deadline) throw err; // not SQLITE_BUSY, or out of budget
      if (!sleepSync(25)) throw err; // SQLITE_BUSY: wait, don't burn the CPU (and never spin if we cannot wait)
    }
  }
}

function applyJournalMode(sql, log) {
  const mode = switchJournalMode(sql, 'PRAGMA journal_mode = WAL', BUSY_TIMEOUT_MS).journal_mode;
  if (mode !== 'wal') {
    switchJournalMode(sql, 'PRAGMA journal_mode = DELETE', BUSY_TIMEOUT_MS);
    if (log) log(`[db] WAL unavailable on this filesystem (got '${mode}'); using DELETE journal mode. DATA_DIR is expected to be local storage.`);
  }
  return mode;
}

// tech-debt #202 (trigger fired 2026-09-04 after a 2nd occurrence): node:sqlite's
// default busy timeout is ZERO, so ANY momentary contention fails instantly with
// SQLITE_BUSY (errcode 5) instead of waiting.
//
// The MEASURED mechanism. This wave got it WRONG TWICE before this; the version
// below is the QA seat's, reproduced on BOTH Node 22 and Node 24, and it is the
// one to trust:
//
//  - Parallel PROCESSES opening the same db file each run `PRAGMA journal_mode
//    = WAL` during startup. That statement contends with other openers even on
//    an ALREADY-WAL db with NO writer anywhere: 200 concurrent plain open+read
//    processes at timeout 0 produced 9/200 failures on Node 22 and 5/200 on
//    Node 24, every one at journal_mode with errcode 5 - the exact signature of
//    the #202 crash. (An earlier write-up here claimed a concurrent WRITER was
//    required. It is not. A writer only makes it likelier.)
//  - journal_mode is not merely "the first statement that takes a lock" - it is
//    the UNIQUELY UNPROTECTED one: with a 5000ms timeout armed, a contended
//    mode change still threw at 0ms while an ordinary contended INSERT on the
//    SAME connection waited ~3000ms and succeeded.
//  - Therefore the two halves of this fix protect different things, and neither
//    substitutes for the other: BUSY_TIMEOUT_MS covers every ordinary statement;
//    the journal-mode statement is covered ONLY by switchJournalMode's retry.
//    With both, the same 200-process stress gives 0/200 failures on both Nodes.
//  - The writer-present arm (context, not the mechanism): 14 processes x 30
//    cycles at timeout 0 gave 21 journal_mode + 327 write failures over 420
//    iterations; with this fix, 0.
//
// Five seconds is far longer than any lock this app holds (every write is a short
// chained tick) and still fails loudly rather than hanging if something truly
// wedges. NOTE (adversarial S5): node:sqlite is synchronous, so a wait BLOCKS the
// event loop - the right trade for a single-instance app, tracked in #205 with a
// revisit trigger of multi-instance / shared-volume DATA_DIR support.
const BUSY_TIMEOUT_MS = 5000;

function openConnection(dbPath) {
  const sql = new DatabaseSync(dbPath);
  sql.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`); // BEFORE any lock-taking statement
  sql.exec('PRAGMA foreign_keys = ON');
  return sql;
}

// ---- the adapter ------------------------------------------------------------

class SqliteAdapter {
  // `log` is injected (defaults to console.error to match server.js's own
  // logging posture) so tests can capture boot lines without spying globals.
  constructor(dbPath, { log = console.error } = {}) {
    this.dbPath = dbPath;
    this.log = log;
    this.sql = openConnection(dbPath);
    // QA S2: this wave widened the throw window from ~0ms to up to 10s (a 5s WAL
    // leg + a 5s DELETE leg), so a failed open must not leave the handle - and
    // its file lock - behind. Production dies at boot either way; a test that
    // catches and continues would otherwise hold a lock on its temp db.
    try {
      applyJournalMode(this.sql, log);
      migrateSchema(this.sql);
    } catch (err) {
      try { this.sql.close(); } catch (_) { /* already dead */ }
      throw err;
    }
    // Prepared statements are created only AFTER migrations complete (design
    // review F8c) — preparing against pre-migration schema is a stale-handle
    // class.
    this.stmts = {
      // Wave 1: the restore/reset primitive's only write to the relational
      // media namespace (the store module owns every runtime write).
      upsertViewCount: this.sql.prepare(VIEW_COUNT_UPSERT_SQL),
      // Wave 2: the record tables' restore/reset writes (same posture).
      upsertProgress: this.sql.prepare(progressDef.UPSERT_SQL),
      upsertTombstone: this.sql.prepare(tombstoneDef.UPSERT_SQL),
      upsertTrash: this.sql.prepare(trashDef.UPSERT_SQL), // Wave 3
      upsertSetting: this.sql.prepare(settingsDef.UPSERT_SQL), // Wave 4
      upsertFolder: this.sql.prepare(foldersDef.UPSERT_SQL), // Wave 4
      upsertFolderSetting: this.sql.prepare(folderSettingsDef.UPSERT_SQL), // Wave 4
      upsertFolderDisplayName: this.sql.prepare(folderDisplayNamesDef.UPSERT_SQL), // Wave 4
      upsertLiked: this.sql.prepare(likedDef.UPSERT_SQL), // Wave 4
    };
    // Wave 6: the media index's store - the ONLY writer of media_items. Its
    // per-row diff base (the snapshot of the LAST COMMIT that `save()` diffs
    // against) is rebuilt from disk here (open) and by `exclusiveReplace`
    // (restore).
    this.items = itemsDef.createItemsStore(this);
    this.inTransaction = false;
    this.rebuildSnapshotFromDisk();
  }

  rebuildSnapshotFromDisk() {
    this.items.rebuildSnapshot();
  }

  // Nested `BEGIN` throws in SQLite ("cannot start a transaction within a
  // transaction" — re-verified 2026-07-17 on both binaries), so the adapter
  // guards its own nesting explicitly for a clearer failure than SQLite's.
  begin() {
    if (this.inTransaction) {
      throw new Error('SqliteAdapter: re-entrant transaction (BEGIN inside BEGIN) — the write path must never nest');
    }
    this.sql.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
  }

  commit() {
    this.sql.exec('COMMIT');
    this.inTransaction = false;
  }

  rollback() {
    try {
      this.sql.exec('ROLLBACK');
    } finally {
      this.inTransaction = false;
    }
  }

  // Assemble the in-memory DB object: the media index from its table, in
  // rowid order, own properties only. ABSENCE is preserved: an empty index
  // contributes nothing, so an empty database assembles to `{}` and
  // server.js's loadDatabase re-applies its backfills (`metadata: {}`) on
  // every load - the empty-is-absent normalization the document model had,
  // kept because the 150 read sites were written against it.
  load() {
    const db = {};
    const items = this.items.getAll();
    if (Object.keys(items).length > 0) db.metadata = items;
    return db;
  }

  // The unknown-key lock: a mutator that grows a namespace this adapter
  // doesn't know about must FAIL the write loudly, not have its data
  // silently dropped by the diff. (Silent partial persistence is the
  // 5-strike persist-gate class in its most dangerous costume.)
  assertNoUnknownKeys(db) {
    for (const key of Object.keys(db)) {
      if (!KNOWN_TOP_LEVEL.has(key)) {
        throw new Error(`SqliteAdapter: unknown top-level db key '${key}' — add it to the schema map in lib/db/sqlite.js (deliberately, with a test) before persisting it`);
      }
    }
  }

  // Diff-save: the media index (lib/media/items.js) plans its own per-row
  // diff - an absent `metadata` key plans nothing (rows kept), a present map
  // is compared row by row - and the plan is applied in ONE transaction with
  // every carrier effect; the diff base advances only after COMMIT, so a
  // failed save leaves it pointing at what is actually on disk. Returns
  // write accounting for tests/AC5. Synchronous throughout — the caller
  // (server.js saveDatabase) keeps its single-tick critical-section contract.
  // Wave 2: `alsoInTransaction` - an optional callback run INSIDE the save's
  // transaction, after the index rows and before COMMIT, so a relational
  // write that must be atomic with the commit (a delete's tombstone mint, a
  // move's tombstone retirement) rides the same BEGIN/COMMIT: a throw rolls
  // both back, a crash leaves both or neither. The feature stores' tx()
  // sees `inTransaction` and joins. With a callback present the save
  // transaction opens even when the index is unchanged.
  save(db, { alsoInTransaction = null } = {}) {
    this.assertNoUnknownKeys(db);
    const itemsPlan = this.items.planDiff(db.metadata);
    const itemChanges = itemsPlan.writes.length + itemsPlan.deletes.length;
    if (itemChanges === 0 && !alsoInTransaction) {
      return { rowsWritten: 0, rowsDeleted: 0 };
    }
    this.begin();
    try {
      this.items.applyPlan(itemsPlan);
      if (alsoInTransaction) alsoInTransaction();
      this.commit();
    } catch (err) {
      this.rollback();
      throw err;
    }
    this.items.advancePlan(itemsPlan);
    return { rowsWritten: itemsPlan.writes.length, rowsDeleted: itemsPlan.deletes.length };
  }

  // Restore path (instance-bundle restore): wipe-and-replace inside ONE
  // transaction via a caller-provided populate function, then rebuild the
  // snapshot from disk so the diff base can never lie about what the last
  // commit contained (exec plan: "the write accounting would lie
  // otherwise"). The CALLER owns the surrounding coherency work — clearing
  // the progress coalescers and invalidating dbCache (design review F5).
  exclusiveReplace(populateFn) {
    this.begin();
    try {
      this.sql.exec(`DELETE FROM ${itemsDef.TABLE}`); // Wave 6: the media index
      // Wave 1: the wipe covers every table a bundle repopulates, the
      // relational media namespace included - a restore is "the bundle and
      // nothing else", and the between-test reset relies on the same wipe.
      this.sql.exec(`DELETE FROM ${VIEW_COUNTS_TABLE}`);
      // Wave 2: the record tables are wiped by the same rule.
      this.sql.exec(`DELETE FROM ${progressDef.TABLE}`);
      this.sql.exec(`DELETE FROM ${tombstoneDef.TABLE}`);
      this.sql.exec(`DELETE FROM ${trashDef.TABLE}`); // Wave 3
      this.sql.exec(`DELETE FROM ${settingsDef.TABLE}`); // Wave 4
      this.sql.exec(`DELETE FROM ${foldersDef.TABLE}`); // Wave 4
      this.sql.exec(`DELETE FROM ${folderSettingsDef.TABLE}`); // Wave 4
      this.sql.exec(`DELETE FROM ${folderDisplayNamesDef.TABLE}`); // Wave 4
      this.sql.exec(`DELETE FROM ${likedDef.TABLE}`); // Wave 4
      for (const def of FEATURE_DEFS) for (const t of def.tables) this.sql.exec(`DELETE FROM ${t.table}`); // Wave 5
      populateFn({
        // Wave 6: one media item, the record verbatim (the store's own id rule).
        insertItem: (id, record) => {
          if (record === undefined) throw new Error(`exclusiveReplace: media item '${id}' is undefined`);
          this.items.set(id, record);
        },
        insertViewCount: (id, count) => {
          assertRowKeySafe('viewCounts', id);
          // Safe-integer ceiling: a value past 2^53 would make every read of
          // the table throw (adversarial W1) - refuse, never land it.
          if (!Number.isInteger(count) || count < 0 || count > Number.MAX_SAFE_INTEGER) throw new Error(`exclusiveReplace: view count for '${id}' must be a non-negative safe integer`);
          this.stmts.upsertViewCount.run(id, count);
        },
        // Wave 2: verbatim records; the store's row builder derives the typed columns.
        insertProgress: (id, record) => {
          assertRowKeySafe('progress', id);
          if (record === undefined) throw new Error(`exclusiveReplace: progress record for '${id}' is undefined`);
          this.stmts.upsertProgress.run(...progressDef.rowParams(id, record));
        },
        insertTombstone: (id, record) => {
          assertRowKeySafe('deleteTombstones', id);
          if (record === undefined) throw new Error(`exclusiveReplace: tombstone record for '${id}' is undefined`);
          this.stmts.upsertTombstone.run(...tombstoneDef.rowParams(id, record));
        },
        insertTrash: (id, record) => {
          assertRowKeySafe('trash', id);
          if (record === undefined) throw new Error(`exclusiveReplace: trash record for '${id}' is undefined`);
          this.stmts.upsertTrash.run(...trashDef.rowParams(id, record));
        },
        // Wave 4: one row per setting key, the value verbatim.
        insertSetting: (key, value) => {
          assertRowKeySafe('settings', key);
          if (value === undefined) throw new Error(`exclusiveReplace: settings value for '${key}' is undefined`);
          this.stmts.upsertSetting.run(key, JSON.stringify(value));
        },
        // Wave 4: the folder config. The root list lands whole (validated,
        // exact duplicates collapsed, numbered from 0); the two maps one row
        // per key, the value verbatim.
        replaceFolders: (list) => {
          foldersDef.normalizeList(list).forEach((p, i) => this.stmts.upsertFolder.run(p, i));
        },
        insertFolderSetting: (key, record) => {
          assertRowKeySafe('folderSettings', key);
          if (record === undefined) throw new Error(`exclusiveReplace: folderSettings record for '${key}' is undefined`);
          this.stmts.upsertFolderSetting.run(...folderSettingsDef.rowParams(key, record));
        },
        insertFolderDisplayName: (key, record) => {
          assertRowKeySafe('folderDisplayNames', key);
          if (record === undefined) throw new Error(`exclusiveReplace: folderDisplayNames record for '${key}' is undefined`);
          this.stmts.upsertFolderDisplayName.run(...folderDisplayNamesDef.rowParams(key, record));
        },
        // Wave 4: the frozen likes land whole, in like order.
        replaceLiked: (list) => {
          likedDef.normalizeList(list).forEach((id, i) => this.stmts.upsertLiked.run(id, i));
        },
        // Wave 5: a content module's whole namespace, refuse-whole, inside
        // this open transaction (the feature store joins it).
        replaceFeature: (name, ns) => {
          const def = FEATURE_BY_NAME.get(name);
          if (!def) throw new Error(`exclusiveReplace: unknown feature '${name}'`);
          def.createStore(this).replaceAll(ns);
        },
      });
      this.commit();
    } catch (err) {
      this.rollback();
      throw err;
    }
    this.rebuildSnapshotFromDisk();
  }

  close() {
    this.sql.close();
  }
}

// ---- restore: the bundle classifier; boot: open / fresh ---------------------

// Strict import-time classifier: which source top-level keys map where.
// Unknown keys in the SOURCE abort the import (never silently dropped — a
// source written by a NEWER FileTube than this binary must not lose data
// through a lossy import; the operator sees the key name and can sort out
// the version mismatch). One caller since Wave 7: the instance-bundle
// restore (server.js, through exclusiveReplace's handles). Until v1.295 the
// one-time boot import of the legacy JSON file was the second caller - a legacy
// source carried `viewCount` EMBEDDED on media items, and the extraction
// below still lifts it out, because a bundle exported by a pre-Wave-1 build
// carries the same embedded shape; a newer bundle carries `viewCounts` as a
// first-class { id: count } key and it must round-trip. Wave 1: both shapes
// land in the `media_view_counts` TABLE through the caller's
// `insertViewCount` handle. `source` is accepted and IGNORED (signature
// stability); it is no longer a branch.
function importParsedJson(parsed, handles, { source = 'bundle' } = {}) {
  void source;
  const summary = {};
  const count = (ns, n) => { summary[ns] = (summary[ns] || 0) + n; };

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_TOP_LEVEL.has(key) && !RELATIONAL_IMPORT_KEYS.has(key)) {
      throw new Error(`import: the source contains unknown top-level key '${key}' — refusing a lossy import (was this file written by a newer FileTube?)`);
    }
  }
  // Wave 1: a relational-routed key needs its handle, or the import would
  // silently drop the one non-rebuildable field (refuse loudly instead).
  const insertViewCount = handles.insertViewCount;
  const routeViewCount = (id, value) => {
    if (typeof insertViewCount !== 'function') {
      throw new Error('import: this source carries view counts but no insertViewCount handle was provided — refusing a lossy import');
    }
    assertRowKeySafe('viewCounts', id);
    insertViewCount(id, value);
  };
  // A bundle may carry `viewCounts` first-class:
  // { id: count }. Shape-checked HERE, before any row is written (refuse
  // before the wipe); ROUTED after the doc namespaces below, so when a source
  // carries both the first-class key and a legacy embedded `item.viewCount`
  // for the same id, the first-class key is authoritative (the pre-Wave-1
  // order applied it last too - gate S2/S5 caught the flip) and the summary
  // counts each id once.
  const firstClass = parsed.viewCounts;
  if (firstClass !== undefined && firstClass !== null && (typeof firstClass !== 'object' || Array.isArray(firstClass))) {
    throw new Error("import: namespace 'viewCounts' is not an object — refusing");
  }
  const firstClassHas = (id) => firstClass != null && Object.prototype.hasOwnProperty.call(firstClass, id) && usableCount(firstClass[id]) !== null;
  // Wave 2: the id-keyed RECORD namespaces. Shape-checked here (a per-key map,
  // NUL-free ids, no undefined values - a record of ANY other shape is legal,
  // it is copied verbatim), routed after the doc namespaces below through the
  // caller's handle; a source that carries one without its handle is refused.
  const recordRoutes = [];
  for (const route of RECORD_IMPORT_ROUTES) {
    const map = parsed[route.key];
    if (map === undefined || map === null) continue;
    if (typeof map !== 'object' || Array.isArray(map)) {
      throw new Error(`import: namespace '${route.key}' is not an object — refusing`);
    }
    for (const id of Object.keys(map)) {
      assertRowKeySafe(route.key, id);
      if (map[id] === undefined) throw new Error(`import: namespace '${route.key}' carries an undefined record for '${id}' — refusing`);
    }
    if (Object.keys(map).length > 0 && typeof handles[route.handle] !== 'function') {
      throw new Error(`import: this source carries '${route.key}' but no ${route.handle} handle was provided — refusing a lossy import`);
    }
    recordRoutes.push({ route, map });
  }
  // Wave 4: `folders` is an ORDERED LIST of root paths (library_folders), not
  // a map - validated whole here (non-empty NUL-free strings; an exact
  // duplicate collapses keep-first, the list's set semantics), routed after
  // the doc keys through replaceFolders; a source that carries a non-empty
  // list without the handle is refused.
  let folderList = null;
  if (parsed.folders !== undefined && parsed.folders !== null) {
    if (!Array.isArray(parsed.folders)) throw new Error("import: 'folders' is not an array — refusing");
    folderList = foldersDef.normalizeList(parsed.folders);
    if (folderList.length > 0 && typeof handles.replaceFolders !== 'function') {
      throw new Error("import: this source carries 'folders' but no replaceFolders handle was provided — refusing a lossy import");
    }
  }
  // Wave 4: `liked` - the frozen pre-auth likes, the same ordered-list rule.
  let likedList = null;
  if (parsed.liked !== undefined && parsed.liked !== null) {
    if (!Array.isArray(parsed.liked)) throw new Error("import: 'liked' is not an array — refusing");
    likedList = likedDef.normalizeList(parsed.liked);
    if (likedList.length > 0 && typeof handles.replaceLiked !== 'function') {
      throw new Error("import: this source carries 'liked' but no replaceLiked handle was provided — refusing a lossy import");
    }
  }
  // Wave 5: a relational feature container ({ folders, episodes, settings, ... })
  // is validated for shape here (an object; only the parts the feature knows)
  // and written whole through replaceFeature after the doc keys; a source
  // that carries one without the handle is refused.
  const featureRoutes = [];
  for (const def of FEATURE_DEFS) {
    const obj = parsed[def.name];
    if (obj === undefined || obj === null) continue;
    if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`import: namespace '${def.name}' is not an object — refusing`);
    for (const part of Object.keys(obj)) {
      if (!def.parts[part]) throw new Error(`import: the source contains unknown key '${def.name}.${part}' — refusing a lossy import (was this file written by a newer FileTube?)`);
    }
    if (def.name === 'ytdlp') {
      // The same repair the v31 migration applies (gate pass B, adversarial
      // W4): a legacy id-less subscription is minted an id, never a refusal.
      const minted = mintLegacyYtdlpSubscriptionIds(obj.subscriptions);
      if (minted > 0) console.error(`[db] import: minted ids for ${minted} yt-dlp subscription record(s) that had none`);
    }
    if (typeof handles.replaceFeature !== 'function') throw new Error(`import: this source carries '${def.name}' but no replaceFeature handle was provided — refusing a lossy import`);
    featureRoutes.push({ def, obj });
  }
  // Wave 6: the media index routes to media_items through the `insertItem`
  // handle (a bundle carries it as `metadata`, the doc-object key).
  const metadataObj = parsed.metadata;
  if (metadataObj !== undefined && metadataObj !== null) {
    // A per-key namespace must BE a per-key map. Without this, a string
    // value would iterate Object.keys('...') into per-character garbage
    // rows — silent corruption instead of the loud refusal this importer
    // promises (delta-round residual, adversarial seat).
    if (typeof metadataObj !== 'object' || Array.isArray(metadataObj)) {
      throw new Error("import: namespace 'metadata' is not an object — refusing");
    }
    if (Object.keys(metadataObj).length > 0 && typeof handles.insertItem !== 'function') throw new Error('import: this source carries media items but no insertItem handle was provided — refusing a lossy import');
    const obj = metadataObj;
    {
      // The one documented transform (design finding #8 / review F4):
      // `metadata[id].viewCount` is EXTRACTED off the item — it is the single
      // non-rebuildable field embedded in a rebuildable namespace, and in
      // place it is demonstrably clobber-prone (the scan's Phase-2 merge and
      // changed-file re-init both drop it). Items are stored WITHOUT the
      // field; the count goes to the media_view_counts TABLE through the
      // insertViewCount handle (Wave 1; v1.42-v1.290 it went to the
      // `viewCounts` doc namespace). A first-class `viewCounts[id]` in the
      // same source wins over the embedded value (routed below, after this).
      // Everything else on an item migrates verbatim.
      let extracted = 0;
      for (const id of Object.keys(obj)) {
        assertRowKeySafe('metadata', id);
        const item = obj[id];
        if (item != null && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'viewCount')) {
          const { viewCount, ...rest } = item;
          const usable = usableCount(viewCount);
          if (usable !== null && !firstClassHas(id)) {
            routeViewCount(id, usable);
            extracted++;
          }
          handles.insertItem(id, rest);
        } else {
          handles.insertItem(id, item);
        }
      }
      count('metadata', Object.keys(obj).length);
      if (extracted) count('viewCounts', extracted);
    }
  }
  // Wave 2: the record namespaces, verbatim, through their handles.
  for (const { route, map } of recordRoutes) {
    let n = 0;
    for (const id of Object.keys(map)) {
      handles[route.handle](id, map[id]);
      n++;
    }
    if (n) count(route.key, n);
  }
  if (folderList && folderList.length > 0) {
    handles.replaceFolders(folderList); // Wave 4
    count('folders', folderList.length);
  }
  if (likedList && likedList.length > 0) {
    handles.replaceLiked(likedList); // Wave 4
    count('liked', likedList.length);
  }
  for (const { def, obj } of featureRoutes) {
    handles.replaceFeature(def.name, obj); // Wave 5
    for (const part of Object.keys(obj)) {
      const v = obj[part];
      const n = Array.isArray(v) ? v.length : (v && typeof v === 'object') ? Object.keys(v).length : 1;
      if (n) count(`${def.name}.${part}`, n);
    }
  }
  // The first-class key, LAST (authoritative over an embedded value - see
  // above). Same "usable value or dropped" rule as the extraction.
  if (firstClass != null) {
    let n = 0;
    for (const id of Object.keys(firstClass)) {
      const value = usableCount(firstClass[id]);
      if (value === null) continue;
      routeViewCount(id, value);
      n++;
    }
    if (n) count('viewCounts', n);
  }
  return summary;
}

// Boot: open DATA_DIR/filetube.db - creating the fresh empty schema when the
// file is absent - and return the adapter. Wave 7 of the relational-migration
// arc REMOVED boot rule 2 (v1.42-v1.295: the legacy JSON file beside a missing
// filetube.db was imported once, WAL-safely, then ignored forever). The
// upgrade path from a pre-v1.42 instance is now: run any v1.42-v1.295 build
// once (it imports), then upgrade. Nothing in this function names, probes or
// reads any other file in DATA_DIR - a legacy file beside the database is
// invisible to boot (test/unit/dbjson-never-read.test.js binds that with an
// fs spy on every content reader AND every metadata probe). The return shape
// keeps the one key callers destructure.
function openAdapter(dataDir, { log = console.error } = {}) {
  const adapter = new SqliteAdapter(path.join(dataDir, SQLITE_FILENAME), { log });
  return { adapter };
}

// Test helper (exec plan "test migration plan"): the one sanctioned way for
// tests to read persisted state — it replaced every raw read of the legacy
// file across the 43 direct-I/O test files at v1.42. Opens its OWN read-only
// connection (not the adapter's — AC5's verification explicitly distrusts the
// adapter's accounting), assembles every table under the key the doc object
// had for it, closes.
function readPersistedDatabase(dataDir) {
  const dbPath = path.join(dataDir, SQLITE_FILENAME);
  const sql = new DatabaseSync(dbPath, { readOnly: true });
  sql.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`); // adversarial S3: EVERY opener, not just openConnection
  try {
    const db = {};
    // Wave 6: the media index from its table, under the old key, when rows exist.
    const items = itemsDef.readPersisted(sql);
    if (items !== undefined) db.metadata = items;
    // Wave 1: the relational media namespace rides the same test read, in the
    // same { id: count } shape it had as a doc namespace - so a test that
    // asserts "the count followed the move / was reaped with the delete" reads
    // the REAL table through this independent connection. Present only when
    // rows exist (the empty-is-absent normalization every doc_kv namespace has).
    const counts = sql.prepare(`SELECT media_id, count FROM ${VIEW_COUNTS_TABLE} ORDER BY media_id`).all();
    if (counts.length > 0) {
      const obj = {};
      for (const row of counts) defineRowProperty(obj, row.media_id, row.count);
      db.viewCounts = obj;
    }
    // Wave 2: the record tables, same rule (present only when rows exist).
    for (const [key, table] of [['progress', progressDef.TABLE], ['deleteTombstones', tombstoneDef.TABLE], ['trash', trashDef.TABLE]]) {
      const rows = sql.prepare(`SELECT media_id, json FROM ${table} ORDER BY media_id`).all();
      if (rows.length === 0) continue;
      const obj = {};
      for (const row of rows) defineRowProperty(obj, row.media_id, JSON.parse(row.json));
      db[key] = obj;
    }
    // Wave 4: the app settings, as the RAW rows (what was set - the store
    // merges the defaults on read, this test seam does not), under the old
    // key when rows exist.
    const settingRows = sql.prepare(`SELECT key, json FROM ${settingsDef.TABLE} ORDER BY key`).all();
    if (settingRows.length > 0) {
      const obj = {};
      for (const row of settingRows) defineRowProperty(obj, row.key, JSON.parse(row.json));
      db.settings = obj;
    }
    // Wave 4: the folder config - the root list in position order (present
    // only when rows exist), the two maps under their old keys.
    const folderRows = sql.prepare(`SELECT path FROM ${foldersDef.TABLE} ORDER BY position, path`).all();
    if (folderRows.length > 0) db.folders = folderRows.map((r) => r.path);
    const likedRows = sql.prepare(`SELECT media_id FROM ${likedDef.TABLE} ORDER BY position, media_id`).all();
    if (likedRows.length > 0) db.liked = likedRows.map((r) => r.media_id); // Wave 4: the frozen likes, in like order
    // Wave 5: the feature containers, assembled from their tables (absent when every part is empty).
    for (const def of FEATURE_DEFS) {
      const ns = def.readPersisted(sql);
      if (ns !== undefined) db[def.name] = ns;
    }
    for (const [key, def, col] of [['folderSettings', folderSettingsDef, 'root_path'], ['folderDisplayNames', folderDisplayNamesDef, 'folder_name']]) {
      const rows = sql.prepare(`SELECT ${col} AS id, json FROM ${def.TABLE} ORDER BY ${col}`).all();
      if (rows.length === 0) continue;
      const obj = {};
      for (const row of rows) defineRowProperty(obj, row.id, JSON.parse(row.json));
      db[key] = obj;
    }
    return db;
  } finally {
    sql.close();
  }
}

module.exports = {
  SQLITE_FILENAME,
  DOC_OBJECT_KEYS, // Wave 6: the doc object's keys - just `metadata`, a table behind lib/media/items.js (Wave 7: the only namespace list left)
  mintLegacyYtdlpSubscriptionIds, // Wave 5 (gate pass B): the id repair every entry seam applies
  FEATURE_DEFS, // Wave 5
  // v1.127: exported so version assertions in tests track the current schema
  // instead of rotting as literals (14 sites said `17` before the v18 bump).
  SCHEMA_VERSION,
  SqliteAdapter,
  openAdapter,
  readPersistedDatabase,
  // exported for direct unit coverage of the import classifier
  importParsedJson,
  // v1.266: a RAW connection with NO migration or journal-mode side effects.
  // Test-only, and it exists to SERVE the source lock rather than dodge it: the
  // #202 behavioural test must seed a specific journal mode and hold a real
  // cross-process write lock, and the lock's contract is that every SQLite API
  // touch lives in THIS file. Production code must never call it - openAdapter
  // is the only sanctioned door.
  __openRawForTests: openConnection,
  // Wave 7: the dropped document tables' DDL, for the migration tests' rewinds
  // (test/helpers/legacy-doc-tables.js) - production has no caller.
  __LEGACY_DOC_TABLES_DDL_FOR_TESTS: LEGACY_DOC_TABLES_DDL,
};
