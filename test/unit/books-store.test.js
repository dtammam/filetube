'use strict';

// [UNIT] v1.37.0 T3: lib/books/store.js -- namespace backfill, prune policy,
// shelf-pin validation + reducers + deps-backed mutators. The pin matrix is
// ported from the ytdlp-store pin tests (same semantics: idempotent add,
// order-gap-safe tail append, FIFO cap, stable-partition reorder).

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const store = require('../../lib/books/store');

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

// ---- ensureBooks -------------------------------------------------------------

test('T3: ensureBooks builds a fresh well-formed namespace and is idempotent (present keys untouched)', () => {
  const db = {};
  const ns = store.ensureBooks(db);
  assert.deepEqual(ns, { folders: [], items: {}, progress: {}, pins: [], settings: {} });
  ns.items.abc = { id: 'abc' };
  ns.folders.push('/books');
  const again = store.ensureBooks(db);
  assert.equal(again.items.abc.id, 'abc', 'a present namespace is never rebuilt');
  assert.deepEqual(again.folders, ['/books']);
});

test('T3: ensureBooks repairs individually broken sub-keys without touching healthy ones', () => {
  const db = { books: { folders: 'junk', items: { a: { id: 'a' } }, progress: null, pins: {}, settings: [] } };
  const ns = store.ensureBooks(db);
  assert.deepEqual(ns.folders, []);
  assert.equal(ns.items.a.id, 'a', 'healthy items map preserved');
  assert.deepEqual(ns.progress, {});
  assert.deepEqual(ns.pins, []);
  assert.deepEqual(ns.settings, {});
});

// ---- selectPrunableBookIds ----------------------------------------------------

test('T3: prune policy matrix -- pruneMissing off prunes nothing; missing root protects its items; genuine deletes prune', () => {
  const items = {
    keep1: { id: 'keep1', rootFolder: '/books/a' },
    gone1: { id: 'gone1', rootFolder: '/books/a' },
    unmounted1: { id: 'unmounted1', rootFolder: '/books/b' },
  };
  const surviving = new Set(['keep1']);
  assert.deepEqual(
    store.selectPrunableBookIds(items, surviving, { missingRoots: new Set(), pruneMissing: false }),
    [], 'pruneMissing off = nothing prunes, ever',
  );
  assert.deepEqual(
    store.selectPrunableBookIds(items, surviving, { missingRoots: new Set(['/books/b']), pruneMissing: true }),
    ['gone1'], 'the unmounted root’s item is protected; the genuine delete prunes',
  );
  assert.deepEqual(
    store.selectPrunableBookIds({}, new Set(), { pruneMissing: true }),
    [], 'empty library is a no-op',
  );
});

// ---- validateShelfPinInput ----------------------------------------------------

test('T3: shelf-pin validation -- confinement under a configured book root, label trim/bound, hostile shapes rejected', () => {
  const roots = ['/srv/books'];
  assert.deepEqual(
    store.validateShelfPinInput({ dir: '/srv/books/SciFi', label: '  Sci-Fi  ' }, roots),
    { ok: true, value: { dir: '/srv/books/SciFi', label: 'Sci-Fi' } },
  );
  assert.equal(store.validateShelfPinInput({ dir: '/srv/books' }, roots).ok, true, 'the root itself is pinnable');
  assert.equal(store.validateShelfPinInput({ dir: '/etc' }, roots).ok, false, 'outside every root');
  assert.equal(store.validateShelfPinInput({ dir: '/srv/books/../secrets' }, roots).ok, false, 'traversal never escapes');
  assert.equal(store.validateShelfPinInput({ dir: '' }, roots).ok, false);
  assert.equal(store.validateShelfPinInput({}, roots).ok, false);
  assert.equal(store.validateShelfPinInput({ dir: '/srv/books/x' }, []).ok, false, 'no roots configured = nothing confines = reject');
  const longLabel = store.validateShelfPinInput({ dir: '/srv/books/x', label: 'y'.repeat(500) }, roots);
  assert.equal(longLabel.value.label.length, 150, 'label bounded');
});

// ---- pin reducers (ported matrix) ---------------------------------------------

test('T3: reduceAddShelfPin -- idempotent, order-gap-safe tail append, FIFO cap', () => {
  let pins = [];
  const r1 = store.reduceAddShelfPin(pins, { id: 'a', dir: '/b/a', label: 'A', pinnedAt: 't' });
  assert.equal(r1.changed, true);
  assert.equal(r1.record.order, 0);
  pins = r1.pins;
  const r2 = store.reduceAddShelfPin(pins, { id: 'b', dir: '/b/b', label: 'B', pinnedAt: 't' });
  pins = r2.pins;
  assert.equal(r2.record.order, 1);
  // Idempotent re-add returns the EXISTING record, unchanged.
  const r3 = store.reduceAddShelfPin(pins, { id: 'a', dir: '/b/a', label: 'A2', pinnedAt: 't2' });
  assert.equal(r3.changed, false);
  assert.equal(r3.record.label, 'A', 'the existing record wins');
  // Order-gap: remove 'a' (order 0), then add 'c' -- its order must be
  // max(existing)+1 = 2, NEVER list.length (which would collide at 1).
  pins = store.reduceRemoveShelfPin(pins, 'a').pins;
  const r4 = store.reduceAddShelfPin(pins, { id: 'c', dir: '/b/c', label: 'C', pinnedAt: 't' });
  assert.equal(r4.record.order, 2, 'tail append past the surviving max order');
  // FIFO cap.
  let many = [];
  for (let i = 0; i < store.MAX_SHELF_PINS + 5; i++) {
    many = store.reduceAddShelfPin(many, { id: `p${i}`, dir: `/b/p${i}`, label: `${i}`, pinnedAt: 't' }).pins;
  }
  assert.equal(many.length, store.MAX_SHELF_PINS);
  assert.equal(many[0].id, 'p5', 'oldest dropped first');
});

test('T3: reduceRemoveShelfPin -- unknown id is changed:false with equal contents (caller skips the save)', () => {
  const pins = [{ id: 'a', order: 0 }];
  const result = store.reduceRemoveShelfPin(pins, 'ghost');
  assert.equal(result.changed, false);
  assert.deepEqual(result.pins, pins);
});

test('T3: reduceReorderShelfPins -- leading ids in requested order, stable-partitioned tail, unknown/duplicate ids ignored', () => {
  const pins = [
    { id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }, { id: 'd', order: 3 },
  ];
  const next = store.reduceReorderShelfPins(pins, ['c', 'a', 'c', 'ghost']);
  const byId = Object.fromEntries(next.map((p) => [p.id, p.order]));
  assert.deepEqual(byId, { c: 0, a: 1, b: 2, d: 3 }, 'c,a lead; b,d keep their relative order after');
  assert.deepEqual(store.reduceReorderShelfPins(pins, 'junk').map((p) => p.order), [0, 1, 2, 3], 'malformed input degrades to identity');
});

// ---- deps-backed mutators ------------------------------------------------------

test('T3: addShelfPin/removeShelfPin/listShelfPins/reorderShelfPins round-trip through the fake deps', async () => {
  const deps = makeFakeDeps();
  const rec = await store.addShelfPin(deps, { dir: '/srv/books/SciFi', label: 'Sci-Fi' });
  assert.equal(rec.dir, '/srv/books/SciFi');
  await store.addShelfPin(deps, { dir: '/srv/books/History', label: 'History' });
  assert.deepEqual(store.listShelfPins(deps).map((p) => p.label), ['Sci-Fi', 'History']);
  await store.reorderShelfPins(deps, [store.listShelfPins(deps)[1].id]);
  assert.deepEqual(store.listShelfPins(deps).map((p) => p.label), ['History', 'Sci-Fi']);
  assert.equal(await store.removeShelfPin(deps, rec.id), true);
  assert.equal(await store.removeShelfPin(deps, rec.id), false, 'second remove 404s');
  assert.deepEqual(store.listShelfPins(deps).map((p) => p.label), ['History']);
});
