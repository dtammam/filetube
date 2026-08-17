'use strict';

// [UNIT] v1.140 (Dean's confirmed friction): the SKIP CHAIN. Tap #3 of a
// skip-skip-skip run used to start a fresh classification cycle, land as a
// single, and PAUSE - the inadvertent pause. Now: after any tap-skip, every
// tap landing while the chain is hot (SKIP_CHAIN_MS, refreshed per skip)
// keeps skipping in the tapped half's direction - no same-half pairing, no
// timing pairing, the YouTube convention - and tap-to-pause stays
// suppressed until the chain cools. Deliberately NOT built: the "slow
// double forgiveness" (converting a late second tap into a skip) - it would
// give a genuine slow pause-then-resume a surprise 15s seek.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { classifyTapGesture } = require('../../public/js/player.js');

// ---- classifyTapGesture chain rows (pure) ----------------------------------

test('a hot chain makes EVERY tap a skip in its half - no pairing, no timing', () => {
  // No lastTapTime at all (the fresh-cycle tap that used to pause):
  assert.strictEqual(classifyTapGesture({ now: 1000, lastTapTime: 0, lastTapLeft: false, onLeft: false, doubleTapMs: 350, skipChainActive: true }), 'skip-fwd');
  assert.strictEqual(classifyTapGesture({ now: 1000, lastTapTime: 0, lastTapLeft: false, onLeft: true, doubleTapMs: 350, skipChainActive: true }), 'skip-back');
  // Cross-half chain taps skip in the NEW half (direction changes allowed):
  assert.strictEqual(classifyTapGesture({ now: 1000, lastTapTime: 900, lastTapLeft: true, onLeft: false, doubleTapMs: 350, skipChainActive: true }), 'skip-fwd');
});

test('chain INACTIVE leaves the v1.21 table byte-identical', () => {
  assert.strictEqual(classifyTapGesture({ now: 1000, lastTapTime: 800, lastTapLeft: true, onLeft: true, doubleTapMs: 350, skipChainActive: false }), 'skip-back');
  assert.strictEqual(classifyTapGesture({ now: 1000, lastTapTime: 800, lastTapLeft: true, onLeft: true, doubleTapMs: 350 }), 'skip-back', 'absent flag = inactive');
  assert.strictEqual(classifyTapGesture({ now: 1000, lastTapTime: 0, lastTapLeft: false, onLeft: false, doubleTapMs: 350 }), 'single-tap');
  assert.strictEqual(classifyTapGesture({ now: 1000, lastTapTime: 800, lastTapLeft: true, onLeft: false, doubleTapMs: 350 }), 'single-tap', 'cross-half pair stays two singles when no chain');
  assert.strictEqual(classifyTapGesture({ now: 1400, lastTapTime: 1000, lastTapLeft: true, onLeft: true, doubleTapMs: 350 }), 'single-tap', 'slow second tap stays single (no forgiveness by design)');
});

// ---- source locks -----------------------------------------------------------

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

test('every skip arms/refreshes the chain window (double AND chain taps - the run keeps going)', () => {
  // The refresh sits inside the skip branch, after the skip itself.
  assert.match(PLAYER_JS, /skip\(gesture === 'skip-back' \? -SKIP_SECONDS : SKIP_SECONDS\);\s*\n\s*lastTapTime = 0;\s*\n[\s\S]{0,300}?skipChainUntil = now \+ SKIP_CHAIN_MS;/,
    'the ONE skip dispatch seeds and refreshes the chain');
});

test('the consult passes chain state gated on the movement veto (a drag never chains)', () => {
  assert.match(PLAYER_JS, /skipChainActive: !tapGestureMoved && now < skipChainUntil,/,
    'chain state rides the classifier consult, drag-vetoed');
});

test('the window is variableized', () => {
  assert.match(PLAYER_JS, /var SKIP_CHAIN_MS = 800;/);
  assert.match(PLAYER_JS, /var skipChainUntil = 0;/);
});

test('gate W1: the WRITER CENSUS - exactly three skipChainUntil writers, each positionally bound', () => {
  // The reviewer's two survivors: an extra zero-out in touchstart killed
  // the feature end-to-end (green); an extra seed in the single branch made
  // any two taps a surprise seek (green). The census makes any new writer
  // red until consciously bound here.
  const writers = (PLAYER_JS.match(/skipChainUntil = /g) || []).length;
  assert.strictEqual(writers, 3, 'var init + the ONE skip-branch seed + the W2 teardown reset; found ' + writers);
  // Each writer positionally bound:
  assert.match(PLAYER_JS, /var skipChainUntil = 0;/, 'the module init');
  assert.match(PLAYER_JS, /lastTapTime = 0;\s*\n[\s\S]{0,300}?skipChainUntil = now \+ SKIP_CHAIN_MS;/, 'the seed lives in the skip dispatch');
  const reset = /function resetTransientPlaybackUi\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(reset, 'resetTransientPlaybackUi found');
  assert.match(reset[1], /skipChainUntil = 0;/, 'gate W2: the chain dies with the surface (teardown/dock/close) - a leaked chain ate the docked tap-to-expand click while hiding a seek');
});
