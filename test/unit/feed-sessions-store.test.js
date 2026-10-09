'use strict';

// [UNIT] v1.379.0 Feed mode, plan D13: the per-user user_feed_sessions table (schema
// v35) against a real temp SQLite adapter: create / get / extend / finish / the
// D5 move record, retention, the moves cap, cross-user isolation, the backup
// carrier (export -> restore, a bundle without the key, a hostile bundle row),
// the user cascade and the test reset. The v34 -> v35 migration is in
// db-sqlite-adapter.test.js beside the other floors.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store, a, b;
const ISO = (n) => `2026-10-09T12:00:${String(n).padStart(2, '0')}.000Z`;
const SID = (n) => String(n).padStart(16, '0').replace(/[^0-9a-f]/g, '0');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedsess-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
  a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('create / get: a fresh session has no extensions, no actual time and no summary; unknown and other-user ids are null', () => {
  const s = store.createFeedSession(a.id, { id: SID(1), startedAt: ISO(1), plannedMin: 20 });
  assert.deepStrictEqual(s, { id: SID(1), startedAt: ISO(1), plannedMin: 20, extensions: 0, actualSec: null, summary: null });
  assert.deepStrictEqual(store.getFeedSession(a.id, SID(1)), s);
  assert.strictEqual(store.getFeedSession(a.id, SID(2)), null);
  assert.strictEqual(store.getFeedSession(b.id, SID(1)), null, 'another user never sees it');
  assert.deepStrictEqual(store.listFeedSessions(b.id), []);
});

test('updateFeedSession: extensions and actualSec replace; the summary replaces the client keys but keeps the server moves', () => {
  store.createFeedSession(a.id, { id: SID(1), startedAt: ISO(1), plannedMin: 10 });
  store.appendFeedSessionMove(a.id, SID(1), { kind: 'book', id: 'bk', from: null, to: { spineIndex: 0, blockIndex: 3 }, at: ISO(2) });
  let s = store.updateFeedSession(a.id, SID(1), { extensions: 1 });
  assert.strictEqual(s.extensions, 1);
  assert.strictEqual(s.summary.moves.length, 1, 'an extension leaves the moves alone');
  s = store.updateFeedSession(a.id, SID(1), { actualSec: 612, summary: { pages: 14, songs: 3 } });
  assert.strictEqual(s.actualSec, 612);
  assert.deepStrictEqual(Object.keys(s.summary).sort(), ['moves', 'pages', 'songs']);
  s = store.updateFeedSession(a.id, SID(1), { summary: { pages: 15 } });
  assert.deepStrictEqual(Object.keys(s.summary).sort(), ['moves', 'pages'], 'a later summary replaces the client keys (songs gone), moves stay');
  assert.strictEqual(s.summary.moves[0].id, 'bk');
  // a client summary cannot smuggle a moves key over the server's
  s = store.updateFeedSession(a.id, SID(1), { summary: { moves: [{ fake: true }], pages: 1 } });
  assert.strictEqual(s.summary.moves[0].id, 'bk', 'the server moves win');
  assert.strictEqual(store.updateFeedSession(a.id, SID(9), { extensions: 1 }), null);
  assert.strictEqual(store.updateFeedSession(b.id, SID(1), { extensions: 5 }), null, 'another user cannot patch it');
  assert.strictEqual(store.getFeedSession(a.id, SID(1)).extensions, 1);
});

test('appendFeedSessionMove keeps the newest FEED_SESSION_MOVES_CAP moves, in order', () => {
  store.createFeedSession(a.id, { id: SID(1), startedAt: ISO(1), plannedMin: 10 });
  for (let i = 0; i < store.FEED_SESSION_MOVES_CAP + 5; i++) store.appendFeedSessionMove(a.id, SID(1), { kind: 'media', id: `m${i}`, from: i, to: i + 1, at: ISO(i % 60) });
  const moves = store.getFeedSession(a.id, SID(1)).summary.moves;
  assert.strictEqual(moves.length, store.FEED_SESSION_MOVES_CAP);
  assert.strictEqual(moves[0].id, 'm5');
  assert.strictEqual(moves[moves.length - 1].id, `m${store.FEED_SESSION_MOVES_CAP + 4}`);
  assert.strictEqual(store.appendFeedSessionMove(b.id, SID(1), { kind: 'media', id: 'x' }), null);
  // setFeedSessionMoves replaces the list (the routes coalesce a ping chain), bounded, client keys untouched
  store.updateFeedSession(a.id, SID(1), { summary: { pages: 2 } });
  const s2 = store.setFeedSessionMoves(a.id, SID(1), [{ kind: 'podcast', id: 'e', from: 1, to: 9 }]);
  assert.deepStrictEqual(s2.summary, { pages: 2, moves: [{ kind: 'podcast', id: 'e', from: 1, to: 9 }] });
  assert.strictEqual(store.setFeedSessionMoves(a.id, SID(1), Array.from({ length: 500 }, (_, i) => ({ i }))).summary.moves.length, store.FEED_SESSION_MOVES_CAP);
  assert.strictEqual(store.setFeedSessionMoves(b.id, SID(1), []), null);
});

test('retention: a user keeps their newest FEED_SESSION_RETENTION sessions; listFeedSessionsSince filters by start', () => {
  const n = store.FEED_SESSION_RETENTION + 3;
  for (let i = 0; i < n; i++) store.createFeedSession(a.id, { id: SID(i + 1), startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 60000).toISOString(), plannedMin: 10 });
  const all = store.listFeedSessions(a.id);
  assert.strictEqual(all.length, store.FEED_SESSION_RETENTION);
  assert.strictEqual(all[0].id, SID(4), 'the three oldest are gone');
  const since = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + (n - 2) * 60000).toISOString();
  assert.strictEqual(store.listFeedSessionsSince(a.id, since).length, 2);
  assert.deepStrictEqual(store.listFeedSessions(b.id), [], 'retention is per user');
});

test('backup export -> restore round-trips every field per user; a bundle without feedSessions restores empty; hostile rows are dropped', () => {
  store.createFeedSession(a.id, { id: SID(1), startedAt: ISO(1), plannedMin: 30 });
  store.updateFeedSession(a.id, SID(1), { extensions: 2, actualSec: 2400, summary: { pages: 9 } });
  store.appendFeedSessionMove(a.id, SID(1), { kind: 'podcast', id: 'ep', from: 10, to: 250, at: ISO(5) });
  store.createFeedSession(b.id, { id: SID(2), startedAt: ISO(2), plannedMin: 10 });
  const bundle = store.exportUsersForBackup();
  const ab = bundle.find((u) => u.id === a.id);
  assert.strictEqual(ab.feedSessions.length, 1);
  assert.strictEqual(ab.feedSessions[0].summary.moves[0].to, 250);
  store.replaceAllUsersRaw(bundle);
  assert.deepStrictEqual(store.getFeedSession(a.id, SID(1)), { id: SID(1), startedAt: ISO(1), plannedMin: 30, extensions: 2, actualSec: 2400, summary: { pages: 9, moves: [{ kind: 'podcast', id: 'ep', from: 10, to: 250, at: ISO(5) }] } });
  assert.strictEqual(store.getFeedSession(b.id, SID(2)).plannedMin, 10);

  const stripped = store.exportUsersForBackup();
  for (const u of stripped) delete u.feedSessions;
  store.replaceAllUsersRaw(stripped);
  assert.deepStrictEqual(store.listFeedSessions(a.id), [], 'absent key restores empty');

  const hostile = store.exportUsersForBackup();
  hostile.find((u) => u.id === a.id).feedSessions = [
    { id: 'not-hex', startedAt: ISO(1), plannedMin: 10 },
    { id: SID(3), startedAt: 'yesterday', plannedMin: 10 },
    { id: SID(4), startedAt: ISO(1), plannedMin: 15 },
    { id: SID(5), startedAt: ISO(1), plannedMin: 10, extensions: 9999, actualSec: -5, summary: { big: 'x'.repeat(store.FEED_SESSION_SUMMARY_MAX_BYTES) } },
    { id: SID(6), startedAt: ISO(1), plannedMin: 10, extensions: 3, actualSec: 99, summary: { ok: true } },
  ];
  store.replaceAllUsersRaw(hostile);
  const rows = store.listFeedSessions(a.id);
  assert.deepStrictEqual(rows.map((r) => r.id), [SID(5), SID(6)], 'three malformed rows dropped, two kept');
  assert.strictEqual(rows[0].extensions, store.FEED_SESSION_MAX_EXTENSIONS, 'clamped');
  assert.strictEqual(rows[0].actualSec, null, 'a negative time is dropped');
  assert.strictEqual(rows[0].summary, null, 'an oversized summary is dropped, the row kept');
  assert.deepStrictEqual(rows[1].summary, { ok: true });
});

test('restore (gate r1): a long session keeps its moves even when the client part is at the cap; moves are shape-checked and capped on their own', () => {
  store.createFeedSession(a.id, { id: SID(1), startedAt: ISO(1), plannedMin: 30 });
  const moves = Array.from({ length: store.FEED_SESSION_MOVES_CAP }, (_, i) => ({ kind: 'book', id: 'b' + i, from: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:0)', spineIndex: 0, blockIndex: i }, to: { kind: 'epub', cfi: '', spineIndex: 0, blockIndex: i + 1 }, at: ISO(1) }));
  store.setFeedSessionMoves(a.id, SID(1), moves);
  store.updateFeedSession(a.id, SID(1), { actualSec: 2400, summary: { pages: 9, note: 'x'.repeat(store.FEED_SESSION_SUMMARY_MAX_BYTES - 200) } });
  const before = store.getFeedSession(a.id, SID(1));
  assert.ok(Buffer.byteLength(JSON.stringify(before.summary), 'utf8') > store.FEED_SESSION_SUMMARY_MAX_BYTES, 'the stored summary is over the client cap once the moves are in');
  const bundle = store.exportUsersForBackup();
  store.replaceAllUsersRaw(bundle);
  const after = store.getFeedSession(a.id, SID(1));
  assert.strictEqual(after.summary.moves.length, store.FEED_SESSION_MOVES_CAP, 'the moves survive the round trip');
  assert.strictEqual(after.summary.pages, 9, 'and so do the client keys (they fit the cap on their own)');
  // a client part over the cap loses the client keys and keeps the moves
  const big = store.exportUsersForBackup();
  big.find((u) => u.id === a.id).feedSessions[0].summary.note = 'y'.repeat(store.FEED_SESSION_SUMMARY_MAX_BYTES + 1);
  store.replaceAllUsersRaw(big);
  const trimmed = store.getFeedSession(a.id, SID(1)).summary;
  assert.deepStrictEqual(Object.keys(trimmed), ['moves']);
  // smuggled moves: non-objects dropped, the list capped to the newest
  const hostile = store.exportUsersForBackup();
  hostile.find((u) => u.id === a.id).feedSessions[0].summary = { pages: 1, moves: ['x', null, { kind: 'media', id: 'm' }, { id: 'no-kind' }].concat(Array.from({ length: 400 }, (_, i) => ({ kind: 'song', id: 's' + i }))) };
  store.replaceAllUsersRaw(hostile);
  const h = store.getFeedSession(a.id, SID(1)).summary;
  assert.strictEqual(h.moves.length, store.FEED_SESSION_MOVES_CAP);
  assert.ok(h.moves.every((m) => typeof m.kind === 'string' && typeof m.id === 'string'));
  assert.strictEqual(h.moves[h.moves.length - 1].id, 's399', 'the NEWEST are kept');
});

test('deleting a user cascades their sessions away; the survivor is untouched; the test reset empties the table', () => {
  store.createFeedSession(a.id, { id: SID(1), startedAt: ISO(1), plannedMin: 10 });
  store.createFeedSession(b.id, { id: SID(1), startedAt: ISO(1), plannedMin: 10 });
  store.deleteUser(b.id);
  assert.deepStrictEqual(store.listFeedSessions(b.id), []);
  assert.strictEqual(store.listFeedSessions(a.id).length, 1);
  store.__clearUserStateForTests();
  assert.deepStrictEqual(store.listFeedSessions(a.id), []);
});
