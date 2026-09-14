'use strict';

// lib/admin/backup.js - the instance BACKUP and RESTORE surface, moved VERBATIM
// out of server.js in Wave 7b, slice S7, of the relational-migration arc
// (docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md): GET
// /api/admin/backup, POST /api/admin/restore, the two bundle validators, the
// three bundle-format constants, the mid-populate test seam and the pure
// store-only zip builder. Every body is byte-identical to its server.js
// original and keeps its source order; the free identifiers resolve from the
// `deps` bundles server.js hands in (the lib/ytdlp + lib/podcasts
// registerRoutes pattern, with the R3 factory for the non-route functions). A
// missing dep is a hard failure (a destructured undefined that is later called
// throws), never a silent fallback.
//
// THREE entry points:
//   - createBackup(deps) -> { validateBackupBundle, validateFeatureBundle }.
//     Both validators need collaborators server.js owns (sqliteDb.FEATURE_DEFS,
//     userStore, the logo and trash constants, path), so they live in a factory
//     that closes over one deps bundle.
//   - buildStoreZip and __failNextRestorePopulateForTests: plain module-level
//     exports. Both are names the BASE server.js exported, and server.js keeps
//     exporting them as the SAME function objects - at module scope that
//     identity is checkable by OBJECT (scripts/verify-split-slice.js requires
//     both files and compares), while a factory-scope declaration is only
//     checkable by source text. buildStoreZip is also handed on to the
//     critter-pool download route in lib/media/routes.js, exactly as before.
//   - registerRoutes(app, deps) for the two routes, in their server.js order
//     and at the position GET /api/admin/backup held, so the routing signature
//     is unchanged (scripts/route-order-signature.js is the instrument,
//     scripts/verify-split-slice.js the byte check). Nothing was registered
//     between the two routes in server.js, so ONE call reproduces the stack.
//
// DATA LOSS is the whole subject of this file: POST /api/admin/restore WIPES
// every table and repopulates from the bundle inside ONE transaction. The
// ordering that makes that survivable is preserved exactly as it was:
// validateBackupBundle (and through it validateFeatureBundle) runs FIRST, then
// the self-lockout guard, then the missing-key preservation reads (trash,
// podcasts), and only then replacePersistedState opens the exclusive section -
// so a malformed bundle is a 400 with the library untouched, never a
// mid-populate rollback. Nothing in this move may be reordered.
//
// What travelled WITH the code, and why:
//   - BACKUP_SCHEMA, BACKUP_NAMESPACE_KEYS and RELATIONAL_BUNDLE_KEYS: an
//     espree reference census over server.js shows the two routes and
//     validateBackupBundle are their ONLY referrers, and grep over lib/, test/
//     and scripts/ finds none, so the bundle-format declaration lives with the
//     code that reads it instead of crossing as three deps. They sit at module
//     scope because both the factory's validators and registerRoutes' bodies
//     read them.
//   - failNextRestorePopulateError + __failNextRestorePopulateForTests, the
//     mid-populate rollback seam: the `let` has exactly TWO touch points, the
//     setter and the restore route's one-shot read-and-clear, and BOTH are in
//     this slice - so the mutable state moves WHOLE rather than crossing as a
//     live accessor (the S1a push-guard lesson applies to a `let` whose
//     readers and writers are SPLIT; here they are not). Module scope, not
//     factory scope, because the setter is handed back by createBackup while
//     its reader lives in registerRoutes. server.js calls createBackup exactly
//     once, so there is one seam, exactly as before the move.
// What did NOT: CUSTOM_LOGO_TYPES / CUSTOM_LOGO_MAX_BYTES (the upload route in
// lib/config/routes.js holds the same bar), TRASH_DIR_NAME,
// TRASH_RETENTION_DAYS_VALID_VALUES, AVATARS_DIR and customLogoPath /
// customLogoMimeKey (readers outside this slice), and every store handle.
//
// The one byte this move changed anywhere: `zlib` reaches buildStoreZip through
// this file's own require (below) instead of through a deps bundle, because a
// module-scope function has no deps bundle to read. It is a Node builtin, not a
// collaborator - the "no new server runtime deps" rule is untouched, and
// lib/books/zip.js already requires it the same way.
// ---- v1.42: instance backup / restore ---------------------------------------
// The migrator and this machinery are one system (exec plan): the bundle is a
// schema-versioned JSON snapshot of EVERY persisted namespace plus the custom
// logo bytes (base64 — "restore-able config" includes the logo, drift
// correction #3), with `users: []` reserved so the v1.43 format is additive.
// SELECT-assembly rides the write chain (single-threaded consistency); the
// node:sqlite backup() API is deliberately unused (empirically unsafe under
// concurrent writes — see lib/db/sqlite.js's header).
//
// v1.43: both endpoints are ADMIN-ONLY (the v1.42 open posture was a
// disclosed one-release gap), the bundle carries the full `users` set
// (password hashes included — the Settings UI flags the file sensitive),
// and restore holds the self-lockout guard: the RESTORING admin must exist
// in the bundle as an enabled admin, or the restore is refused whole. The
// session secret is NEVER part of a bundle (secrets don't ride bundles —
// per-instance cookie isolation depends on secrets differing).
const BACKUP_SCHEMA = 'filetube-backup-v1';
// v1.69: 'podcasts' rides the bundle (subscriptions/episodes/settings) but
// feed URLS do not - they are secrets, stored OUTSIDE the db (see
// lib/podcasts/secrets.js), so a restored sub may need its URL re-entered.
// v1.195: 'tv' rides the bundle (Shows folders/episodes/settings) - the
// access-control-completeness net: restore wipes the doc tables wholesale and
// repopulates ONLY from bundle keys, so an omitted 'tv' would SILENTLY erase a
// restoring admin's entire Shows library + config (and the content-gated nav
// link with it), exactly the data-loss books/music/podcasts already avoid here.
// Wave 1 (relational-migration arc): `viewCounts` left this DOC-model list -
// it is assembled from its table (viewCountStore.getAll()) into the SAME
// bundle key and shape ({ id: count }), so a bundle exported on either side
// of v1.291 restores on the other. RELATIONAL_BUNDLE_KEYS is the list the
// restore routes through their store handles (validated below).
const BACKUP_NAMESPACE_KEYS = ['metadata']; // Wave 5: the last doc-model key (Wave 6 moves it too)
// Wave 2: `progress` (the frozen pre-auth positions) and `deleteTombstones`
// joined viewCounts here; Wave 3: `trash` - same bundle keys and shapes as
// before (validateBackupBundle's trash section is unchanged).
// Wave 4: `settings` - same key, the same merged object shape.
// Wave 4 (second group): the folder config keys - same keys, same shapes.
const RELATIONAL_BUNDLE_KEYS = ['viewCounts', 'progress', 'deleteTombstones', 'trash', 'settings', 'folders', 'folderSettings', 'folderDisplayNames', 'liked', 'tv', 'music', 'books', 'podcasts', 'ytdlp'];

// Wave 5: with every container a feature store, no bundle shape reaches the
// exclusive section unvalidated any more - so the "mid-populate rollback"
// test needs an injected failure to prove the wipe rolls back whole.
let failNextRestorePopulateError = null;
function __failNextRestorePopulateForTests(err) {
  failNextRestorePopulateError = err instanceof Error ? err : new Error('simulated restore populate failure (test injection)');
}

// v1.171: crc32 for the dependency-free critter zip. See the header: the
// zip builder sits at MODULE scope so server.js can re-export the same
// function OBJECT, which leaves it no deps bundle to read its one builtin
// from. Its body is byte-identical to the server.js original either way.
const zlib = require('zlib');

// PURE dependency-free STORE-only ZIP (the "no new server runtime deps" rule:
// Node has no zip container built in, but a stored zip is 30/46/22-byte
// headers + zlib.crc32, which node >=22.2 ships). entries: [{name, data}].
// Fixed DOS timestamp 1980-01-01 (deterministic output; zips cannot encode
// earlier). Flag bit 11 marks names as UTF-8. LIMIT (QA S5): the classic
// (non-Zip64) format caps at 65535 entries - writeUInt16LE THROWS past that,
// so a preposterous pool 500s cleanly rather than emitting a corrupt archive.
function buildStoreZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(String(e.name), 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '');
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);         // version needed: 2.0
    local.writeUInt16LE(0x0800, 6);     // flags: UTF-8 names
    local.writeUInt16LE(0, 8);          // method: STORE
    local.writeUInt16LE(0, 10);         // mod time 00:00
    local.writeUInt16LE(0x21, 12);      // mod date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed == uncompressed (store)
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // extra field length
    chunks.push(local, nameBuf, data);
    central.push({ nameBuf, crc, size: data.length, offset });
    offset += 30 + nameBuf.length + data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const hdr = Buffer.alloc(46);
    hdr.writeUInt32LE(0x02014b50, 0);   // central directory signature
    hdr.writeUInt16LE(20, 4);           // version made by
    hdr.writeUInt16LE(20, 6);           // version needed
    hdr.writeUInt16LE(0x0800, 8);       // flags: UTF-8 names
    hdr.writeUInt16LE(0, 10);           // method: STORE
    hdr.writeUInt16LE(0, 12);           // mod time
    hdr.writeUInt16LE(0x21, 14);        // mod date
    hdr.writeUInt32LE(c.crc, 16);
    hdr.writeUInt32LE(c.size, 20);
    hdr.writeUInt32LE(c.size, 24);
    hdr.writeUInt16LE(c.nameBuf.length, 28);
    // 30 extra / 32 comment / 34 disk / 36 internal attrs: all zero
    hdr.writeUInt32LE(0, 38);           // external attrs
    hdr.writeUInt32LE(c.offset, 42);    // local header offset
    chunks.push(hdr, c.nameBuf);
    offset += 46 + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);    // end of central directory signature
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12); // central directory size
  eocd.writeUInt32LE(cdStart, 16);          // central directory offset
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

function createBackup(deps) {
  const {
    CUSTOM_LOGO_MAX_BYTES,
    CUSTOM_LOGO_TYPES,
    TRASH_DIR_NAME,
    TRASH_RETENTION_DAYS_VALID_VALUES,
    path,
    sqliteDb,
    userStore,
  } = deps;

  // Validation is strict and field-level: an unknown top-level key or a users
  // array this version cannot restore REFUSES the whole bundle (never a lossy
  // partial restore — the posture the v1.42-v1.295 boot importer shared).
  function validateFeatureBundle(def, ns) {
    const badKey = (k) => typeof k !== 'string' || k === '' || k.includes('\u0000');
    const show = (k) => String(k).split('\u0000').join('\\u0000');
    if (typeof ns !== 'object' || ns === null || Array.isArray(ns)) return `bundle key '${def.name}' must be an object`;
    for (const part of Object.keys(ns)) {
      const spec = def.parts[part];
      if (!spec) return `unknown bundle key '${def.name}.${part}' — refusing a lossy restore (was this exported by a newer FileTube?)`;
      const v = ns[part];
      if (v === undefined || v === null) continue;
      if (spec.kind === 'list') {
        if (!Array.isArray(v)) return `${def.name}.${part} must be an array`;
        for (const e of v) if (badKey(e)) return `${def.name}.${part}: every entry must be a non-empty string`;
      } else if (spec.kind === 'records') {
        if (!Array.isArray(v)) return `${def.name}.${part} must be an array`;
        // Wave 5 (gate pass B): a legacy id-less yt-dlp subscription that carries a
        // channelUrl is accepted - the importer mints the id the migration would
        // (mintLegacyYtdlpSubscriptionIds) instead of refusing the whole bundle.
        const idlessOk = (r) => def.name === 'ytdlp' && part === 'subscriptions' && (r.id === undefined || r.id === '') && !badKey(r.channelUrl);
        for (const r of v) if (!r || typeof r !== 'object' || Array.isArray(r) || (badKey(r.id) && !idlessOk(r))) return `${def.name}.${part}: every entry must be an object with a non-empty string id`;
      } else if (spec.kind === 'value') {
        // A value part restores as its scalar shape (the flag is a boolean) - never an object.
        if (typeof v !== typeof spec.defaultValue) return `${def.name}.${part} must be a ${typeof spec.defaultValue}`;
      } else if (spec.kind === 'map' || spec.kind === 'kv') {
        if (typeof v !== 'object' || Array.isArray(v)) return `${def.name}.${part} must be an object`;
        for (const k of Object.keys(v)) {
          if (badKey(k)) return `${def.name}.${part}['${show(k)}']: invalid key`;
          if (v[k] === undefined) return `${def.name}.${part}['${k}']: record is missing`;
        }
      }
    }
    return null;
  }

  function validateBackupBundle(bundle) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return 'bundle must be a JSON object';
    if (bundle.schema !== BACKUP_SCHEMA) return `unsupported schema '${bundle.schema}' (expected ${BACKUP_SCHEMA})`;
    // v1.43: a users array restores fully. Field-level validation up front —
    // any bad entry refuses the WHOLE bundle before the wipe starts (the
    // no-lossy-restore posture). An absent/empty users array is the v1.42
    // format: legal, and the restore leaves the CURRENT accounts untouched
    // (wiping users on a bundle that carries none would lock the instance out).
    if (bundle.users !== undefined) {
      if (!Array.isArray(bundle.users)) return 'users must be an array';
      const seenIds = new Set();
      const seenNames = new Set();
      for (let i = 0; i < bundle.users.length; i++) {
        const u = bundle.users[i];
        const where = `users[${i}]`;
        if (!u || typeof u !== 'object') return `${where}: must be an object`;
        if (!Number.isInteger(u.id) || u.id <= 0) return `${where}: id must be a positive integer`;
        if (seenIds.has(u.id)) return `${where}: duplicate user id ${u.id}`;
        seenIds.add(u.id);
        if (typeof u.username !== 'string' || !userStore.validateUsername(u.username)) return `${where}: invalid username`;
        const nameKey = u.username.trim().toLowerCase();
        if (seenNames.has(nameKey)) return `${where}: duplicate username '${u.username}'`;
        seenNames.add(nameKey);
        if (typeof u.passwordHash !== 'string' || u.passwordHash === '') return `${where}: missing password hash`;
        if (u.role !== 'admin' && u.role !== 'member') return `${where}: role must be 'admin' or 'member'`;
        for (const [field, kind] of [['progress', 'object'], ['bookProgress', 'object'], ['liked', 'array'], ['bookPins', 'array'], ['channelPins', 'array'],
          // v1.44 music per-user state (the SEVENTH-strike carrier).
          ['musicLiked', 'array'], ['musicProgress', 'object'],
          // v1.50 watched latch (absent in pre-v1.50 bundles -- legal).
          ['watched', 'array'],
          // v1.51 notification reads (absent in pre-v1.51 bundles -- legal).
          ['notificationReads', 'array'],
          // v1.68 notification dismissals (absent in pre-v1.68 bundles -- legal).
          ['notificationDismissals', 'array'],
          // v1.69 podcast per-user state (absent in pre-v1.69 bundles -- legal).
          ['podcastProgress', 'object'], ['podcastPlayed', 'object'],
          // v1.71 episode likes (absent in pre-v1.71 bundles -- legal).
          ['podcastLiked', 'array'],
          // v1.72 books first-class (absent in pre-v1.72 bundles -- legal).
          ['bookLiked', 'array'], ['bookFinished', 'object'],
          // v1.72 podcast show pins (absent in pre-v1.72 bundles -- legal).
          ['podcastPins', 'array'],
          // v1.97 "Hide from feed" (13th carrier; absent in pre-v1.97 bundles -- legal).
          ['feedHidden', 'array']]) {
          if (u[field] === undefined) continue;
          const ok = kind === 'array' ? Array.isArray(u[field]) : (typeof u[field] === 'object' && u[field] !== null && !Array.isArray(u[field]));
          if (!ok) return `${where}: ${field} must be an ${kind}`;
        }
        // musicState is a single object OR null (no resume pointer) -- validated
        // separately since the loop above rejects null for its object fields.
        if (u.musicState !== undefined && u.musicState !== null
          && (typeof u.musicState !== 'object' || Array.isArray(u.musicState))) {
          return `${where}: musicState must be an object or null`;
        }
        // v1.51: notificationState is an object OR the explicit null that means
        // "this user never touched the panel" (the null-vs-absent distinction
        // is load-bearing — see replaceAllUsersRaw's three-shape restore).
        if (u.notificationState !== undefined && u.notificationState !== null
          && (typeof u.notificationState !== 'object' || Array.isArray(u.notificationState))) {
          return `${where}: notificationState must be an object or null`;
        }
      }
    }
    // v1.51: the global feed rides the bundle top-level (absent pre-v1.51).
    // GATE FIX (adversarial S1): field-level validation up front, matching the
    // users array's refuse-whole posture -- a duplicate mediaId previously
    // passed validation and died on the UNIQUE constraint mid-restore (the
    // transaction rolled back whole, but as an opaque 500 instead of a clean
    // 400 naming the defect).
    if (bundle.notifications !== undefined) {
      if (!Array.isArray(bundle.notifications)) return 'notifications must be an array';
      const seenMediaIds = new Set();
      for (let i = 0; i < bundle.notifications.length; i++) {
        const n = bundle.notifications[i];
        const where = `notifications[${i}]`;
        if (!n || typeof n !== 'object' || Array.isArray(n)) return `${where}: must be an object`;
        if (typeof n.mediaId !== 'string' || n.mediaId === '') return `${where}: missing mediaId`;
        if (typeof n.createdAt !== 'number' || !Number.isFinite(n.createdAt) || n.createdAt <= 0) return `${where}: createdAt must be a positive number`;
        if (n.kind !== undefined && n.kind !== 'media' && n.kind !== 'podcast') return `${where}: kind must be 'media' or 'podcast' when present`;
        if (seenMediaIds.has(n.mediaId)) return `${where}: duplicate mediaId '${n.mediaId}'`;
        seenMediaIds.add(n.mediaId);
      }
    }
    // v1.65 gate fix (adversarial C2): trash records reach THREE unlinkers
    // (purge, the retention sweep, restore) with their paths used verbatim --
    // a hostile or corrupt bundle must never smuggle an arbitrary-path
    // record. Refuse-whole, field-level, before the wipe (the house posture).
    if (bundle.trash !== undefined) {
      if (typeof bundle.trash !== 'object' || bundle.trash === null || Array.isArray(bundle.trash)) return 'trash must be an object';
      for (const tid of Object.keys(bundle.trash)) {
        const rec = bundle.trash[tid];
        const where = `trash['${tid}']`;
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return `${where}: must be an object`;
        for (const field of ['originalPath', 'trashPath']) {
          const v = rec[field];
          if (typeof v !== 'string' || v === '' || !path.isAbsolute(v) || v.split(/[\\/]/).includes('..')) {
            return `${where}: ${field} must be an absolute path with no '..' segments`;
          }
        }
        if (path.basename(path.dirname(rec.trashPath)) !== TRASH_DIR_NAME) {
          return `${where}: trashPath must sit directly inside a ${TRASH_DIR_NAME} directory`;
        }
        // Gate round 3 (adversarial C2): round 2 required the trash dir to sit
        // under one of the bundle's declared folders -- which the app's own
        // unattributable-file fallback does not satisfy, so the instance
        // refused ITS OWN backup whole (refuse-whole means one such record
        // blocked users, metadata, settings, everything). A validator must at
        // minimum accept what the exporter can emit: either the trash dir is
        // under a bundle folder, or the record has the app's structural shape
        // (the item lived in the trash dir's own parent tree).
        const bundleRoots = Array.isArray(bundle.folders) ? bundle.folders.filter((r) => typeof r === 'string' && r !== '') : [];
        const underPath = (child, parent) => {
          const c = path.resolve(child);
          const p = path.resolve(parent);
          return c === p || c.startsWith(p + path.sep);
        };
        const underBundleRoot = bundleRoots.some((r) => underPath(rec.trashPath, r));
        const appShaped = underPath(rec.originalPath, path.dirname(path.dirname(rec.trashPath)));
        if (!underBundleRoot && !appShaped) {
          return `${where}: trashPath must sit under one of the bundle's library folders, or beside the item's own original location`;
        }
        if (typeof rec.trashedAt !== 'number' || !Number.isFinite(rec.trashedAt)) {
          return `${where}: trashedAt must be a finite number`;
        }
        // Gate round 2 (adversarial W5): the snapshot feeds renderers (the
        // thumbnail route's fallback among them) -- shape-check it.
        if (rec.item !== undefined && (typeof rec.item !== 'object' || rec.item === null || Array.isArray(rec.item))) {
          return `${where}: item must be an object`;
        }
      }
    }
    // Wave 4: `settings` restores into app_settings one row per key through the
    // store handle - shape-checked HERE (an object with non-empty NUL-free keys)
    // so a malformed bundle is a 400 BEFORE the wipe, never a mid-populate
    // rollback (the Wave 2 posture).
    if (bundle.settings !== undefined) {
      if (typeof bundle.settings !== 'object' || bundle.settings === null || Array.isArray(bundle.settings)) return 'settings must be an object';
      for (const key of Object.keys(bundle.settings)) {
        if (key === '' || key.includes('\u0000')) return `settings['${key.split('\u0000').join('\\u0000')}']: invalid settings key`;
      }
    }
    // Wave 4 (second group): the folder config. `folders` restores as an
    // ordered list of root paths, the two maps one row per key - shape-checked
    // before the wipe like everything else.
    for (const key of ['folders', 'liked']) {
      if (bundle[key] === undefined) continue;
      if (!Array.isArray(bundle[key])) return `${key} must be an array`;
      for (const f of bundle[key]) {
        if (typeof f !== 'string' || f === '' || f.includes('\u0000')) return `${key}: every entry must be a non-empty string`;
      }
    }
    for (const key of ['folderSettings', 'folderDisplayNames']) {
      if (bundle[key] === undefined) continue;
      if (typeof bundle[key] !== 'object' || bundle[key] === null || Array.isArray(bundle[key])) return `${key} must be an object`;
      for (const k of Object.keys(bundle[key])) {
        if (k === '' || k.includes('\u0000')) return `${key}['${k.split('\u0000').join('\\u0000')}']: invalid key`;
        if (bundle[key][k] === undefined) return `${key}['${k}']: record is missing`;
      }
    }
    // Same amplifier, settings side: the sweep also clamps (defense in depth),
    // but a bundle with an out-of-set retention gets the clean 400 here.
    if (bundle.settings && typeof bundle.settings === 'object' && !Array.isArray(bundle.settings)
      && bundle.settings.trashRetentionDays !== undefined
      && !TRASH_RETENTION_DAYS_VALID_VALUES.has(bundle.settings.trashRetentionDays)) {
      return 'settings.trashRetentionDays must be one of 0, 7, 14, 30, 90';
    }
    const known = new Set([...BACKUP_NAMESPACE_KEYS, ...RELATIONAL_BUNDLE_KEYS, 'schema', 'exportedAt', 'appVersion', 'customLogo', 'users', 'notifications']);
    for (const key of Object.keys(bundle)) {
      if (!known.has(key)) return `unknown bundle key '${key}' — refusing a lossy restore (was this exported by a newer FileTube?)`;
    }
    // Wave 1: `viewCounts` restores into media_view_counts through the store
    // handle. Field-level, refuse-whole, before the wipe (the house posture): a
    // per-id map of non-negative finite numbers (a legacy float is truncated by
    // the importer; junk is refused here rather than half-applied mid-restore).
    if (bundle.viewCounts !== undefined) {
      if (typeof bundle.viewCounts !== 'object' || bundle.viewCounts === null || Array.isArray(bundle.viewCounts)) return 'viewCounts must be an object';
      for (const id of Object.keys(bundle.viewCounts)) {
        const v = bundle.viewCounts[id];
        if (id === '' || id.includes('\u0000')) return `viewCounts['${id.split('\u0000').join('\\u0000')}']: invalid media id`;
        // Safe-integer ceiling (adversarial W1): a count past 2^53 lands in the
        // INTEGER column and then every READ of the table throws - backup, stats
        // and the view route all 500 until SQL surgery. Refused here, before the wipe.
        // Integers only: the importer's value rule would silently TRUNCATE a
        // float, and "silently changed" is the class refuse-whole exists to
        // prevent (a v1.290 export never carries a float; only a hand edit does).
        if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) return `viewCounts['${id}']: must be a non-negative integer within the safe-integer range`;
      }
    }
    // Wave 2: the record namespaces - a per-id map of JSON records (any record
    // shape is legal and copied verbatim; the importer keeps it byte-equal), but
    // the MAP must be an object with non-empty NUL-free ids and no null holes -
    // refuse-whole before the wipe. A tombstone's record must be an object (the
    // scan reads .deletedAt/.filePath off it and the prune keys on deletedAt).
    // (Wave 3: `trash` joins for the id/shape checks; its per-record path
    // validation above is unchanged.)
    for (const key of ['progress', 'deleteTombstones', 'trash']) {
      if (bundle[key] === undefined) continue;
      const map = bundle[key];
      if (typeof map !== 'object' || map === null || Array.isArray(map)) return `${key} must be an object`;
      for (const id of Object.keys(map)) {
        if (id === '' || id.includes('\u0000')) return `${key}['${id.split('\u0000').join('\\u0000')}']: invalid media id`;
        const rec = map[id];
        if (rec === undefined) return `${key}['${id}']: record is missing`;
        // A progress record may be ANY JSON value including null (legacy data is
        // copied verbatim, and an instance's own export must always restore -
        // QA S1); a tombstone record must be an object (the scan reads
        // .deletedAt / .filePath off it).
        if (key === 'deleteTombstones' && (rec === null || typeof rec !== 'object' || Array.isArray(rec))) return `${key}['${id}']: must be an object`;
      }
    }
    // (The container-object check that lived here is subsumed: every container
    // is a feature store since Wave 5 and validateFeatureBundle below checks
    // each one part by part.)
    // Wave 6: the media index (`metadata`, a table now) - shape-checked BEFORE
    // the wipe like every other namespace: a per-id map of item OBJECTS with
    // non-empty NUL-free ids. (Until Wave 6 a malformed `metadata` reached the
    // populate and became a 500 "rolled back"; a 400 before the wipe is the
    // arc's posture.)
    if (bundle.metadata !== undefined) {
      const m = bundle.metadata;
      if (typeof m !== 'object' || m === null || Array.isArray(m)) return "bundle key 'metadata' must be an object";
      for (const id of Object.keys(m)) {
        if (id === '' || id.includes('\u0000')) return `metadata['${id.split('\u0000').join('\\u0000')}']: invalid id`;
        const item = m[id];
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return `metadata['${id}']: must be an object`;
      }
    }
    // Wave 5: a relational feature container - shape-checked part by part
    // BEFORE the wipe (the same posture as the record namespaces): known parts
    // only; a list is an array of non-empty NUL-free strings; a map / kv is an
    // object with such keys and no undefined values; a record list is an array
    // of objects with such ids.
    for (const def of sqliteDb.FEATURE_DEFS) {
      const ns = bundle[def.name];
      if (ns === undefined) continue;
      const problem = validateFeatureBundle(def, ns);
      if (problem) return problem;
    }
    if (bundle.customLogo !== undefined) {
      if (typeof bundle.customLogo !== 'object' || bundle.customLogo === null || Array.isArray(bundle.customLogo)) return 'customLogo must be an object';
      for (const variant of Object.keys(bundle.customLogo)) {
        if (variant !== 'light' && variant !== 'dark') return `unknown customLogo variant '${variant}'`;
        const entry = bundle.customLogo[variant];
        if (!entry || typeof entry.mime !== 'string' || !Object.prototype.hasOwnProperty.call(CUSTOM_LOGO_TYPES, entry.mime)) {
          return `customLogo.${variant}: unsupported or missing mime`;
        }
        if (typeof entry.b64 !== 'string' || Buffer.byteLength(entry.b64, 'base64') > CUSTOM_LOGO_MAX_BYTES) {
          return `customLogo.${variant}: missing bytes or larger than ${CUSTOM_LOGO_MAX_BYTES} bytes`;
        }
        // QA-gate WARNING: the upload route sniffs magic bytes as well as the
        // Content-Type; restore is a second write path to the SAME resource
        // and must hold the same bar — a false mime claim over arbitrary
        // bytes is refused, not planted on disk.
        if (!CUSTOM_LOGO_TYPES[entry.mime](Buffer.from(entry.b64, 'base64'))) {
          return `customLogo.${variant}: the bytes do not match the declared ${entry.mime} (magic-byte check failed)`;
        }
      }
    }
    return null;
  }

  return { validateBackupBundle, validateFeatureBundle };
}

function registerRoutes(app, deps) {
  const {
    APP_VERSION,
    AVATARS_DIR,
    booksDb,
    contentDispositionAttachment,
    customLogoMimeKey,
    customLogoPath,
    express,
    folderDisplayNameStore,
    folderSettingsStore,
    folderStore,
    formatBodyParserError,
    fs,
    issueSessionCookie,
    likedStore,
    musicDb,
    podcastsDb,
    progressStore,
    replacePersistedState,
    requireAdmin,
    settingsStore,
    sqliteDb,
    tombstoneStore,
    trashStore,
    tvDb,
    updateDatabase,
    userStore,
    validateBackupBundle,
    viewCountStore,
    ytdlpDb,
  } = deps;

  app.get('/api/admin/backup', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      let bundle;
      // A read-only pass enqueued as a mutator that skips its save: the chain
      // guarantees no writer's tick interleaves with the snapshot.
      await updateDatabase((db) => {
        bundle = { schema: BACKUP_SCHEMA, exportedAt: new Date().toISOString(), appVersion: APP_VERSION };
        for (const key of BACKUP_NAMESPACE_KEYS) {
          if (db[key] !== undefined) bundle[key] = db[key];
        }
        // Wave 1: the relational media namespace, read on the SAME chained
        // tick as the doc snapshot (one moment), in its historical bundle shape.
        bundle.viewCounts = viewCountStore.getAll();
        bundle.progress = progressStore.getAll();          // Wave 2: verbatim records
        bundle.deleteTombstones = tombstoneStore.getAll(); // Wave 2: verbatim records
        bundle.trash = trashStore.getAll();                // Wave 3: verbatim records
        bundle.settings = settingsStore.get();             // Wave 4: the MERGED object, as the doc snapshot carried it
        bundle.folders = folderStore.list();               // Wave 4: the root list, operator order
        bundle.folderSettings = folderSettingsStore.getAll();
        bundle.folderDisplayNames = folderDisplayNameStore.getAll();
        bundle.liked = likedStore.list();                  // Wave 4: the frozen likes, like order
        bundle.tv = tvDb.read();                           // Wave 5: the Shows namespace, its old container shape
        bundle.music = musicDb.read();                     // Wave 5: the music namespace, its old container shape
        bundle.books = booksDb.read();                     // Wave 5: the books namespace, its old container shape
        bundle.podcasts = podcastsDb.read();               // Wave 5: the podcasts namespace, its old container shape (no feed URLs - never in the db)
        bundle.ytdlp = ytdlpDb.read();                     // Wave 5: the ytdlp namespace, its old container shape (allowMembersOnly included)
        bundle.customLogo = {};
        for (const variant of ['light', 'dark']) {
          const mime = settingsStore.getKey(customLogoMimeKey(variant)); // Wave 4
          if (typeof mime === 'string' && mime) {
            try {
              bundle.customLogo[variant] = { mime, b64: fs.readFileSync(customLogoPath(variant)).toString('base64') };
            } catch (err) {
              // A mime key with no readable bytes is served-state damage worth
              // surfacing, not silently exporting half a logo.
              console.error(`Backup: customLogo ${variant} mime is set but the bytes are unreadable:`, err.message);
            }
          }
        }
        // v1.43: the full account set, hashes and per-user state included —
        // enqueued on the same chained tick as the doc snapshot, so the two
        // halves describe one moment.
        bundle.users = userStore.exportUsersForBackup();
        // v1.51: the GLOBAL notification feed (each user's seen/read state
        // rides their own users[] entry above, keyed by media id).
        bundle.notifications = userStore.exportNotificationsForBackup();
        return false; // read-only pass — never save
      });
      res.setHeader('Content-Disposition', contentDispositionAttachment(`filetube-backup-${new Date().toISOString().slice(0, 10)}.json`));
      // v1.123 T4 (security): the bundle carries password hashes, the full account
      // set and every per-user state - it must never sit in ANY cache (shared or
      // the browser's own disk). `no-store` is stricter than the `private` used on
      // art: art may live in the user's own cache; this must not persist anywhere.
      res.setHeader('Cache-Control', 'no-store');
      res.json(bundle);
    } catch (err) {
      console.error('Error building backup bundle:', err);
      res.status(500).json({ error: `Could not build backup: ${err.message}` });
    }
  });

  // Route-scoped body limit: the default express.json() cap (100 kb) cannot
  // carry a real bundle — same route-scoped-parser posture as the logo
  // upload's express.raw. This parser is only ALIVE because the global
  // express.json() explicitly skips this path (see the middleware comment at
  // its registration): before v1.43.1 the global 100 kb parser threw first
  // and this limit was dead code, 413-ing every real-world restore.
  //
  // 32mb (Dean-approved, v1.43.1 intake): his prod bundle is ~2943 metadata
  // items (~1.5–2 KB each ≈ 4–6 MB) + per-user state + up to two logo
  // variants at ~2.7 MB base64 each ≈ ~12 MB realistic worst case; 32mb
  // leaves ~2.5× headroom for library growth.
  // v1.44 RECOMPUTE (music added to the bundle): a music track record is small
  // (~0.3–0.5 KB of tags/paths); even a large library of ~30,000 tracks is
  // ~9–15 MB, plus per-user music state (liked ids + a per-track position map;
  // a heavy listener at ~30k positions ≈ a few MB). Worst realistic case now:
  // ~6 MB video metadata + ~15 MB music + ~12 MB two logos + a few MB per-user
  // ≈ ~33–35 MB for an EXTREME (30k-video + 30k-track + dual-logo) instance,
  // which would exceed 32mb. Dean's real instance is far under this, and the
  // cap is Dean-approved as-is for v1.44; a library that large is the documented
  // trigger to raise it (tech-debt: revisit the cap when metadata+music+logos
  // approach ~28 MB). The near-cap positive test below pins the current value so
  // a silent regression to a smaller limit fails loudly. The chain order is the security
  // posture (adversarial-seat WARNING-1): the auth gate 401s unauthenticated
  // callers before any body is read, and the requireAdmin middleware BELOW
  // runs before the parser, so a non-admin MEMBER is 403'd without the server
  // ever buffering or JSON.parsing a multi-MB body — the big parse is
  // reachable by ADMINS only, exactly what the exec plan promised (parsing
  // first would have handed any household account a 32mb CPU/memory
  // amplifier).
  app.post('/api/admin/restore', (req, res, next) => {
    if (!requireAdmin(req, res)) return;
    next();
  }, express.json({ limit: '32mb' }), async (req, res) => {
    const bundle = req.body;
    const problem = validateBackupBundle(bundle);
    if (problem) return res.status(400).json({ error: problem });

    // Self-lockout guard (exec plan, locked answer 7): when the bundle
    // replaces the user set, the admin PERFORMING the restore must exist in
    // it as an ENABLED ADMIN — matched by username (ids may differ across
    // instances), refused whole otherwise. Without this, one restore of a
    // stale/foreign bundle locks the instance's only operator out the moment
    // the wipe commits.
    const restoresUsers = Array.isArray(bundle.users) && bundle.users.length > 0;
    if (restoresUsers) {
      const self = bundle.users.find((u) => u.username.trim().toLowerCase() === req.user.username.toLowerCase());
      if (!self || self.role !== 'admin' || self.disabled) {
        return res.status(409).json({
          error: `This bundle does not contain '${req.user.username}' as an enabled admin - restoring it would lock you out, so it is refused. Restore from an account that exists in the bundle as an admin.`,
        });
      }
    }

    const dbPart = {};
    for (const key of [...BACKUP_NAMESPACE_KEYS, ...RELATIONAL_BUNDLE_KEYS]) {
      if (bundle[key] !== undefined) dbPart[key] = bundle[key];
    }
    // v1.65 gate fix (QA W2, the v1.51 partial-restore lesson): a bundle
    // without a trash key -- every pre-v1.65 export -- must PRESERVE the
    // current trash records. Wiping them would strand the trashed files as
    // unreferenced orphans that the retention sweep then silently destroys.
    if (bundle.trash === undefined) {
      const current = trashStore.getAll(); // Wave 3: the table
      if (Object.keys(current).length > 0) dbPart.trash = current;
    }
    // v1.69 gate fix (adversarial #5, the SAME v1.51 partial-restore lesson):
    // a bundle without a podcasts key - every pre-v1.69 export - must
    // PRESERVE the current podcasts namespace. Wiping it would silently
    // destroy the subscription list and the whole episode archive (forcing a
    // full re-download) while orphaning the tokened secrets file.
    if (bundle.podcasts === undefined) {
      const current = podcastsDb.read(); // Wave 5: the tables, in the container shape the restore handle takes
      if (current.subscriptions.length > 0 || Object.keys(current.episodes).length > 0) {
        dbPart.podcasts = current;
      }
    }

    try {
      await replacePersistedState((handles) => {
        if (failNextRestorePopulateError) { // test seam: a mid-populate failure, after the wipe (see __failNextRestorePopulateForTests)
          const injected = failNextRestorePopulateError;
          failNextRestorePopulateError = null;
          throw injected;
        }
        // Import FIRST (delta-round residual, adversarial seat): any import
        // refusal/throw must roll back with the FILESYSTEM untouched — the
        // original ordering destroyed the old logo bytes before the import
        // ran, so a failed restore's "rolled back" response lied about the
        // logo. One classification, ONE caller since Wave 7 (the v1.42-v1.295
        // boot import was the other): the strict importer maps namespaces to
        // rows; the bundle's first-class `viewCounts` key routes to
        // media_view_counts through the insertViewCount handle (Wave 1), inside
        // this same transaction.
        sqliteDb.importParsedJson(dbPart, handles);
        // Logo bytes LAST — still inside the exclusive section, still BEFORE
        // the COMMIT that carries the mime keys (design review F6's ordering
        // holds: a crash between these file ops and the commit leaves new
        // bytes under the old mime key for one boot — bounded, cosmetic,
        // disclosed). tmp+rename per variant; a variant the bundle lacks has
        // its stale .bin removed.
        for (const variant of ['light', 'dark']) {
          const entry = bundle.customLogo ? bundle.customLogo[variant] : undefined;
          const finalPath = customLogoPath(variant);
          if (entry) {
            const bytes = Buffer.from(entry.b64, 'base64');
            const tmp = `${finalPath}.restore.tmp`;
            fs.writeFileSync(tmp, bytes);
            fs.renameSync(tmp, finalPath);
          } else {
            try { fs.unlinkSync(finalPath); } catch { /* no stale variant -- fine */ }
          }
        }
        // v1.43: replace the user set INSIDE the same open transaction — the
        // account restore commits (or rolls back) atomically with the doc
        // tables. A bundle without users (v1.42 format) keeps the current
        // accounts untouched.
        // v1.51: the notification feed restores BEFORE the users, inside the
        // same exclusive section, so each restored user's media-keyed reads can
        // resolve their feed ids. A pre-v1.51 bundle (key absent) leaves this
        // instance's existing feed untouched — replaceAllUsersRaw then defaults
        // those users' watermarks to the restore moment.
        if (bundle.notifications !== undefined) {
          userStore.replaceAllNotificationsRaw(bundle.notifications);
        }
        if (restoresUsers) {
          userStore.replaceAllUsersRaw(bundle.users);
        }
      });
    } catch (err) {
      console.error('Error restoring backup bundle:', err);
      return res.status(500).json({ error: `Restore failed and was rolled back: ${err.message}` });
    }
    // The restore replaced the restoring admin's own row (possibly with a
    // different id/token_version than their live cookie carries) — reissue
    // the cookie against the RESTORED row so the operator stays signed in.
    if (restoresUsers) {
      const restoredSelf = userStore.getByUsername(req.user.username);
      if (restoredSelf) issueSessionCookie(res, req, restoredSelf);
      // v1.82 (S4): avatars are disk-only and NOT carried in the bundle, and a
      // users-replacing restore reassigns ids to possibly-different identities -
      // so wipe every stored avatar to avoid a stale photo bleeding onto the
      // reassigned id. Restored users revert to the initials monogram (honest:
      // their photos were never in the backup). Best-effort.
      try { fs.rmSync(AVATARS_DIR, { recursive: true, force: true }); } catch { /* absent -- fine */ }
    }
    res.json({ success: true, restoredNamespaces: Object.keys(dbPart), usersRestored: restoresUsers ? bundle.users.length : 0 });
  }, (err, req, res, next) => {
    // Route-scoped 4-arg (error-handling) middleware, the lib/ytdlp
    // POST /api/ytdlp/download precedent: the global body-parser error
    // middleware near the top of the file can NEVER catch an error raised by
    // this route's own express.json() — Express only walks its error stack
    // FORWARD from where the error was raised (see lib/bodyParserErrors.js's
    // block comment), and that middleware is registered before this route
    // exists. Without this trailing handler, a bundle over the 32mb cap (or
    // malformed JSON) would render Express's default HTML stack page instead
    // of the clean JSON error contract every other body-parse failure honors.
    const mapped = formatBodyParserError(err);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    return next(err);
  });
}

module.exports = { createBackup, registerRoutes, buildStoreZip, __failNextRestorePopulateForTests };
