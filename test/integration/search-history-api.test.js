'use strict';

// [INTEGRATION] v1.85 #1 - the per-user search-history API (the mobile
// magnifier's recent list). Binds: POST adds (normalized); GET lists recent
// DESC; a re-search DEDUPES (updates recency, no duplicate); DELETE one; the
// guarded clear-all (a trailing-slash / missing-term form must NOT wipe all -
// the v1.64 alias lesson); CROSS-USER isolation (two distinct users); the cap.
// Isolated DATA_DIR; own process; cleans up (residual #110).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-search-hist-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession, __resetDatabaseForTests } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, uid, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  uid = auth.user.id;
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
beforeEach(async () => { await __resetDatabaseForTests(); });

const post = (term, cookie) => fetch(`${base}/api/search-history`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify({ term }),
});
const list = (cookie) => fetch(`${base}/api/search-history`, cookie ? { headers: { Cookie: cookie } } : {}).then((r) => r.json()).then((b) => b.terms);
const delOne = (term, cookie) => fetch(`${base}/api/search-history/${encodeURIComponent(term)}`, { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });
const clearAll = (cookie) => fetch(`${base}/api/search-history`, { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });

test('POST adds a normalized term; GET lists it', async () => {
  const r = await post('  Fireship  ');
  const body = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(body.term, 'Fireship', 'stored trimmed');
  assert.deepStrictEqual(await list(), ['Fireship']);
});

test('POST rejects an empty/whitespace term (400, nothing stored)', async () => {
  const r = await post('   ');
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(await list(), []);
});

test('recency: newest first; a re-search DEDUPES and moves to the top', async () => {
  await post('alpha');
  await post('beta');
  await post('gamma');
  assert.deepStrictEqual(await list(), ['gamma', 'beta', 'alpha']);
  await post('alpha'); // re-search -> updates recency, not a duplicate
  const terms = await list();
  assert.deepStrictEqual(terms, ['alpha', 'gamma', 'beta'], 'alpha jumps to top, no duplicate');
  assert.strictEqual(terms.filter((t) => t === 'alpha').length, 1, 'exactly one alpha');
});

test('DELETE one removes just that term', async () => {
  await post('keep');
  await post('drop');
  const r = await delOne('drop');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await list(), ['keep']);
});

test('clear-all wipes this user; a trailing-slash / missing-term form does NOT (the alias guard)', async () => {
  await post('one');
  await post('two');
  // The missing-term alias must be refused (never a silent wipe-all).
  const guarded = await fetch(`${base}/api/search-history/`, { method: 'DELETE' });
  assert.strictEqual(guarded.status, 400, 'DELETE /api/search-history/ is refused');
  assert.strictEqual((await list()).length, 2, 'nothing wiped by the guarded form');
  // The real clear-all works.
  const r = await clearAll();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await list(), []);
});

test('cross-user isolation: one user\'s history never leaks to another', async () => {
  const other = __mintTestSession({ username: 'searchOther' });
  await post('mine');
  await post('secret', other.cookie);
  assert.deepStrictEqual(await list(), ['mine'], 'userA sees only theirs');
  assert.deepStrictEqual(await list(other.cookie), ['secret'], 'userB sees only theirs');
  // userA clearing does not touch userB.
  await clearAll();
  assert.deepStrictEqual(await list(), []);
  assert.deepStrictEqual(await list(other.cookie), ['secret'], 'userB untouched by userA clear');
});

test('the GET is capped (recent 20), newest kept', async () => {
  for (let i = 0; i < 25; i++) {
    // distinct searched_at ordering: sequential awaits give monotonic ISO stamps
    await post(`term-${String(i).padStart(2, '0')}`);
  }
  const terms = await list();
  assert.strictEqual(terms.length, 20, 'capped at 20');
  assert.strictEqual(terms[0], 'term-24', 'newest first');
  assert.ok(!terms.includes('term-00'), 'the oldest fell off the cap');
});

test('the store cascade + reset: search history is per-user and reset between cases', async () => {
  await post('leftover');
  assert.deepStrictEqual(await list(), ['leftover']);
  await __resetDatabaseForTests();
  assert.deepStrictEqual(await list(), [], '__clearUserStateForTests wipes search history (no bleed)');
  // direct store check
  userStore.addSearchTerm(uid, 'direct', new Date().toISOString());
  assert.ok((await list()).includes('direct'));
});
