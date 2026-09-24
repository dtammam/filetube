'use strict';

// [UNIT] M3 chapter likes (v1.317): the two user_liked carriers that keep a
// `<mediaId>::c<n>` chapter like from ORPHANING - the data-loss class this wave's
// gate was briefed to destroy. Against the real store (lib/auth/store.js) on a
// temp SQLite file:
//   - removeMediaState(id) sheds the exact row AND every `id::c<n>` row, for
//     EVERY user, and touches nothing that merely shares a prefix or a suffix
//     (`id::x`, `<id>x::c1`, `<other>::c1`);
//   - rekeyMediaState(old, new) carries `old::c<n>` -> `new::c<n>` (the suffix
//     kept verbatim) beside the exact row, for every user, and a collision at the
//     destination (`new::c1` already there) replaces instead of throwing;
//   - `_` in a base id (legal in a yt-dlp id) is a literal, never a wildcard.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store, u1, u2;
const ISO = '2026-09-23T12:00:00.000Z';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapterlike-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
  u1 = store.createFirstAdmin({ username: 'a', displayName: 'a', passwordHash: 'scrypt$32768$8$1$aaaa$bbbb' }, null, ISO);
  u2 = store.createUser({ username: 'b', displayName: 'b', passwordHash: 'scrypt$32768$8$1$aaaa$bbbb', role: 'member' }, ISO);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const sorted = (a) => a.slice().sort();

test('removeMediaState sheds the exact id AND its `::c<n>` chapter rows for every user, and nothing that merely resembles them', () => {
  const rows = ['a_b', 'a_b::c1', 'a_b::c12', 'a_b::x', 'a_bx::c1', 'aXb::c1', 'a_b::c', 'zz::c1'];
  for (const r of rows) { store.addLiked(u1.id, r, ISO); store.addLiked(u2.id, r, ISO); }
  store.removeMediaState('a_b');
  const survivors = ['a_b::x', 'a_bx::c1', 'aXb::c1', 'a_b::c', 'zz::c1'];
  assert.deepStrictEqual(sorted(store.getLiked(u1.id)), sorted(survivors), 'user 1: exact + chapter rows gone, lookalikes kept');
  assert.deepStrictEqual(sorted(store.getLiked(u2.id)), sorted(survivors), 'user 2: the same (every user)');
});

test('removeMediaState with a LIST of ids sheds each id\'s chapter rows', () => {
  for (const r of ['one', 'one::c0', 'two::c3', 'three::c1']) store.addLiked(u1.id, r, ISO);
  store.removeMediaState(['one', 'two']);
  assert.deepStrictEqual(store.getLiked(u1.id), ['three::c1']);
});

test('rekeyMediaState carries `old::c<n>` to `new::c<n>` (suffix verbatim) beside the exact row, for every user, and leaves lookalikes', () => {
  for (const r of ['a_b', 'a_b::c1', 'a_b::c12', 'a_b::x', 'a_bx::c1', 'aXb::c1']) { store.addLiked(u1.id, r, ISO); store.addLiked(u2.id, r, ISO); }
  store.rekeyMediaState('a_b', 'moved');
  const expected = ['moved', 'moved::c1', 'moved::c12', 'a_b::x', 'a_bx::c1', 'aXb::c1'];
  assert.deepStrictEqual(sorted(store.getLiked(u1.id)), sorted(expected), 'user 1 carried');
  assert.deepStrictEqual(sorted(store.getLiked(u2.id)), sorted(expected), 'user 2 carried');
  assert.ok(!store.getLiked(u1.id).some((id) => id === 'a_b' || id.startsWith('a_b::c')), 'no row survives under the old base');
});

test('rekeyMediaState: a chapter row already present under the NEW id is replaced, never thrown on (OR REPLACE), and the other user is unaffected', () => {
  store.addLiked(u1.id, 'old::c1', ISO);
  store.addLiked(u1.id, 'new::c1', '2026-01-01T00:00:00.000Z'); // the collision (an in-flight re-key ahead of us)
  store.addLiked(u2.id, 'old::c2', ISO);
  assert.doesNotThrow(() => store.rekeyMediaState('old', 'new'));
  assert.deepStrictEqual(sorted(store.getLiked(u1.id)), ['new::c1'], 'one row under the new id, no duplicate, no throw');
  assert.deepStrictEqual(store.getLiked(u2.id), ['new::c2']);
});

test('a chapter like survives the trash round trip through the two carriers (rekey to a trash id, then back) and dies on purge', () => {
  store.addLiked(u1.id, 'file::c2', ISO);
  store.addLiked(u1.id, 'other::c2', ISO);
  store.rekeyMediaState('file', 'trash-1');
  assert.deepStrictEqual(sorted(store.getLiked(u1.id)), ['other::c2', 'trash-1::c2']);
  store.rekeyMediaState('trash-1', 'file');
  assert.deepStrictEqual(sorted(store.getLiked(u1.id)), ['file::c2', 'other::c2']);
  store.rekeyMediaState('file', 'trash-2');
  store.removeMediaState('trash-2');
  assert.deepStrictEqual(store.getLiked(u1.id), ['other::c2'], 'purge sheds the chapter like; the other file\'s survives');
});
