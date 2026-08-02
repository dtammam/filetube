'use strict';

// [UNIT] v1.68.1 - the ROTATION CAP NUDGE (Dean's on-device trigger,
// 2026-08-02: rotate the inline watch page to landscape and back and the
// player box renders at ~45% of the LANDSCAPE height with the picture
// cropped, until a manual scroll pops it back). Mechanism: the mobile
// height caps (45vh/78vh/100vh, style.css) live inside media queries iOS
// drops in landscape and re-applies on rotate-back - and WebKit resolves
// their vh against STALE pre-rotation viewport metrics, never revisiting
// until a style invalidation (which is exactly what the manual scroll is).
//
// Two independent layers, either alone should hold on-device:
//   1. player.js nudgeViewportHeightCaps(): release the cap inline, force
//      one layout, clear the inline value so the cascade re-resolves NOW.
//   2. style.css dvh twins after each vh cap (dvh re-resolves on viewport
//      changes by spec; vh stays as the no-dvh-browser fallback).
//
// The wiring locks below are EXACT-STATEMENT + ORDERING (the v1.67.5 W1
// lesson: presence locks alone let four crafted mutants survive). The
// rotation itself is browser-runtime; Dean's device pass stays the arbiter.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const PLAYER_JS = fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const STRIPPED = stripComments(PLAYER_JS);

// ---- layer 1: the JS nudge --------------------------------------------------

test('nudgeViewportHeightCaps body: release -> forced layout -> CLEARED inline value, in that order, over host AND mediaPlayer', () => {
  const fn = /function nudgeViewportHeightCaps\(\) \{([\s\S]*?)\n {2}\}/.exec(STRIPPED);
  assert.ok(fn, 'the nudge helper exists');
  const body = fn[1];

  // Both capped elements ride the same loop: host (the .player-container /
  // #player-wrapper node - the 45vh + portrait-media caps) and mediaPlayer
  // (#media-player - the #player-slot 100vh-derived cap).
  assert.ok(body.includes('var els = [host, mediaPlayer];'), 'exactly the two capped elements');

  // The load-bearing order. A mutant that clears before forcing layout
  // never re-resolves against settled metrics; a mutant that leaves 'none'
  // (or a frozen pixel copy) installed deposes the cascade - including
  // .audio-expanded's and fullscreen's own max-height overrides.
  const release = body.indexOf("el.style.maxHeight = 'none';");
  const reflow = body.indexOf('void el.offsetHeight;');
  const clear = body.indexOf("el.style.maxHeight = '';");
  assert.ok(release !== -1, 'exact release statement');
  assert.ok(reflow !== -1, 'exact forced-layout statement');
  assert.ok(clear !== -1, 'exact CLEARED-inline statement (empty string, never a frozen value)');
  assert.ok(release < reflow && reflow < clear, 'release -> reflow -> clear, in that order');

  // Disconnected/absent elements are skipped, never dereferenced.
  assert.ok(body.includes('if (!el || !el.isConnected) continue;'), 'absent/disconnected guard');
});

test('scheduleViewportCapNudge: both passes run the nudge THEN the dead-zone snap (v1.68.2 order - the snap must see settled geometry)', () => {
  const fn = /function scheduleViewportCapNudge\(\) \{([\s\S]*?)\n {2}\}/.exec(STRIPPED);
  assert.ok(fn, 'the scheduler exists');
  const body = fn[1];
  // The settled-frame pass is still double-rAF; the belt is still 650ms.
  assert.ok(/requestAnimationFrame\(function \(\) \{ requestAnimationFrame\(function \(\) \{/.test(body),
    'the settled-frame pass (double-rAF)');
  assert.ok(/setTimeout\(function \(\) \{[\s\S]*?\}, 650\);/.test(body),
    'the late belt for slow rotation animations');
  // BOTH actions in BOTH passes, nudge before snap each time.
  const calls = body.match(/nudgeViewportHeightCaps\(\);|snapRotationDeadZone\(\);/g) || [];
  assert.deepStrictEqual(
    calls,
    ['nudgeViewportHeightCaps();', 'snapRotationDeadZone();', 'nudgeViewportHeightCaps();', 'snapRotationDeadZone();'],
    'two passes, each nudge-then-snap - a swapped order snaps against pre-nudge geometry'
  );
});

test('wiring: onOrientationChange schedules the nudge AFTER the FULL-only gate and BEFORE the auto-fullscreen decision', () => {
  const fn = /function onOrientationChange\(\) \{([\s\S]*?)\n {4}\}/.exec(STRIPPED);
  assert.ok(fn, 'onOrientationChange body');
  const body = fn[1];
  const gate = body.indexOf('if (state !== STATE_FULL) return;');
  const nudge = body.indexOf('scheduleViewportCapNudge();');
  const autoFs = body.indexOf('shouldAutoFullscreenOnRotate');
  assert.ok(gate !== -1, 'the FULL-only gate survives (a docked mini-player rotation must not nudge)');
  assert.ok(nudge !== -1, 'the exact schedule call');
  assert.ok(autoFs !== -1, 'the auto-fullscreen decision survives');
  assert.ok(gate < nudge, 'gate precedes the nudge (never nudge outside FULL)');
  assert.ok(nudge < autoFs, 'nudge precedes the auto-fullscreen decision (a rotate-into-fullscreen still re-resolves caps for its later exit)');
  // Exactly one scheduling call site in the whole file - the orientation
  // seam owns this; nothing else (resize storms, scroll) may pile on.
  const sites = STRIPPED.match(/scheduleViewportCapNudge\(\);/g) || [];
  assert.strictEqual(sites.length, 1, 'exactly ONE call site');
});

// ---- v1.68.2: the rotation dead-zone snap -----------------------------------
// Dean's on-device FAIL of the v1.68.1 cap fix re-diagnosed the symptom as a
// SCROLL mechanism: iOS preserves the pixel scroll offset across rotation,
// portrait stacks ~190px more chrome above the player than landscape, so
// rotate-and-back deposits that delta as residual scrollY. The decision is
// pure and EXECUTED here (resolveRotationTopSnap, a real export - not a
// source lock); the runtime wiring below it remains source-locked per the
// tech-debt #78 disclosure.

const { resolveRotationTopSnap } = require('../../public/js/player.js');

test('resolveRotationTopSnap: THE bug shape snaps - residual scroll strictly between page top and the player top', () => {
  assert.strictEqual(resolveRotationTopSnap(190, 370), true, 'the measured on-device residual');
  assert.strictEqual(resolveRotationTopSnap(1, 370), true, 'any dead-zone position snaps');
  assert.strictEqual(resolveRotationTopSnap(369, 370), true, 'up to just above the player');
});

test('resolveRotationTopSnap: everything outside the dead zone is left alone', () => {
  assert.strictEqual(resolveRotationTopSnap(0, 370), false, 'already at top - no-op');
  assert.strictEqual(resolveRotationTopSnap(370, 370), false, 'AT the player top is a real position (boundary excluded)');
  assert.strictEqual(resolveRotationTopSnap(1200, 370), false, 'reading comments - iOS content anchoring is correct there');
  assert.strictEqual(resolveRotationTopSnap(-5, 370), false, 'rubber-band overscroll never snaps');
  assert.strictEqual(resolveRotationTopSnap(100, 0), false, 'a player already at document top has NO dead zone');
  assert.strictEqual(resolveRotationTopSnap(100, -10), false, 'negative doc top (mid-teardown geometry) never snaps');
});

test('resolveRotationTopSnap: non-numbers never snap (the coercion scar)', () => {
  for (const junk of [undefined, null, 'x', NaN]) {
    assert.strictEqual(resolveRotationTopSnap(junk, 370), false, `scrollY=${String(junk)}`);
    assert.strictEqual(resolveRotationTopSnap(190, junk), false, `playerDocTop=${String(junk)}`);
  }
});

test('snapRotationDeadZone wiring: every guard re-checked at APPLY time, exact statements in guard-then-measure-then-snap order', () => {
  const fn = /function snapRotationDeadZone\(\) \{([\s\S]*?)\n {2}\}/.exec(STRIPPED);
  assert.ok(fn, 'the runtime snap exists');
  const body = fn[1];
  // The C1 discipline: a navigation can land between the orientation event
  // and this pass - every guard evaluates HERE, none is captured earlier.
  const mobile = body.indexOf('if (!isMobileFormFactor()) return;');
  const full = body.indexOf('if (state !== STATE_FULL) return;');
  const native = body.indexOf('if (inNativeFullscreen()) return;');
  const faux = body.indexOf("if (host && host.classList.contains('css-fullscreen')) return;");
  const mounted = body.indexOf('if (!host || !host.isConnected) return;');
  for (const [idx, name] of [[mobile, 'mobile'], [full, 'FULL'], [native, 'native-fs'], [faux, 'faux-fs'], [mounted, 'mounted']]) {
    assert.ok(idx !== -1, `${name} guard present as an exact statement`);
  }
  const measure = body.indexOf('var playerDocTop = host.getBoundingClientRect().top + y;');
  const snap = body.indexOf('if (resolveRotationTopSnap(y, playerDocTop)) window.scrollTo(0, 0);');
  assert.ok(measure !== -1, 'document-top derivation is rect.top + CURRENT scroll');
  assert.ok(snap !== -1, 'the snap consumes THE pure decision and targets exactly (0, 0)');
  assert.ok(Math.max(mobile, full, native, faux, mounted) < measure && measure < snap,
    'all guards precede the measurement, the measurement precedes the snap');
  // Exactly one runtime consumer of the pure decision.
  const consumers = STRIPPED.match(/resolveRotationTopSnap\(y, playerDocTop\)/g) || [];
  assert.strictEqual(consumers.length, 1, 'the scheduler passes are the only path to a snap');
});

// ---- layer 2: the CSS dvh twins ---------------------------------------------
// Each capped rule must carry its dvh twin AFTER the vh line (cascade: dvh
// wins where supported, vh serves browsers without it), with IDENTICAL
// numbers - a drifted twin silently forks the two layers.

function ruleBlock(css, selectorRe) {
  const m = selectorRe.exec(css);
  assert.ok(m, `selector found: ${selectorRe}`);
  const start = css.indexOf('{', m.index);
  const end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}

test('css: .player-container carries the 45vh cap AND its 45dvh twin, twin after fallback', () => {
  const block = ruleBlock(STYLE_CSS, /\.player-container \{\s*\n\s*max-height: 45vh;/);
  const vh = block.indexOf('max-height: 45vh;');
  const dvh = block.indexOf('max-height: 45dvh;');
  assert.ok(vh !== -1 && dvh !== -1, 'both declarations present');
  assert.ok(vh < dvh, 'dvh twin AFTER the vh fallback (or unsupporting browsers would win the cascade backwards)');
});

test('css: the #player-slot media cap carries its 100dvh twin, twin after fallback', () => {
  const block = ruleBlock(STYLE_CSS, /#player-slot #player-wrapper:not\(\.audio-expanded\):not\(\.css-fullscreen\):not\(:fullscreen\) #media-player \{/);
  const vh = block.indexOf('max-height: calc(100vh - var(--mobile-header-h, 96px) - 96px);');
  const dvh = block.indexOf('max-height: calc(100dvh - var(--mobile-header-h, 96px) - 96px);');
  assert.ok(vh !== -1, 'vh fallback present, numbers intact');
  assert.ok(dvh !== -1, 'dvh twin present, numbers IDENTICAL to the fallback');
  assert.ok(vh < dvh, 'dvh twin AFTER the vh fallback');
});

test('css: the :empty reserved-frame mirror carries its 45dvh twin, twin after fallback (gate S1 - the fourth cap site)', () => {
  // Anchored past the base (uncapped) :empty rule to the media-scoped twin.
  const block = ruleBlock(STYLE_CSS, /\.watch-container #player-slot:empty \{\s*\n\s*max-height: 45vh;/);
  const vh = block.indexOf('max-height: 45vh;');
  const dvh = block.indexOf('max-height: 45dvh;');
  assert.ok(vh !== -1 && dvh !== -1, 'both declarations present');
  assert.ok(vh < dvh, 'dvh twin AFTER the vh fallback');
});

test('css: the portrait-media cap carries its 78dvh/100dvh twin, twin after fallback', () => {
  const block = ruleBlock(STYLE_CSS, /#player-wrapper\.portrait-media \{/);
  const vh = block.indexOf('max-height: min(78vh, calc(100vh - var(--mobile-header-h) - var(--mobile-bottom-nav-h)));');
  const dvh = block.indexOf('max-height: min(78dvh, calc(100dvh - var(--mobile-header-h) - var(--mobile-bottom-nav-h)));');
  assert.ok(vh !== -1, 'vh fallback present, numbers intact');
  assert.ok(dvh !== -1, 'dvh twin present, numbers IDENTICAL to the fallback');
  assert.ok(vh < dvh, 'dvh twin AFTER the vh fallback');
});
