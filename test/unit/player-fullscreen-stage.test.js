'use strict';

// [UNIT] v1.138 desktop fullscreen stage (Dean: fullscreen must survive
// advances "just like iOS"). Mechanism: fullscreen a never-moving shell
// element (#fs-stage) with the host INSIDE it - navigation reparents the
// HOST, and moving a fullscreen element force-exits fullscreen (the v1.130
// disclosed desktop gap). Spec:
// docs/exec-plans/active/desktop-fullscreen-stage.md.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveLoadMountTarget, resolveStageExitPlacement } = require('../../public/js/player.js');

// ---- resolveLoadMountTarget (pure) -----------------------------------------

test('staged fullscreen WINS every mount decision (a reparent out of the stage force-exits fullscreen)', () => {
  assert.strictEqual(resolveLoadMountTarget(true, false), 'stage');
  assert.strictEqual(resolveLoadMountTarget(true, true), 'stage', 'staged beats a dock request - fullscreen intent persists until the user exits');
});

test('un-staged keeps the v1.44.2 dock/slot split byte-for-byte', () => {
  assert.strictEqual(resolveLoadMountTarget(false, true), 'dock');
  assert.strictEqual(resolveLoadMountTarget(false, false), 'slot');
});

// ---- resolveStageExitPlacement (pure) --------------------------------------

test('exit placement mirrors what a normal navigation would have produced', () => {
  assert.strictEqual(resolveStageExitPlacement(true), 'slot');
  assert.strictEqual(resolveStageExitPlacement(false), 'dock');
});

// ---- source locks -----------------------------------------------------------

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

test('enterFullscreen reparents into the stage BEFORE requesting (reversed order exits what it just entered)', () => {
  const block = /if \(host && fsStageEl && fsStageEl\.requestFullscreen\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
  assert.ok(block, 'the staged enter branch exists');
  const reparentIdx = block[1].indexOf('fsStageEl.appendChild(host);');
  const flagIdx = block[1].indexOf('stagedFullscreen = true;');
  const requestIdx = block[1].indexOf('fsStageEl.requestFullscreen();');
  assert.ok(reparentIdx !== -1 && flagIdx !== -1 && requestIdx !== -1, 'reparent + flag + request all present');
  assert.ok(reparentIdx < requestIdx && flagIdx < requestIdx, 'reparent and flag precede the request');
  // A refused request must roll back BOTH the flag and the placement.
  assert.match(block[1], /req\.catch\(function \(\) \{ stagedFullscreen = false; placeHostAfterStageExit\(\); \}\);/);
});

test('dock() no-ops while staged (the router transition must not yank the host out of fullscreen)', () => {
  const body = /function dock\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'dock body found');
  const guardIdx = body[1].indexOf('if (stagedFullscreen) return;');
  const stateGuardIdx = body[1].indexOf('state === STATE_CLOSED');
  assert.ok(guardIdx !== -1, 'the staged guard exists');
  assert.ok(guardIdx < stateGuardIdx, 'the staged guard is FIRST - before any state mutation or chrome work');
});

test('BOTH load seams (fresh + adopt) route through the ONE pure mount decision', () => {
  assert.match(PLAYER_JS, /var mountTarget = resolveLoadMountTarget\(stagedFullscreen, !!options\.dock\);\s*\n\s*if \(mountTarget === 'stage'\) mountInSlot\(fsStageEl\);/,
    'the fresh-load seam');
  assert.match(PLAYER_JS, /var adoptTarget = resolveLoadMountTarget\(stagedFullscreen, !!options\.dock\);\s*\n\s*if \(adoptTarget === 'stage'\) expand\(fsStageEl\);/,
    'the adopt seam');
  const calls = (PLAYER_JS.match(/resolveLoadMountTarget\(stagedFullscreen, !!options\.dock\)/g) || []).length;
  assert.strictEqual(calls, 2, 'exactly the two seams consult the decision');
});

test('the exit listener clears the flag BEFORE placing (placement may call dock(), whose staged guard would no-op it)', () => {
  const block = /if \(!document\.fullscreenElement && stagedFullscreen\) \{([\s\S]*?)\}/.exec(PLAYER_JS);
  assert.ok(block, 'the staged exit branch exists');
  const clearIdx = block[1].indexOf('stagedFullscreen = false;');
  const placeIdx = block[1].indexOf('placeHostAfterStageExit();');
  assert.ok(clearIdx !== -1 && placeIdx !== -1 && clearIdx < placeIdx, 'clear-then-place order');
});

test('placeHostAfterStageExit: state-guarded, slot-or-dock via the pure decision', () => {
  const body = /function placeHostAfterStageExit\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'placeHostAfterStageExit body found');
  assert.match(body[1], /if \(state !== STATE_FULL\) return;/, 'closed/docked-while-staged leaves nothing to place');
  assert.match(body[1], /resolveStageExitPlacement\(!!slot\)/, 'placement routes through the pure decision');
});

test('inImmersiveMode covers the staged shape (fullscreen element = the host\'s PARENT)', () => {
  const body = /function inImmersiveMode\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'inImmersiveMode body found');
  assert.match(body[1], /host\.contains\(document\.fullscreenElement\) \|\| document\.fullscreenElement\.contains\(host\)/,
    'both containment directions - without the reverse check the auto-hide fade is blind in staged fullscreen');
});

// ---- every shell carries the stage (the every-shell census pattern) ---------

test('all 8 shells carry #fs-stage exactly once, outside #view-root', () => {
  const pub = path.join(__dirname, '..', '..', 'public');
  const shells = fs.readdirSync(pub).filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(pub, f), 'utf8').includes('id="player-dock"'));
  assert.strictEqual(shells.length, 8, 'the 8 dock-carrying shells (machine-derived in the plan)');
  for (const f of shells) {
    const src = fs.readFileSync(path.join(pub, f), 'utf8');
    const count = (src.match(/id="fs-stage"/g) || []).length;
    assert.strictEqual(count, 1, `${f} carries #fs-stage exactly once`);
    const viewRootIdx = src.indexOf('id="view-root"');
    const stageIdx = src.indexOf('id="fs-stage"');
    if (viewRootIdx !== -1) {
      const viewRootClose = src.indexOf('</div>', viewRootIdx); // heuristic: the stage must not sit immediately inside view-root's opening region
      assert.ok(stageIdx < viewRootIdx || stageIdx > viewRootClose, `${f}: #fs-stage sits outside #view-root's swap region`);
    }
  }
});

// ---- the CSS staged twins ---------------------------------------------------

test('style.css: every .player-container:fullscreen rule group carries its staged twin', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#fs-stage \{ display: none; \}/);
  assert.match(css, /#fs-stage:fullscreen \{\s*display: block;/);
  assert.match(css, /#fs-stage:fullscreen \.player-container \{\s*width: 100%;\s*height: 100%;/);
  assert.match(css, /#fs-stage:fullscreen \.player-container \.player-controls \{[\s\S]{0,80}transition: opacity/);
  assert.match(css, /#fs-stage:fullscreen \.player-container\.controls-autohidden \.player-controls/);
  assert.match(css, /#fs-stage:fullscreen \.player-container\.controls-autohidden \{[\s\S]{0,40}cursor: none/);
});
