'use strict';

// [UNIT] v1.265 cross-device preference sync - the user_prefs store (schema
// v20), against a real temp SQLite adapter. The axes that matter:
//   - LWW lives in the STATEMENT (the upsert's WHERE guard): newer wins, stale
//     is a no-op reported as skipped, and a TIE is a drop (strict >) - the
//     symmetric invariant both directions.
//   - cross-user isolation + the users(id) cascade.
//   - the FOURTEENTH-strike backup carrier: prefs ride each user's bundle
//     entry, restore is wipe-and-replace (a pref absent from the bundle is
//     GONE after restore - asserted, not assumed), and a pre-v1.265 bundle
//     (no prefs field) restores empty without error.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-prefs-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ISO = (n) => `2026-09-04T12:00:0${n}.000Z`;

test('set/get round-trip; LWW newer wins, stale skips, a TIE drops (strict >)', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  assert.deepEqual(store.getPrefs(a.id), {}, 'starts empty');

  let r = store.setPrefsLWW(a.id, [{ key: 'theme', value: 'dark', updatedAt: 1000 }]);
  assert.deepEqual(r, { applied: ['theme'], skipped: [] });
  assert.deepEqual(store.getPrefs(a.id), { theme: { value: 'dark', updatedAt: 1000 } });

  // newer wins
  r = store.setPrefsLWW(a.id, [{ key: 'theme', value: 'light', updatedAt: 2000 }]);
  assert.deepEqual(r.applied, ['theme']);
  assert.equal(store.getPrefs(a.id).theme.value, 'light');

  // stale is a reported no-op - the OTHER axis of the same invariant
  r = store.setPrefsLWW(a.id, [{ key: 'theme', value: 'dark', updatedAt: 1500 }]);
  assert.deepEqual(r, { applied: [], skipped: ['theme'] });
  assert.equal(store.getPrefs(a.id).theme.value, 'light', 'the stale write changed nothing');

  // a TIE drops (strict >): two devices stamping the same ms must not flap
  r = store.setPrefsLWW(a.id, [{ key: 'theme', value: 'dark', updatedAt: 2000 }]);
  assert.deepEqual(r, { applied: [], skipped: ['theme'] });
  assert.equal(store.getPrefs(a.id).theme.value, 'light');
});

test('a batch reports per-key: one applied and one skipped in the same call', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  store.setPrefsLWW(a.id, [{ key: 'ft-era', value: '2009', updatedAt: 5000 }]);
  const r = store.setPrefsLWW(a.id, [
    { key: 'ft-era', value: '2013', updatedAt: 4000 }, // stale
    { key: 'ft-icons', value: 'classic', updatedAt: 4000 }, // fresh key
  ]);
  assert.deepEqual(r, { applied: ['ft-icons'], skipped: ['ft-era'] });
  assert.equal(store.getPrefs(a.id)['ft-era'].value, '2009');
  assert.equal(store.getPrefs(a.id)['ft-icons'].value, 'classic');
});

test('cross-user isolation, and the users(id) cascade clears prefs on delete', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
  store.setPrefsLWW(a.id, [{ key: 'theme', value: 'dark', updatedAt: 1 }]);
  store.setPrefsLWW(b.id, [{ key: 'theme', value: 'light', updatedAt: 1 }]);
  assert.equal(store.getPrefs(a.id).theme.value, 'dark');
  assert.equal(store.getPrefs(b.id).theme.value, 'light', 'B is untouched by A');

  store.deleteUser(b.id);
  const orphans = adapter.sql.prepare('SELECT COUNT(*) AS n FROM user_prefs WHERE user_id = ?').get(b.id).n;
  assert.equal(orphans, 0, 'the cascade left no orphan rows');
  assert.equal(store.getPrefs(a.id).theme.value, 'dark', 'A survives B\'s deletion');
});

test('FOURTEENTH-strike carrier: prefs ride the bundle, restore round-trips byte-equal, and restore DESTROYS what the bundle lacks', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  store.setPrefsLWW(a.id, [
    { key: 'ft-era', value: '2009', updatedAt: 111 },
    { key: 'ft-music-skin', value: 'zune-classic', updatedAt: 222 },
  ]);

  const bundle = store.exportUsersForBackup();
  assert.deepEqual(bundle[0].prefs, [
    { key: 'ft-era', value: '2009', updatedAt: 111 },
    { key: 'ft-music-skin', value: 'zune-classic', updatedAt: 222 },
  ], 'the export carries every pref, ordered by key');

  // Mutate live state AFTER the export: one changed, one new.
  store.setPrefsLWW(a.id, [
    { key: 'ft-era', value: '2013', updatedAt: 333 },
    { key: 'ft-star-ratings', value: 'on', updatedAt: 444 },
  ]);

  // Restore the bundle (wipe-and-replace, inside a transaction like the route).
  adapter.sql.exec('BEGIN');
  store.replaceAllUsersRaw(bundle);
  adapter.sql.exec('COMMIT');

  const after = store.getPrefs(bundle[0].id);
  assert.deepEqual(after, {
    'ft-era': { value: '2009', updatedAt: 111 },
    'ft-music-skin': { value: 'zune-classic', updatedAt: 222 },
  }, 'bundle prefs restored byte-equal; the post-export ft-star-ratings is GONE (wipe-and-replace honesty) and ft-era reverted');
});

test('a pre-v1.265 bundle (no prefs field) restores EMPTY prefs without error', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  store.setPrefsLWW(a.id, [{ key: 'ft-era', value: '2009', updatedAt: 1 }]);
  const bundle = store.exportUsersForBackup();
  for (const u of bundle) delete u.prefs; // the old bundle shape

  adapter.sql.exec('BEGIN');
  store.replaceAllUsersRaw(bundle);
  adapter.sql.exec('COMMIT');
  assert.deepEqual(store.getPrefs(bundle[0].id), {}, 'no phantom prefs, no crash - the pre-restore rows are gone (disclosed semantics)');
});

test('import tolerates malformed pref rows (junk skipped, valid kept)', () => {
  store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  const bundle = store.exportUsersForBackup();
  bundle[0].prefs = [
    { key: 'ft-era', value: '2009', updatedAt: 5 },
    { key: 42, value: 'x', updatedAt: 5 },            // junk key
    { key: 'ft-mode', value: null, updatedAt: 5 },     // junk value
    { key: 'ft-icons', value: 'y', updatedAt: 'nope' }, // junk stamp
    null,
  ];
  adapter.sql.exec('BEGIN');
  store.replaceAllUsersRaw(bundle);
  adapter.sql.exec('COMMIT');
  assert.deepEqual(store.getPrefs(bundle[0].id), { 'ft-era': { value: '2009', updatedAt: 5 } });
});


test('adversarial W-A/W-C: the RESTORE loop enforces allowlist, byte cap, and the clock clamp (the route bypass closed)', () => {
  store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  const bundle = store.exportUsersForBackup();
  bundle[0].prefs = [
    { key: 'utterly-junk-key', value: 'x', updatedAt: 5 },          // W-C: off-list
    { key: 'ft-era', value: 'y'.repeat(600), updatedAt: 5 },         // W-C: over the cap
    { key: 'ft-mode', value: 'dark', updatedAt: 9e15 },              // W-A: the 285,000-year wedge
    { key: 'ft-icons', value: 'classic', updatedAt: 7 },             // legit
  ];
  const NOW = 1000000;
  adapter.sql.exec('BEGIN');
  store.replaceAllUsersRaw(bundle, NOW);
  adapter.sql.exec('COMMIT');
  const after = store.getPrefs(bundle[0].id);
  assert.deepEqual(Object.keys(after).sort(), ['ft-icons', 'ft-mode'], 'off-list and over-cap rows never restore');
  assert.equal(after['ft-mode'].updatedAt, NOW + 300000, 'the far-future stamp CLAMPED to now+5min - a clamped route write can out-rank it after the window');
  assert.equal(after['ft-icons'].updatedAt, 7, 'a sane stamp restores verbatim');
});
