'use strict';

// [UNIT] v1.85 (adversarial gate SUGGESTION-4): search-history RETENTION. The
// read caps at 20 (server.js SEARCH_HISTORY_CAP), but the TABLE must also be
// pruned on insert so high-cardinality terms cannot accumulate unbounded -
// keep the most-recent SEARCH_HISTORY_RETENTION (50), prune the older rest.
// Mirrors books-user-store.test.js: a real store over a real adapter, with raw
// SQL to count the physical rows (not just the API-visible ones).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-searchstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const rawCount = (uid) => adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_search_history WHERE user_id = ?').get(uid).c;
const at = (i) => `2026-08-03T12:00:${String(i).padStart(2, '0')}.000Z`; // 60 monotonic stamps

test('retention: the table is capped at 50 rows per user on insert, keeping the NEWEST', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'ha' }, {}, at(0));
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'hb', role: 'member' }, at(0));

  for (let i = 0; i < 60; i++) store.addSearchTerm(a.id, `term-${String(i).padStart(2, '0')}`, at(i));
  assert.strictEqual(rawCount(a.id), 50, 'the physical table is pruned to 50 - not left at 60');

  // the newest 20 come back (read cap), newest first
  const recent = store.getSearchHistory(a.id, 20);
  assert.strictEqual(recent.length, 20);
  assert.strictEqual(recent[0], 'term-59', 'newest first');
  // the retained set is the newest 50 (term-10..term-59); term-09 and older were pruned
  const all = adapter.sql.prepare('SELECT term FROM user_search_history WHERE user_id = ? ORDER BY term').all(a.id).map((r) => r.term);
  assert.ok(all.includes('term-10') && !all.includes('term-09'), 'the OLDEST rows are the ones pruned');

  // a re-search of an old-but-still-retained term refreshes recency (no dup)
  store.addSearchTerm(a.id, 'term-10', at(60 + 1));
  assert.strictEqual(store.getSearchHistory(a.id, 1)[0], 'term-10', 're-search moves it to the top');
  assert.strictEqual(rawCount(a.id), 50, 'still 50 (a re-search updates, does not grow)');

  // userB is completely unaffected by userA's churn
  assert.strictEqual(rawCount(b.id), 0);
});
