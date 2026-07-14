'use strict';

// [UNIT] v1.36.2 minors, client half -- SOURCE LOCKS (the established
// pattern for behavior living inside the page IIFEs, same posture as
// player-background-audio.test.js's F3b locks): the contracts below are
// asserted against the shipped source text, so a refactor that silently
// drops the wiring fails loudly here.
//
// Bug A (Dean): "Liked" must power prev/next. The launch context is carried
// as `?list=liked` from the home grid's cards into watch.html, consumed by
// setupPrevNext (fetches /api/liked instead of the folder list), and
// preserved across prev/next hops by navigateToWatch.
//
// Bug B (Dean): PWA video controls dead after app-switch. iOS strands the
// native control layer; rearmNativeControls cycles the `controls`
// attribute (off -> applyControlsMode's on) on every foreground return.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mainSrc = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');
const watchSrc = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
const playerSrc = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');

// ---- Bug A: the Liked launch context ----------------------------------------

test('v1.40.0 A (supersedes v1.36.2 list=liked): home grid cards carry the FULL browse context via ?ctx=, both anchors use watchHref', () => {
  // v1.40.0 generalized the v1.36.2 `list=liked`-only carry into a full
  // browse-context param (scope + sort + shuffle seed) so prev/next follows the
  // exact on-screen order, not just the Liked list.
  assert.ok(
    mainSrc.includes('const ctxParam = currentBrowseContextParam();'),
    'buildCardHtml must derive the browse-context param from the live view state',
  );
  assert.ok(
    mainSrc.includes("${ctxParam ? '&ctx=' + encodeURIComponent(ctxParam) : ''}"),
    'the ctx param is URL-encoded and appended to watchHref only when non-empty (empty -> folder fallback)',
  );
  const anchorUses = (mainSrc.match(/href="\$\{watchHref\}"/g) || []).length;
  assert.equal(anchorUses, 2, 'both the thumbnail and the title anchors must use the context-carrying href');
  assert.ok(
    !mainSrc.includes('href="/watch.html?v=${item.id}"'),
    'no card anchor may bypass watchHref with a bare context-less URL',
  );
});

test('v1.36.2 A: watch.js consumes the context -- strict value check, /api/liked branch in setupPrevNext, preserved by navigateToWatch', () => {
  assert.ok(
    watchSrc.includes("urlParams.get('list') === 'liked' ? 'liked' : null"),
    'the context param must be strictly validated (unknown values degrade to folder behavior)',
  );
  assert.ok(
    watchSrc.includes("listContext === 'liked' ? '/api/liked' : folderBase"),
    "setupPrevNext must walk the LIKED list when the context is 'liked'",
  );
  assert.ok(
    watchSrc.includes("(listContext ? '&list=' + encodeURIComponent(listContext) : '')"),
    'navigateToWatch must PRESERVE the context so prev/next hops stay in the Liked list',
  );
});

// ---- Bug B: native-controls re-arm on foreground return ----------------------

test('v1.36.2 B: rearmNativeControls exists, cycles the controls attribute for the native shape only, and delegates to applyControlsMode', () => {
  const fnStart = playerSrc.indexOf('function rearmNativeControls()');
  assert.ok(fnStart >= 0, 'rearmNativeControls must exist');
  const fnBody = playerSrc.slice(fnStart, playerSrc.indexOf('\n  }', fnStart));
  assert.ok(fnBody.includes("mediaPlayer.hasAttribute('controls')"), 'the cycle only fires when controls is actually set');
  assert.ok(fnBody.includes("mediaPlayer.removeAttribute('controls')"), 'the off half of the off->on cycle');
  assert.ok(fnBody.includes('!mobileCustomPlayerCached'), 'the cycle is scoped to the native (non-custom) mode');
  assert.ok(
    playerSrc.slice(fnStart).includes('applyControlsMode();'),
    'the on half must go through applyControlsMode -- the single controls authority',
  );
});

test('v1.36.2 B: the foreground visibilitychange handler calls rearmNativeControls AFTER handleForegroundSwapBack (mode computed against the settled surface)', () => {
  const handlerStart = playerSrc.indexOf("document.addEventListener('visibilitychange', function () {");
  assert.ok(handlerStart >= 0);
  const handlerBody = playerSrc.slice(handlerStart, handlerStart + 1200);
  const swapIdx = handlerBody.indexOf('handleForegroundSwapBack()');
  const rearmIdx = handlerBody.indexOf('rearmNativeControls()');
  assert.ok(swapIdx >= 0 && rearmIdx >= 0, 'both calls must be present in the foreground handler');
  assert.ok(rearmIdx > swapIdx, 'the re-arm must run after the bgAudio swap-back');
});

// ---- Bug D (server half, unit): the recoverable-delete errno set -------------

test('v1.36.2 D: RECOVERABLE_DELETE_CODES covers the Docker-volume reality -- EROFS/EACCES (v1.13) + EBUSY/EPERM (v1.36.2), and nothing that should hard-fail', () => {
  process.env.DATA_DIR = process.env.DATA_DIR || require('node:os').tmpdir();
  const { RECOVERABLE_DELETE_CODES } = require('../../server');
  for (const code of ['EROFS', 'EACCES', 'EBUSY', 'EPERM']) {
    assert.ok(RECOVERABLE_DELETE_CODES.has(code), `${code} must offer the 409 + removeAnyway escape hatch`);
  }
  for (const code of ['ENOENT', 'EIO', 'ENOSPC']) {
    assert.ok(!RECOVERABLE_DELETE_CODES.has(code), `${code} must keep its existing (success-fallthrough or hard-500) handling`);
  }
});
