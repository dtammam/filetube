'use strict';

// lib/feed/mix.js - v1.379.0 Feed mode, plan D3: the PURE card picker.
//
// Given per-kind pools of candidate ids (each pool already ordered most-wanted
// first and already stripped of what this session has shown), pick `count` cards
// so that over a session each kind gets its weight (book 30, video 30, podcast 20,
// Watch later 10, song 10), a kind with nothing left drops out and its weight
// spreads over the rest, and the same kind never comes twice in a row unless only
// one kind has anything left.
//
// The scheduler is a smooth weighted round robin with jitter: every pick adds each
// live kind's weight to its credit, the kind with the highest (credit + a small
// random jitter) that is not the previous kind wins and pays 100. Credit is
// conserved, so the long-run share of each kind is exactly its weight within a
// constant (the plan's falsifier: within 5 points over 1000 cards), while the
// jitter keeps the order from reading like a metronome. `rng` is injectable
// (tests use a seeded one; the route uses Math.random).

const DEFAULT_WEIGHTS = Object.freeze({ book: 30, video: 30, podcast: 20, watchlater: 10, song: 10 });
const KINDS = Object.freeze(Object.keys(DEFAULT_WEIGHTS));
const JITTER = 25;

function liveKinds(pools, weights) {
  return KINDS.filter((k) => weights[k] > 0 && Array.isArray(pools[k]) && pools[k].length > 0);
}

/**
 * Pick up to `count` cards. Pools are consumed (shift) as cards are picked.
 * @param {object} args
 * @param {Object<string, string[]>} args.pools  kind -> ordered candidate ids (mutated)
 * @param {number} args.count
 * @param {object} [args.weights]  kind -> weight (defaults to DEFAULT_WEIGHTS)
 * @param {() => number} [args.rng]
 * @param {string|null} [args.lastKind]  the kind of the card shown just before this batch
 * @param {Object<string, number>} [args.credit]  carried between batches of one session (mutated)
 * @returns {{ picks: Array<{kind:string, id:string}>, lastKind: string|null, exhausted: boolean }}
 *   `exhausted` is true when the pools ran dry before `count` was reached.
 */
function pickCards({ pools, count, weights = DEFAULT_WEIGHTS, rng = Math.random, lastKind = null, credit = {} }) {
  const picks = [];
  const n = Number.isInteger(count) && count > 0 ? Math.min(count, 50) : 5;
  let prev = KINDS.includes(lastKind) ? lastKind : null;
  while (picks.length < n) {
    const live = liveKinds(pools, weights);
    if (live.length === 0) break;
    // A kind that left the mix takes its credit with it; the rest renormalize.
    for (const k of KINDS) if (!live.includes(k)) delete credit[k];
    const total = live.reduce((s, k) => s + weights[k], 0);
    for (const k of live) credit[k] = (credit[k] || 0) + (weights[k] * 100) / total;
    const allowed = live.length > 1 ? live.filter((k) => k !== prev) : live;
    let best = null;
    let bestScore = -Infinity;
    for (const k of allowed) {
      const score = credit[k] + rng() * JITTER;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    credit[best] -= 100;
    picks.push({ kind: best, id: pools[best].shift() });
    prev = best;
  }
  return { picks, lastKind: prev, exhausted: picks.length < n };
}

/** Remove every id in `exclude` (a Set) from each pool, in place; returns the pools. */
function applyExclusions(pools, exclude) {
  for (const k of Object.keys(pools)) {
    if (Array.isArray(pools[k])) pools[k] = pools[k].filter((id) => !exclude.has(id));
  }
  return pools;
}

/** A small seeded PRNG (mulberry32) for the tests' reproducible draws. */
function seededRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { pickCards, applyExclusions, seededRng, DEFAULT_WEIGHTS, KINDS, JITTER };
