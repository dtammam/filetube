'use strict';

// [UNIT] v1.379.0 Feed mode, plan D3: the pure card picker (lib/feed/mix.js). The
// plan's falsifier (weights within 5 points over 1000 cards) is run here with a
// seeded rng, plus the never-twice-in-a-row rule, the drop-out-and-spread rule, the
// exhaustion signal and the exclusion helper. Each rule is driven from a state where
// it can fail (five full pools, two pools, one pool, empty pools).

const { test } = require('node:test');
const assert = require('node:assert');
const mix = require('../../lib/feed/mix');

function fullPools(n) {
  const pools = {};
  for (const k of mix.KINDS) { pools[k] = []; for (let i = 0; i < n; i++) pools[k].push(`${k}${i}`); }
  return pools;
}

test('weights: over 1000 cards every kind lands within 5 points of 30/30/20/10/10 (seeded rng, batches of 5 like the route)', () => {
  for (const seed of [1, 7, 42, 2026]) {
    const rng = mix.seededRng(seed);
    const pools = fullPools(1000);
    const credit = {};
    let last = null;
    const kinds = [];
    while (kinds.length < 1000) {
      const r = mix.pickCards({ pools, count: 5, rng, lastKind: last, credit });
      last = r.lastKind;
      for (const p of r.picks) kinds.push(p.kind);
      assert.strictEqual(r.exhausted, false);
    }
    const share = {};
    for (const k of kinds) share[k] = (share[k] || 0) + 0.1;
    for (const k of mix.KINDS) {
      assert.ok(Math.abs(share[k] - mix.DEFAULT_WEIGHTS[k]) <= 5, `seed ${seed}: ${k} ${share[k].toFixed(1)}% vs ${mix.DEFAULT_WEIGHTS[k]}`);
    }
  }
});

test('never the same kind twice in a row across batch boundaries (lastKind carried)', () => {
  const rng = mix.seededRng(3);
  const pools = fullPools(400);
  const credit = {};
  let last = null;
  const kinds = [];
  for (let b = 0; b < 80; b++) {
    const r = mix.pickCards({ pools, count: 5, rng, lastKind: last, credit });
    last = r.lastKind;
    for (const p of r.picks) kinds.push(p.kind);
  }
  for (let i = 1; i < kinds.length; i++) assert.notStrictEqual(kinds[i], kinds[i - 1], `repeat at ${i}`);
  // the carried lastKind binds: without it the first pick of a batch could repeat
  const r1 = mix.pickCards({ pools: fullPools(5), count: 1, rng: () => 0, lastKind: null, credit: {} });
  const r2 = mix.pickCards({ pools: fullPools(5), count: 1, rng: () => 0, lastKind: r1.lastKind, credit: {} });
  assert.notStrictEqual(r2.picks[0].kind, r1.picks[0].kind);
});

test('a kind with nothing left drops out and its weight spreads; two kinds alternate; one kind repeats (the only exception)', () => {
  const rng = mix.seededRng(9);
  const two = { book: Array.from({ length: 50 }, (_, i) => `b${i}`), video: [], podcast: [], watchlater: [], song: Array.from({ length: 50 }, (_, i) => `s${i}`) };
  const r = mix.pickCards({ pools: two, count: 40, rng });
  const kinds = r.picks.map((p) => p.kind);
  for (let i = 1; i < kinds.length; i++) assert.notStrictEqual(kinds[i], kinds[i - 1], 'two kinds strictly alternate');
  assert.strictEqual(kinds.filter((k) => k === 'book').length, 20);
  assert.strictEqual(kinds.filter((k) => k === 'song').length, 20, 'the other three weights spread over the two that remain (30:10 cannot alternate exactly, the rule wins)');
  const one = { book: ['x', 'y', 'z'], video: [], podcast: [], watchlater: [], song: [] };
  const r1 = mix.pickCards({ pools: one, count: 3, rng });
  assert.deepStrictEqual(r1.picks.map((p) => p.kind), ['book', 'book', 'book'], 'only one kind left: it repeats');
  assert.deepStrictEqual(r1.picks.map((p) => p.id), ['x', 'y', 'z'], 'pool order is the pick order (most-wanted first)');
  assert.strictEqual(r1.exhausted, false);
});

test('a pool that runs dry mid-batch hands over to the rest; dry everything is exhausted', () => {
  const rng = mix.seededRng(11);
  const pools = { book: ['b1'], video: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], podcast: [], watchlater: [], song: [] };
  const r = mix.pickCards({ pools, count: 5, rng });
  assert.strictEqual(r.picks.length, 5);
  assert.strictEqual(r.picks.filter((p) => p.kind === 'book').length, 1);
  assert.strictEqual(r.picks.filter((p) => p.kind === 'video').length, 4);
  assert.strictEqual(r.exhausted, false);
  const empty = mix.pickCards({ pools: { book: [], video: [], podcast: [], watchlater: [], song: [] }, count: 5, rng });
  assert.deepStrictEqual(empty.picks, []);
  assert.strictEqual(empty.exhausted, true);
  assert.strictEqual(empty.lastKind, null);
  const short = mix.pickCards({ pools: { book: ['a'], video: ['b'], podcast: [], watchlater: [], song: [] }, count: 5, rng });
  assert.strictEqual(short.picks.length, 2);
  assert.strictEqual(short.exhausted, true, 'fewer than asked = exhausted');
});

test('count is bounded (1..50; junk -> 5) and a zero-weight kind never appears', () => {
  const rng = mix.seededRng(5);
  assert.strictEqual(mix.pickCards({ pools: fullPools(100), count: 0, rng }).picks.length, 5);
  assert.strictEqual(mix.pickCards({ pools: fullPools(100), count: 'x', rng }).picks.length, 5);
  assert.strictEqual(mix.pickCards({ pools: fullPools(100), count: 999, rng }).picks.length, 50);
  const r = mix.pickCards({ pools: fullPools(100), count: 50, rng, weights: { book: 50, video: 50, podcast: 0, watchlater: 0, song: 0 } });
  assert.ok(r.picks.every((p) => p.kind === 'book' || p.kind === 'video'));
});

test('applyExclusions removes shown ids from every pool in place', () => {
  const pools = { book: ['a', 'b'], video: ['c'], podcast: [], watchlater: ['a'], song: ['d'] };
  mix.applyExclusions(pools, new Set(['a', 'd']));
  assert.deepStrictEqual(pools, { book: ['b'], video: ['c'], podcast: [], watchlater: [], song: [] });
});

test('seededRng is deterministic and in [0, 1)', () => {
  const a = mix.seededRng(99); const b = mix.seededRng(99);
  for (let i = 0; i < 100; i++) { const x = a(); assert.strictEqual(x, b()); assert.ok(x >= 0 && x < 1); }
});
