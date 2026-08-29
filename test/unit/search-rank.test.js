'use strict';

// [UNIT] Wave B - the universal-search ranking primitive (lib/search/rank.js).
// matchTier is the shared match+relevance test (a provider includes iff tier
// >= 0, and rankResults orders by the SAME tier - no divergence). rankResults
// blends across types: relevance tier -> TYPE_PRIORITY -> recency -> id.

const { test } = require('node:test');
const assert = require('node:assert');
const { matchTier, TYPE_PRIORITY, rankResults, toRecency } = require('../../lib/search/rank.js');

// ---- toRecency (gate WARNING 2: ISO-string addedAt must not zero) -----------

test('toRecency: epoch-ms numbers pass through; ISO-8601 strings parse; junk -> 0', () => {
  assert.strictEqual(toRecency(1700000000000), 1700000000000, 'numeric ms unchanged');
  assert.strictEqual(toRecency('2026-08-01T00:00:00Z'), Date.parse('2026-08-01T00:00:00Z'), 'ISO string -> ms');
  assert.ok(toRecency('2026-08-01T00:00:00Z') > toRecency('2024-01-01T00:00:00Z'), 'ISO ordering preserved');
  for (const junk of ['', 'not-a-date', null, undefined, NaN, {}]) {
    assert.strictEqual(toRecency(junk), 0, `junk ${JSON.stringify(junk)} -> 0`);
  }
});

// ---- matchTier --------------------------------------------------------------

test('matchTier: exact/prefix/substring on the title, then identity, then no-match', () => {
  assert.strictEqual(matchTier('Dune', '', 'dune'), 0, 'exact (case-insensitive)');
  assert.strictEqual(matchTier('Dune Part Two', '', 'dune'), 1, 'prefix');
  assert.strictEqual(matchTier('The Dune Special', '', 'dune'), 2, 'substring');
  assert.strictEqual(matchTier('Something Else', 'Frank Herbert', 'herbert'), 3, 'identity field only');
  assert.strictEqual(matchTier('Something Else', 'Frank Herbert', 'tolkien'), -1, 'no match anywhere');
});

test('matchTier: title match WINS over an identity match (tier is the best hit)', () => {
  // query hits both title (substring, tier 2) and identity (tier 3) -> 2.
  assert.strictEqual(matchTier('A Herbert Documentary', 'Frank Herbert', 'herbert'), 2);
});

test('matchTier: empty/whitespace query matches nothing (endpoint returns [])', () => {
  for (const q of ['', '   ', null, undefined]) {
    assert.strictEqual(matchTier('Dune', 'Herbert', q), -1, `q=${JSON.stringify(q)}`);
  }
});

test('matchTier: non-string title/identity are tolerated (never throws)', () => {
  assert.strictEqual(matchTier(null, null, 'x'), -1);
  assert.strictEqual(matchTier(42, undefined, 'x'), -1);
});

// ---- rankResults ------------------------------------------------------------

const R = (resultType, id, title, identityText, recency) => ({ resultType, id, title, identityText, recency });

test('rankResults: relevance tier dominates type - an exact BOOK outranks a substring VIDEO', () => {
  const out = rankResults([
    R('video', 'v1', 'The Dune Retrospective', '', 100), // tier 2
    R('book', 'b1', 'Dune', 'Frank Herbert', 1),         // tier 0
  ], 'dune');
  assert.deepStrictEqual(out.map((r) => r.id), ['b1', 'v1'], 'exact book first despite lower type priority');
});

test('rankResults: within the SAME tier, TYPE_PRIORITY orders (video < audio < music < podcast-show < podcast-episode < tv-show < tv-episode < book)', () => {
  const ids = ['book', 'tv-episode', 'tv-show', 'podcast-episode', 'podcast-show', 'music', 'audio', 'video'];
  // all exact-title matches (tier 0), same recency -> pure type order
  const out = rankResults(ids.map((t, i) => R(t, t, 'Zed', '', 5)), 'zed');
  assert.deepStrictEqual(out.map((r) => r.resultType),
    ['video', 'audio', 'music', 'podcast-show', 'podcast-episode', 'tv-show', 'tv-episode', 'book']);
});

test('rankResults: same tier AND type -> recency desc, then id asc (stable)', () => {
  const out = rankResults([
    R('music', 'm3', 'Song', '', 10),
    R('music', 'm1', 'Song', '', 30),
    R('music', 'm2', 'Song', '', 30),
  ], 'song');
  assert.deepStrictEqual(out.map((r) => r.id), ['m1', 'm2', 'm3'],
    'newer first (30 before 10); equal recency -> id ascending');
});

test('rankResults: does not mutate the input array', () => {
  const input = [R('book', 'b', 'B', '', 1), R('video', 'v', 'B', '', 1)];
  const snapshot = input.slice();
  rankResults(input, 'b');
  assert.deepStrictEqual(input, snapshot, 'input untouched');
});

test('rankResults: an unknown resultType sorts last within its tier, never throws', () => {
  const out = rankResults([
    R('mystery', 'x', 'Song', '', 999),
    R('music', 'm', 'Song', '', 1),
  ], 'song');
  assert.deepStrictEqual(out.map((r) => r.id), ['m', 'x'], 'known type wins the tie even with lower recency');
});

test('TYPE_PRIORITY: every provider resultType has a priority (no gaps that would sort a whole type last)', () => {
  for (const t of ['video', 'audio', 'music', 'podcast-show', 'podcast-episode', 'tv-show', 'tv-episode', 'book']) {
    assert.strictEqual(typeof TYPE_PRIORITY[t], 'number', `priority for ${t}`);
  }
});
