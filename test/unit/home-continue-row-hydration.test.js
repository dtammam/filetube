'use strict';

// [UNIT] v1.157 (P1, cold-launch crispness): hydrateHomeRow reserves a
// shape-matched skeleton for a home "Continue *" row BEFORE its async fetch, so
// the grid no longer jumps down as the rows arrive. The gate: seed a skeleton
// ONLY when the row had items last launch (a per-row localStorage flag), so a
// user with nothing to continue never gets a reserve-then-collapse. Binds both
// reveal axes (fill on success, clear on empty/error) + the last-seen gate --
// the adversarial's named P1 attack surface (reverse-CLS).

const { test } = require('node:test');
const assert = require('node:assert');

// A Map-backed localStorage stub (Node has none; hydrateHomeRow's try/catch
// would otherwise treat every row as unseen). Set before requiring main.js is
// unnecessary -- main.js touches no storage at load -- but harmless.
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { hydrateHomeRow } = require('../../public/js/main.js');

const flush = () => new Promise((r) => setImmediate(r));
const SEEN = 'ft-home-row-seen:watching';

test('hydrateHomeRow: an UNSEEN row seeds NO skeleton, then fills and records seen', async () => {
  store.clear();
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.resolve('<section>real</section>'));
  // synchronously, before the fetch resolves: no reserve for an unseen row
  assert.strictEqual(host.innerHTML, 'INIT', 'an unseen row must not reserve a skeleton (no reverse-CLS on empty users)');
  await flush();
  assert.strictEqual(host.innerHTML, '<section>real</section>', 'fills with the fetched section html');
  assert.strictEqual(store.get(SEEN), '1', 'records that the row had items');
});

test('hydrateHomeRow: a SEEN row reserves a shape-matched skeleton before the fetch, replaced in place', async () => {
  store.clear();
  store.set(SEEN, '1');
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.resolve('<section>real</section>'));
  assert.match(host.innerHTML, /skeleton-shimmer/, 'a seen row reserves a skeleton before the fetch (no grid jump)');
  assert.match(host.innerHTML, /books-home-row/, 'the skeleton is the shape-matched home-row');
  await flush();
  assert.strictEqual(host.innerHTML, '<section>real</section>', 'the fetched content replaces the skeleton in place');
});

test('hydrateHomeRow: an EMPTY result clears the row and records not-seen (next launch reserves nothing)', async () => {
  store.clear();
  store.set(SEEN, '1');
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.resolve(''));
  await flush();
  assert.strictEqual(host.innerHTML, '', 'an empty result clears the row');
  assert.strictEqual(store.get(SEEN), '0', 'records not-seen so the next cold launch reserves no skeleton');
});

test('hydrateHomeRow: a fetch ERROR clears the row and never leaves it shimmering (reveal-once error axis)', async () => {
  store.clear();
  store.set(SEEN, '1');
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.reject(new Error('net')));
  await flush();
  assert.strictEqual(host.innerHTML, '', 'a fetch error clears the row (the seeded skeleton must not persist)');
});

test('hydrateHomeRow: a null host is a safe no-op', () => {
  assert.doesNotThrow(() => hydrateHomeRow(null, 'watching', () => Promise.resolve('x')));
});
