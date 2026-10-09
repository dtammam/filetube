'use strict';

// [UNIT] v1.380.0 Feed polish, the pure server pieces: the one-minute rule's decision (lib/feed/safe-progress.js), the
// served registry's fresh flag (lib/feed/served.js), the picker's fresh-per-continue rule (lib/feed/mix.js, D9) and the
// intro-skip target (lib/feed/api.js, D8). The integration side (the real routes, the falsifier) is in
// test/integration/feed-api.test.js and feed-progress.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const safe = require('../../lib/feed/safe-progress');
const { createServedRegistry } = require('../../lib/feed/served');
const mix = require('../../lib/feed/mix');
const { introSkipTarget, chapterSliceFor } = require('../../lib/feed/api');

// ---- D7: the decision ------------------------------------------------------------------

test('decideTimeMove: a fresh card writes nothing below 60 s of played time, then behaves exactly as before (forward-only, stale-refusing)', () => {
  const base = { storedSec: 0, nextSec: 100, served: 'ok' };
  for (const playedSec of [0, 10, 59.9, undefined, NaN, -5, '70', null]) {
    assert.deepStrictEqual(safe.decideTimeMove({ ...base, fresh: true, playedSec }), { ok: false, reason: safe.REASONS.TOO_EARLY }, `playedSec=${String(playedSec)}`);
  }
  assert.deepStrictEqual(safe.decideTimeMove({ ...base, fresh: true, playedSec: 60 }), { ok: true, reason: 'ok' });
  assert.deepStrictEqual(safe.decideTimeMove({ ...base, fresh: true, playedSec: 70 }), { ok: true, reason: 'ok' });
  // after the minute the old rule still binds: backward, equal and stale are refused
  assert.strictEqual(safe.decideTimeMove({ storedSec: 100, nextSec: 90, served: 'ok', fresh: true, playedSec: 70 }).reason, 'backward');
  assert.strictEqual(safe.decideTimeMove({ ...base, served: 'stale', fresh: true, playedSec: 70 }).reason, 'stale');
  assert.strictEqual(safe.decideTimeMove({ ...base, served: 'unknown', fresh: true, playedSec: 70 }).reason, 'not-served');
});

test('decideTimeMove: a card that is not fresh is unchanged by playedSec (the old behaviour, byte for byte)', () => {
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 20, nextSec: 30, served: 'ok' }), { ok: true, reason: 'ok' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 20, nextSec: 30, served: 'ok', fresh: false, playedSec: 0 }), { ok: true, reason: 'ok' });
  assert.strictEqual(safe.statusForReason(safe.REASONS.TOO_EARLY), 409, 'a refusal is a conflict, never a server error');
});

test('served registry: fresh is set by the mark, ends with the first landed feed write, and a re-mark judges again', () => {
  let t = 1000;
  const reg = createServedRegistry({ now: () => t });
  assert.strictEqual(reg.isFresh('u', 'media', 'a'), false, 'nothing served');
  reg.mark('u', 'media', 'a', '', 's1', true);
  assert.strictEqual(reg.isFresh('u', 'media', 'a'), true);
  assert.strictEqual(reg.isFresh('u2', 'media', 'a'), false, 'per user');
  reg.advance('u', 'media', 'a', '2026-01-01T00:00:00Z');
  assert.strictEqual(reg.isFresh('u', 'media', 'a'), false, 'a landed write ends fresh');
  reg.mark('u', 'media', 'a', '2026-01-01T00:00:00Z', 's1');
  assert.strictEqual(reg.isFresh('u', 'media', 'a'), false, 'a plain mark is not fresh');
  reg.mark('u', 'media', 'b', '', 's1', true);
  t += 7 * 60 * 60 * 1000;
  assert.strictEqual(reg.isFresh('u', 'media', 'b'), false, 'an aged-out entry is gone');
});

// ---- D9: the mix ------------------------------------------------------------------------

function poolsOf(nCont, nFresh) {
  const mk = (p, n, f) => Array.from({ length: n }, (_, i) => `${p}${f ? 'f' : 'c'}${i}`);
  return {
    book: [], song: [], watchlater: [],
    video: mk('v', nCont, false).concat(mk('v', nFresh, true)),
    podcast: [],
  };
}
const fresh = (kind, id) => /f\d+$/.test(id);

test('D9: with continuing items available, fresh media cards come about one per two continuing ones', () => {
  const pools = poolsOf(40, 40);
  const mediaMix = { fresh: 0, cont: 0 };
  const picked = [];
  // one kind only (video) so only the within-kind choice is under test
  while (picked.length < 30) picked.push(...mix.pickCards({ pools, count: 1, rng: mix.seededRng(7), isFresh: fresh, mediaMix, lastKind: null, credit: {} }).picks);
  const seq = picked.map((p) => (fresh('video', p.id) ? 'N' : 'C')).join('');
  assert.strictEqual(seq, 'CCNCCNCCNCCNCCNCCNCCNCCNCCNCCN', seq);
});

test('D9: with no continuing item the fresh ones fill in; with no fresh one the continuing ones all serve', () => {
  let pools = poolsOf(0, 6);
  let r = mix.pickCards({ pools, count: 6, rng: mix.seededRng(3), isFresh: fresh, mediaMix: { fresh: 0, cont: 0 } });
  assert.strictEqual(r.picks.length, 6);
  assert.ok(r.picks.every((p) => fresh('video', p.id)));
  pools = poolsOf(6, 0);
  r = mix.pickCards({ pools, count: 6, rng: mix.seededRng(3), isFresh: fresh, mediaMix: { fresh: 0, cont: 0 } });
  assert.strictEqual(r.picks.length, 6);
});

test('D9: the kind weights are untouched by the fresh rule (the same draws, the same kinds, with and without isFresh)', () => {
  const build = () => ({
    book: Array.from({ length: 400 }, (_, i) => `b${i}`), song: Array.from({ length: 400 }, (_, i) => `s${i}`),
    video: Array.from({ length: 400 }, (_, i) => (i % 3 === 0 ? `vf${i}` : `vc${i}`)), podcast: Array.from({ length: 400 }, (_, i) => (i % 2 ? `pf${i}` : `pc${i}`)),
    watchlater: Array.from({ length: 400 }, (_, i) => `wf${i}`),
  });
  const a = mix.pickCards({ pools: build(), count: 50, rng: mix.seededRng(11) });
  const b = mix.pickCards({ pools: build(), count: 50, rng: mix.seededRng(11), isFresh: fresh });
  assert.deepStrictEqual(b.picks.map((p) => p.kind), a.picks.map((p) => p.kind), 'only WHICH item a media kind serves changes, never the kind sequence');
});

test('D9: no isFresh given = the v1.379.0 picker exactly (pools consumed head first)', () => {
  const pools = poolsOf(3, 3);
  const r = mix.pickCards({ pools, count: 6, rng: mix.seededRng(5) });
  assert.deepStrictEqual(r.picks.map((p) => p.id), ['vc0', 'vc1', 'vc2', 'vf0', 'vf1', 'vf2']);
});

// ---- D8: the intro skip -----------------------------------------------------------------

test('introSkipTarget: an intro-ish first chapter under 3 minutes starts at chapter 2; nothing else does', () => {
  const ch = (...pairs) => pairs.map(([startTime, title]) => ({ startTime, title }));
  assert.strictEqual(introSkipTarget(ch([0, 'Intro'], [45, 'The build'], [600, 'End'])), 45);
  assert.strictEqual(introSkipTarget(ch([0, 'INTRODUCTION'], [90, 'Part 1'])), 90);
  assert.strictEqual(introSkipTarget(ch([0, 'Sponsor message'], [30, 'Part 1'])), 30);
  assert.strictEqual(introSkipTarget(ch([0, 'Ad'], [20, 'Part 1'])), 20);
  assert.strictEqual(introSkipTarget(ch([0, 'Opening'], [100, 'Part 1'])), 100);
  assert.strictEqual(introSkipTarget(ch([0, '0:00'], [60, 'Part 1'])), 60);
  assert.strictEqual(introSkipTarget(ch([0, 'Intro'], [180, 'Part 1'])), null, 'exactly 3 minutes is not under 3 minutes');
  assert.strictEqual(introSkipTarget(ch([0, 'Intro'], [900, 'Part 1'])), null, 'a long "intro" is the video');
  assert.strictEqual(introSkipTarget(ch([0, 'Introducing the fix'], [60, 'Part 1'])), null, 'whole word: "Introducing" is not "intro"');
  assert.strictEqual(introSkipTarget(ch([0, 'Radio'], [60, 'Part 1'])), null, 'whole word: "ad" inside Radio');
  assert.strictEqual(introSkipTarget(ch([0, 'Part 1'], [60, 'Part 2'])), null);
  assert.strictEqual(introSkipTarget(ch([0, 'Intro'])), null, 'one chapter: nothing to skip to');
  assert.strictEqual(introSkipTarget(null), null);
  assert.strictEqual(introSkipTarget(ch([60, 'Part 1'], [0, 'Opening'])), 60, 'chapters are ordered by start time, whatever order they arrive in');
});

test('introSkipTarget feeds chapterSliceFor: the card opens on chapter 2 with its chapter record', () => {
  const chapters = [{ startTime: 0, title: 'Intro' }, { startTime: 45, title: 'The build' }, { startTime: 600, title: 'End' }];
  const slice = chapterSliceFor(chapters, introSkipTarget(chapters), 900);
  assert.deepStrictEqual({ startAt: slice.startAt, endAt: slice.endAt, index: slice.chapter.index }, { startAt: 45, endAt: 600, index: 1 });
});
