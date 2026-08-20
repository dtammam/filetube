'use strict';

// [UNIT] v1.157 (P1, cold-launch crispness): hydrateHomeRow reserves a per-kind,
// shape-matched skeleton for a home "Continue *" row BEFORE its async fetch, so
// the grid no longer jumps down as the rows arrive. The gate: seed a skeleton
// ONLY when the row had items last launch (a per-row localStorage flag), so a
// user with nothing to continue never gets a reserve-then-collapse. Binds both
// reveal axes + the last-seen gate + the per-kind cover shape (the adversarial's
// named surfaces: reverse-CLS, and the books/listening height mismatch).

const { test } = require('node:test');
const assert = require('node:assert');

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { hydrateHomeRow, buildHomeRowSkeleton } = require('../../public/js/main.js');

const flush = () => new Promise((r) => setImmediate(r));
const SEEN = 'ft-home-row-seen:watching';
const SKEL = '<section class="books-home-row skeleton-shimmer">SKEL</section>';

// ---- hydrateHomeRow: the reserve-then-fill gate + both reveal axes ----------

test('hydrateHomeRow: an UNSEEN row seeds NO skeleton, then fills and records seen', async () => {
  store.clear();
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.resolve('<section>real</section>'), SKEL);
  assert.strictEqual(host.innerHTML, 'INIT', 'an unseen row must not reserve a skeleton (no reverse-CLS on empty users)');
  await flush();
  assert.strictEqual(host.innerHTML, '<section>real</section>', 'fills with the fetched section html');
  assert.strictEqual(store.get(SEEN), '1', 'records that the row had items');
});

test('hydrateHomeRow: a SEEN row reserves the caller\'s skeleton before the fetch, replaced in place', async () => {
  store.clear();
  store.set(SEEN, '1');
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.resolve('<section>real</section>'), SKEL);
  assert.strictEqual(host.innerHTML, SKEL, 'a seen row reserves the shape-matched skeleton before the fetch');
  await flush();
  assert.strictEqual(host.innerHTML, '<section>real</section>', 'the fetched content replaces the skeleton in place');
});

test('hydrateHomeRow: an EMPTY result clears the row and records not-seen (next launch reserves nothing)', async () => {
  store.clear();
  store.set(SEEN, '1');
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.resolve(''), SKEL);
  await flush();
  assert.strictEqual(host.innerHTML, '', 'an empty result clears the row');
  assert.strictEqual(store.get(SEEN), '0', 'records not-seen so the next cold launch reserves no skeleton');
});

test('hydrateHomeRow: a fetch ERROR clears the HOST but LEAVES the flag intact (transient-safe)', async () => {
  store.clear();
  store.set(SEEN, '1');
  const host = { innerHTML: 'INIT' };
  hydrateHomeRow(host, 'watching', () => Promise.reject(new Error('net')), SKEL);
  await flush();
  assert.strictEqual(host.innerHTML, '', 'a fetch error clears the row (the seeded skeleton must not persist)');
  assert.strictEqual(store.get(SEEN), '1', 'the last-known flag is left intact on a transient error');
});

test('hydrateHomeRow: a null host is a safe no-op', () => {
  assert.doesNotThrow(() => hydrateHomeRow(null, 'watching', () => Promise.resolve('x'), SKEL));
});

// ---- buildHomeRowSkeleton: the per-kind cover shape (zero-shift) -------------

test('buildHomeRowSkeleton: the video row reserves a .video-row-cover (16:9), never the taller book cover', () => {
  const html = buildHomeRowSkeleton('video', 4);
  assert.match(html, /class="video-row-card"/, 'video cards');
  assert.match(html, /class="video-row-cover skeleton-shimmer"/, 'the 16:9 video cover box (~92px), matching the real video row');
  assert.ok(!/book-row-cover/.test(html), 'the video skeleton must NOT use the 138px book cover');
});

test('buildHomeRowSkeleton: books + listening reserve the taller .book-row-cover (so those rows do not shift ~46px)', () => {
  const book = buildHomeRowSkeleton('book', 4);
  assert.match(book, /class="book-row-card"/);
  assert.match(book, /class="book-row-cover skeleton-shimmer"/, 'the 138px book cover, matching the real reading row');
  const music = buildHomeRowSkeleton('music', 4);
  assert.match(music, /class="book-row-card music-row-card"/, 'listening cards carry both classes like the real music/podcast card');
  assert.match(music, /class="book-row-cover music-row-cover skeleton-shimmer"/, 'the 138px music cover');
  assert.match(music, /music-row-artist/, 'the listening card has an artist line the book card does not');
});

test('buildHomeRowSkeleton: N cards, all aria-hidden, non-positive count -> empty', () => {
  assert.strictEqual((buildHomeRowSkeleton('video', 5).match(/aria-hidden="true"/g) || []).length, 6, 'section + 5 cards aria-hidden');
  assert.strictEqual(buildHomeRowSkeleton('video', 0), '');
  assert.strictEqual(buildHomeRowSkeleton('book', -2), '');
  assert.strictEqual(buildHomeRowSkeleton('music', 1.5), '');
});
