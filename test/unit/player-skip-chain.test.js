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

const PLAYER_JS_RAW = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
// Gate confirmation round W-A: comment-porous source locks are this repo's
// thrice-paid class (v1.50, v1.77, v1.133 W4) - a comment-shadowed writer
// satisfied the raw-source census (M9). Strip comments ONCE; every lock below
// runs on the stripped source only.
const PLAYER_JS = PLAYER_JS_RAW.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

// W-A: a writer is ANY assignment/increment spelling, not one exact spacing -
// `skipChainUntil=0;` (no spaces) evaded the old `/skipChainUntil = /` census
// (M3) with no lint backstop (js.configs.recommended has no spacing rules).
const WRITER_RE = /\bskipChainUntil\s*(?:[+\-*/%&|^]|<<|>>>?|\?\?|&&|\|\|)?=(?!=)|(?:\+\+|--)\s*skipChainUntil\b|\bskipChainUntil\s*(?:\+\+|--)/g;
function countWriters(src) {
  return (src.match(WRITER_RE) || []).length;
}

// W-A: the old 300-char positional windows spanned the `} else {` boundary,
// so a seed relocated into the single-tap branch stayed green (M10). Real
// branch scoping instead: walk braces from the touchend dispatch header and
// hand back each branch body exactly.
function extractIfElseBranches(src, headerRe) {
  const m = headerRe.exec(src);
  assert.ok(m, 'branch header found: ' + headerRe);
  const walk = (open) => {
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return j; }
    }
    assert.fail('unbalanced braces after ' + headerRe);
  };
  const ifOpen = src.indexOf('{', m.index);
  const ifClose = walk(ifOpen);
  const elseM = /^\s*else\s*\{/.exec(src.slice(ifClose + 1));
  assert.ok(elseM, 'else branch present after ' + headerRe);
  const elseOpen = ifClose + 1 + elseM[0].length - 1;
  const elseClose = walk(elseOpen);
  return { ifBody: src.slice(ifOpen + 1, ifClose), elseBody: src.slice(elseOpen + 1, elseClose) };
}

const SKIP_DISPATCH_HEADER = /if \(gesture === 'skip-back' \|\| gesture === 'skip-fwd'\) \{/;

test('every skip arms/refreshes the chain window (double AND chain taps - the run keeps going)', () => {
  // The refresh sits inside the skip branch, alongside the skip itself.
  const b = extractIfElseBranches(PLAYER_JS, SKIP_DISPATCH_HEADER);
  assert.match(b.ifBody, /skip\(gesture === 'skip-back' \? -SKIP_SECONDS : SKIP_SECONDS\);/, 'the ONE skip dispatch');
  assert.match(b.ifBody, /skipChainUntil\s*=\s*now\s*\+\s*SKIP_CHAIN_MS;/, 'seeds and refreshes the chain');
});

test('the consult passes chain state gated on the movement veto (a drag never chains)', () => {
  assert.match(PLAYER_JS, /skipChainActive:\s*!tapGestureMoved\s*&&\s*now\s*<\s*skipChainUntil,/,
    'chain state rides the classifier consult, drag-vetoed');
});

test('the window is variableized', () => {
  assert.match(PLAYER_JS, /var SKIP_CHAIN_MS\s*=\s*800;/);
  assert.match(PLAYER_JS, /var skipChainUntil\s*=\s*0;/);
});

test('gate W1 + W-A: the WRITER CENSUS - exactly three writers, spelling-tolerant, comment-blind, branch-scoped', () => {
  // Round-1 survivors: an extra zero-out in touchstart killed the feature
  // end-to-end (green); an extra seed in the single branch made any two taps
  // a surprise seek (green). Confirmation-round survivors (W-A): the same
  // two at divergent spellings/positions (M3 no-space, M10 cross-branch)
  // plus a comment shadow of the W2 reset (M9) - all dead by construction
  // here (stripped source + tolerant regex + brace-walked scoping).
  assert.strictEqual(countWriters(PLAYER_JS), 3,
    'var init + the ONE skip-branch seed + the W2 teardown reset');
  assert.match(PLAYER_JS, /var skipChainUntil\s*=\s*0;/, 'the module init');
  const b = extractIfElseBranches(PLAYER_JS, SKIP_DISPATCH_HEADER);
  assert.strictEqual(countWriters(b.ifBody), 1, 'exactly ONE writer inside the skip branch');
  assert.match(b.ifBody, /skipChainUntil\s*=\s*now\s*\+\s*SKIP_CHAIN_MS;/, 'and it is the seed');
  assert.strictEqual(countWriters(b.elseBody), 0,
    'NO writer in the single-tap branch - a seed there turns pause-then-resume into pause-then-15s-seek');
  const reset = /function resetTransientPlaybackUi\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(reset, 'resetTransientPlaybackUi found');
  assert.strictEqual(countWriters(reset[1]), 1, 'exactly ONE writer in the W2 reset');
  assert.match(reset[1], /skipChainUntil\s*=\s*0;/, 'gate W2: the chain dies with the surface (teardown/dock/close) - a leaked chain ate the docked tap-to-expand click while hiding a seek');
});
