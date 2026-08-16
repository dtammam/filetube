'use strict';

// [UNIT] v1.139 (Dean): autoplay in a playlist/folder context WRAPS - the
// last item's 'ended' advances back to the FIRST. Scope rulings: the browse
// CONTEXT only (the queue stays finite by design); single-item contexts do
// not wrap (the Loop toggle owns that intent); a stale/foreign ended-id must
// never teleport playback to someone else's list head. Overturns the v1.30
// "end of the order -- no wrap, no-op" decision at the one converged seam.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAutoplayAdvanceTarget } = require('../../public/js/player.js');

// ---- resolveAutoplayAdvanceTarget (pure) -----------------------------------

test('a natural next always wins - the wrap never overrides mid-list order', () => {
  assert.strictEqual(resolveAutoplayAdvanceTarget('b', ['a', 'b', 'c'], 'a'), 'b');
  assert.strictEqual(resolveAutoplayAdvanceTarget('c', ['a', 'b', 'c'], 'b'), 'c');
});

test('the LAST item of a multi-item order wraps to the FIRST', () => {
  assert.strictEqual(resolveAutoplayAdvanceTarget(null, ['a', 'b', 'c'], 'c'), 'a');
  assert.strictEqual(resolveAutoplayAdvanceTarget(null, ['x', 'y'], 'y'), 'x');
});

test('a single-item order never wraps (the Loop toggle owns replay intent)', () => {
  assert.strictEqual(resolveAutoplayAdvanceTarget(null, ['only'], 'only'), null);
  assert.strictEqual(resolveAutoplayAdvanceTarget(null, [], 'gone'), null);
});

test('a foreign/stale ended-id never teleports to the list head', () => {
  assert.strictEqual(resolveAutoplayAdvanceTarget(null, ['a', 'b'], 'not-in-list'), null);
  assert.strictEqual(resolveAutoplayAdvanceTarget(null, null, 'x'), null);
  assert.strictEqual(resolveAutoplayAdvanceTarget(null, undefined, 'x'), null);
});

// ---- source locks -----------------------------------------------------------

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

test('the context-advance seam routes through the wrap decision, and BOTH consumers use its target', () => {
  assert.match(PLAYER_JS, /var advanceTargetId = resolveAutoplayAdvanceTarget\(neighbors\.nextId, orderedIds, endedId\);/,
    'the one converged seam (ctx + folder flows) consults the wrap decision');
  assert.match(PLAYER_JS, /if \(!advanceTargetId\) return; \/\/ single-item\/foreign-id -- no wrap, no-op/);
  // The seed lookup and the navigate must BOTH use the wrapped target - a
  // half-migration would seed the wrong item or navigate to null.
  assert.match(PLAYER_JS, /videos\[vi\]\.id === advanceTargetId\) \{ nextItem = videos\[vi\]; break; \}/);
  assert.match(PLAYER_JS, /navigate\('\/watch\.html\?v=' \+ encodeURIComponent\(advanceTargetId\)/);
  // Exactly ONE consumer of the raw neighbors.nextId remains: the decision
  // call itself - anything else is a missed retarget.
  const raw = (PLAYER_JS.match(/neighbors\.nextId/g) || []).length;
  assert.strictEqual(raw, 1, 'only the decision call reads neighbors.nextId; found ' + raw);
});

test('the QUEUE advance does not wrap (computeQueueNext stays exhaustion-null)', () => {
  // Ruling: the queue is finite. Its next-derivation must not consult the
  // wrap decision.
  const body = /function computeQueueNext\(queue\) \{([\s\S]*?)\n\}/.exec(PLAYER_JS);
  assert.ok(body, 'computeQueueNext found');
  assert.ok(!/resolveAutoplayAdvanceTarget/.test(body[1]), 'the queue never wraps');
});
