'use strict';

// [UNIT] v1.97 "Hide from feed" - the per-user user_feed_hidden store (schema
// v17), against a real temp SQLite adapter. Mirrors user_liked's shape/cascade:
// point add/remove/get, by-media delete on prune, OR-REPLACE re-key on move,
// and cross-user isolation. It must be a fully independent id-keyed carrier -
// NEVER entangled with user_liked (a Like and a feed-hide of the same id are
// orthogonal) and NEVER the admin visibility flag.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedhidden-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ISO = (n) => `2026-08-11T12:00:0${n}.000Z`;

test('add/get/remove round-trip; add is idempotent; get is newest-hidden first', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  assert.deepEqual(store.getFeedHidden(a.id), [], 'starts empty');
  store.addFeedHidden(a.id, 'v1', ISO(1));
  store.addFeedHidden(a.id, 'v2', ISO(3));
  store.addFeedHidden(a.id, 'v3', ISO(2));
  // ORDER BY hidden_at DESC -> newest first (v2@:03, v3@:02, v1@:01).
  assert.deepEqual(store.getFeedHidden(a.id), ['v2', 'v3', 'v1']);
  store.addFeedHidden(a.id, 'v1', ISO(9)); // ON CONFLICT DO NOTHING -> no dup, hidden_at unchanged
  assert.deepEqual(store.getFeedHidden(a.id), ['v2', 'v3', 'v1'], 'idempotent: still one v1, order unchanged');
  store.removeFeedHidden(a.id, 'v3');
  assert.deepEqual(store.getFeedHidden(a.id), ['v2', 'v1']);
  store.removeFeedHidden(a.id, 'nope'); // idempotent remove of an absent id
  assert.deepEqual(store.getFeedHidden(a.id), ['v2', 'v1']);
});

test('cross-user isolation: one user\'s feed-hide never affects another\'s', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
  store.addFeedHidden(a.id, 'shared', ISO(1));
  assert.deepEqual(store.getFeedHidden(a.id), ['shared']);
  assert.deepEqual(store.getFeedHidden(b.id), [], 'B is untouched by A hiding a shared id');
});

test('feed-hide and Like are ORTHOGONAL: the same id can be one, both, or neither, independently', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  store.addLiked(a.id, 'v', ISO(1));
  store.addFeedHidden(a.id, 'v', ISO(1));
  assert.deepEqual(store.getLiked(a.id), ['v']);
  assert.deepEqual(store.getFeedHidden(a.id), ['v'], 'liked AND feed-hidden at once');
  store.removeFeedHidden(a.id, 'v');
  assert.deepEqual(store.getLiked(a.id), ['v'], 'un-hiding from feed does NOT touch the Like');
  assert.deepEqual(store.getFeedHidden(a.id), []);
});

test('removeMediaState drops the feed-hidden row for the purged id (every user), keeps others + keeps liked', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
  for (const u of [a, b]) {
    store.addFeedHidden(u.id, 'doomed', ISO(1));
    store.addFeedHidden(u.id, 'keeper', ISO(1));
    store.addLiked(u.id, 'doomed', ISO(1));
  }
  store.removeMediaState(['doomed']);
  for (const u of [a, b]) {
    assert.deepEqual(store.getFeedHidden(u.id), ['keeper'], 'the purged id\'s feed-hide is gone; the other survives');
    assert.deepEqual(store.getLiked(u.id), [], 'the same purge cleared liked too (unrelated carrier, same cascade)');
  }
});

test('rekeyMediaState carries the feed-hide old->new for every user; a colliding new-id row is replaced, not thrown on', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
  store.addFeedHidden(a.id, 'old', ISO(1));
  store.addFeedHidden(b.id, 'old', ISO(1));
  store.addFeedHidden(b.id, 'new', ISO(1)); // b already has a row under the destination id -> OR REPLACE must not throw
  store.rekeyMediaState('old', 'new');
  assert.deepEqual(store.getFeedHidden(a.id), ['new'], 'a\'s feed-hide followed the move');
  assert.deepEqual(store.getFeedHidden(b.id), ['new'], 'b keeps exactly one row under the new id (no PK-collision throw)');
});

test('schema: user_feed_hidden exists at v17 and cascades on user delete (FK ON DELETE CASCADE)', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
  store.addFeedHidden(b.id, 'v', ISO(1));
  assert.deepEqual(store.getFeedHidden(b.id), ['v']);
  store.deleteUser(b.id); // hard delete -> FK cascade wipes the member's rows
  assert.deepEqual(store.getFeedHidden(b.id), [], 'the deleted user\'s feed-hidden rows are gone');
  // The surviving admin is unaffected.
  assert.deepEqual(store.getFeedHidden(a.id), []);
});
