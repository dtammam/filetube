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
  // A refused request must roll back BOTH the flag and the placement -
  // IN THAT ORDER, in BOTH rollback shapes: placement calls dock(), whose
  // staged guard would no-op while the flag is still true, stranding the
  // host in the hidden stage. (My own M4 mutant hit the sync catch by
  // accident and survived - the order was unbound there.)
  assert.match(block[1], /req\.catch\(function \(\) \{ stagedFullscreen = false; placeHostAfterStageExit\(\); \}\);/);
  assert.match(block[1], /catch \(_\) \{\s*stagedFullscreen = false;\s*placeHostAfterStageExit\(\);\s*return null;/,
    'the sync-catch rollback clears the flag BEFORE placing');
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

test('gate ADV-W1: the enabling wire is bound - fsStageEl must be looked up, or the whole wave is inert with green tests', () => {
  // The adversarial seat deleted this one line and every wave test stayed
  // green while Dean's exact bug shipped "fixed": the locks bound the
  // branch's text, never its enablement.
  assert.match(PLAYER_JS, /fsStageEl = document\.getElementById\('fs-stage'\);/,
    'the stage lookup wires the feature - without it enterFullscreen silently takes the pre-v1.138 fallback');
});

test('gate QA-C2/ADV-C1: inNativeFullscreen knows the staged shape, truthiness-guarded (the null===null trap)', () => {
  const body = /function inNativeFullscreen\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'inNativeFullscreen found');
  assert.match(body[1], /!!\(stagedFullscreen && fsStageEl && document\.fullscreenElement === fsStageEl\)/,
    'the staged clause is guarded on BOTH the flag and a non-null stage - a bare === would read null===null as true whenever nothing is fullscreen');
});

test('gate QA-C1: mountInSlot itself redirects to the stage - EVERY caller covered by construction', () => {
  const body = /function mountInSlot\(slotEl\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'mountInSlot found');
  const guardIdx = body[1].indexOf('if (!host || !slotEl) return;');
  const redirectIdx = body[1].indexOf('if (stagedFullscreen && fsStageEl && slotEl !== fsStageEl) slotEl = fsStageEl;');
  const reparentIdx = body[1].indexOf('slotEl.appendChild(host);');
  assert.ok(guardIdx !== -1 && redirectIdx !== -1 && reparentIdx !== -1, 'guard + redirect + reparent present');
  assert.ok(guardIdx < redirectIdx && redirectIdx < reparentIdx,
    'the redirect sits between the null guard and the reparent - the views\' eager expand(playerSlot) black-screened staged advances without it');
});

test('exactly two requestFullscreen call sites: the staged writer + the retained no-stage fallback (the corrected plan prediction)', () => {
  const sites = (PLAYER_JS.match(/\.requestFullscreen\(\);/g) || []).length;
  assert.strictEqual(sites, 2, 'stage + fallback; found ' + sites);
});

test('gate S1: close() clears the staged flag and best-effort exits (no black stuck stage)', () => {
  const body = /function close\(\) \{([\s\S]*?)loadGeneration\+\+;/.exec(PLAYER_JS);
  assert.ok(body, 'close head found');
  assert.match(body[1], /stagedFullscreen = false;/);
  assert.match(body[1], /document\.fullscreenElement === fsStageEl && document\.exitFullscreen/);
});

test('inImmersiveMode covers the staged shape (fullscreen element = the host\'s PARENT)', () => {
  const body = /function inImmersiveMode\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'inImmersiveMode body found');
  assert.match(body[1], /host\.contains\(document\.fullscreenElement\) \|\| document\.fullscreenElement\.contains\(host\)/,
    'both containment directions - without the reverse check the auto-hide fade is blind in staged fullscreen');
});

// ---- every shell carries the stage (the every-shell census pattern) ---------

test('all 9 shells carry #fs-stage exactly once, outside #view-root', () => {
  const pub = path.join(__dirname, '..', '..', 'public');
  const shells = fs.readdirSync(pub).filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(pub, f), 'utf8').includes('id="player-dock"'));
  assert.strictEqual(shells.length, 9, 'the dock-carrying shells (machine-derived; +tv.html in v1.195)');
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

test('style.css: EVERY host-is-:fullscreen rule group carries its staged twin - both spellings (the divergent-spelling class)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#fs-stage \{ display: none; \}/);
  assert.match(css, /#fs-stage:fullscreen \{\s*display: block;/);
  assert.match(css, /#fs-stage:fullscreen \.player-container \{\s*width: 100%;\s*height: 100%;/);
  assert.match(css, /#fs-stage:fullscreen \.player-container \.player-controls \{[\s\S]{0,80}transition: opacity/);
  assert.match(css, /#fs-stage:fullscreen \.player-container\.controls-autohidden \.player-controls/);
  assert.match(css, /#fs-stage:fullscreen \.player-container\.controls-autohidden \{[\s\S]{0,40}cursor: none/);
  // Gate (BOTH seats, the divergent-spelling class): #player-wrapper IS
  // .player-container - the first sweep grepped one spelling and missed the
  // FULLSCREEN-restore block + the caption overlay. Bound now:
  assert.match(css, /#fs-stage:fullscreen #player-wrapper \{\s*padding-bottom: 0;/,
    'the 40px bar-reserve strip must not survive into staged fullscreen');
  assert.match(css, /#fs-stage:fullscreen #player-wrapper #media-player \{\s*aspect-ratio: auto;\s*height: 100%;/,
    'the width-bound aspect box must not survive (bar off-screen on wide displays)');
  assert.match(css, /#fs-stage:fullscreen #player-wrapper\.audio-mode #audio-bg-art \{\s*bottom: 0;/);
  assert.match(css, /#fs-stage:fullscreen \.player-container \.cc-overlay/,
    'captions ride the taller fullscreen bar offset (the v1.124 F1 occlusion must not return staged)');
  // The completeness NET, not a hand list: every :fullscreen rule whose
  // subject is the host (either spelling) must have a #fs-stage twin
  // somewhere in the file for its terminal selector tail.
  const hostFsRules = [...css.matchAll(/^(?:#player-wrapper|\.player-container)([^,{\n]*):fullscreen([^,{\n]*)[,{]/gm)];
  for (const m of hostFsRules) {
    const tail = (m[1] + m[2]).trim();
    const twinRe = new RegExp('#fs-stage:fullscreen [^{]*' + tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.ok(tail === '' || twinRe.test(css), 'missing staged twin for host :fullscreen rule tail: "' + tail + '"');
  }
  assert.ok(hostFsRules.length >= 8, 'sanity: the net sees the host :fullscreen rules (found ' + hostFsRules.length + ')');
});
