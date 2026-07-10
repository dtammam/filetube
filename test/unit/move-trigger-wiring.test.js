'use strict';

// [UNIT] v1.24 UX Round, Wave 3 (T9 follow-up) -- wires the "Move to..."
// picker (`showMoveModal`/`requestMoveItem`, public/js/common.js, already
// covered by test/unit/move-modal.test.js) into the UI.
//
// v1.24.2 originally wired a per-item trigger on BOTH the home/library card
// grid (public/js/main.js) and the watch page (public/js/watch.js). v1.24.3
// (on-device feedback) REMOVED the home/library card trigger -- move is now
// available only from within the watch page, never from the home cards. This
// file now locks ONLY the watch.js wiring, plus a regression guard that the
// card-level trigger stays gone from main.js.
//
// main.js exposes no jsdom-free pure function for "click the trigger, see
// what fires" (there is no jsdom/browser harness in this codebase, see
// CONTRIBUTING.md) -- so, mirroring test/unit/card-download-btn.test.js's
// established pattern for this exact class of problem (structural/wiring
// regression locks against the raw source text), the watch.js tests below
// assert:
//   1. the trigger's markup exists in the right place, reusing the EXISTING
//      `.btn` class;
//   2. the click-handling code calls `showMoveModal(...)` with the item +
//      the folders list the file already had in memory (no new fetch);
//   3. confirming a folder calls `requestMoveItem(...)` with the right
//      id/folder;
//   4. a successful move navigates back to the library, closing the player
//      first (since a move re-keys the item's id out from under this page).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const WATCH_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'watch.js');

const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');
const watchJs = fs.readFileSync(WATCH_JS_PATH, 'utf8');

// ---- main.js: the home/library card trigger stays REMOVED (v1.24.3) --------

test('main.js: no card-level "Move to..." trigger -- no .card-move-btn markup, no moveCardById helper, no showMoveModal/requestMoveItem reference', () => {
  assert.ok(!/card-move-btn/.test(mainJs), 'expected no .card-move-btn markup/hook in main.js');
  assert.ok(!/moveCardById/.test(mainJs), 'expected no moveCardById helper in main.js');
  assert.ok(!/showMoveModal/.test(mainJs), 'expected main.js to no longer reference showMoveModal');
  assert.ok(!/requestMoveItem/.test(mainJs), 'expected main.js to no longer reference requestMoveItem');
});

// ---- watch.js: current-item trigger -----------------------------------------

test('watch.js window-qualifies neither showMoveModal nor requestMoveItem -- reached the SAME bare-global way as showHardDeleteModal/nextArmState (common.js loads first as a classic script)', () => {
  assert.ok(!/window\.showMoveModal/.test(watchJs));
  assert.ok(!/window\.requestMoveItem/.test(watchJs));
  assert.ok(/showMoveModal\(/.test(watchJs), 'watch.js should call showMoveModal');
  assert.ok(/requestMoveItem\(/.test(watchJs), 'watch.js should call requestMoveItem');
});

// v1.25.6 hotfix: Move now mounts into the `.watch-action-btns` nowrap
// sub-group of `.watch-actions` (falling back to `.watch-actions` itself if
// that sub-group is ever absent) instead of `.watch-actions` directly -- see
// test/unit/watch-action-bar-nowrap.test.js for the full iOS shrink-to-fit
// regression story this was part of.
test('watch.js: builds a "Move" button reusing the existing .btn class (same family as #download-media-btn/#delete-media-btn) and mounts it into .watch-action-btns', () => {
  assert.match(watchJs, /moveBtn\.className = 'btn';/);
  assert.match(watchJs, /root\.querySelector\('\.watch-actions'\)/);
  assert.match(watchJs, /watchActions\.querySelector\('\.watch-action-btns'\)/);
  assert.match(watchJs, /\(btnGroup \|\| watchActions\)\.appendChild\(moveBtn\)/);
});

// Visual-consistency polish: Move previously had no leading glyph (the only
// text-only button in the Download/Delete/Move row) -- it now gets
// `.icon-folder` (closest existing icon to "move to a folder"; no new icon
// asset added) built via createElement/createTextNode, mirroring how
// Download/Delete already pair an `<i class="icon-*">` with a short label.
test('watch.js: the Move button carries an .icon-folder glyph (built via DOM methods, not innerHTML) plus a descriptive aria-label/title', () => {
  const setupMatch = /function setupMoveButton\(\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  assert.ok(setupMatch, 'expected to find setupMoveButton in watch.js');
  const body = setupMatch[0];
  assert.match(body, /moveIcon\.className = 'icon-folder';/);
  assert.match(body, /moveBtn\.appendChild\(moveIcon\)/);
  assert.match(body, /moveBtn\.appendChild\(document\.createTextNode\(' Move'\)\)/);
  assert.match(body, /moveBtn\.setAttribute\('aria-label', 'Move to another folder'\);/);
  assert.doesNotMatch(body, /moveBtn\.innerHTML/, 'the Move button markup should be built via DOM methods, not innerHTML');
});

test('watch.js: the folders list is READ from the SAME GET /api/config fetch initWatch() already makes for the sidebar -- no second /api/config call', () => {
  const configFetchCount = (watchJs.match(/fetch\('\/api\/config'\)/g) || []).length;
  assert.strictEqual(configFetchCount, 1, 'expected exactly one GET /api/config fetch in watch.js');
  assert.match(watchJs, /currentFolders = configData\.folders \|\| \[\];/);
});

test('watch.js: activating the trigger calls showMoveModal(mediaData, currentFolders, ...)', () => {
  // v1.26.2 code-review fix (F2): the callback now also destructures
  // `reenable` (showMoveModal's busy-guard un-flip, called on a failed
  // move so the user can retry) alongside the pre-existing
  // `teardown`/`statusEl`.
  assert.match(watchJs, /showMoveModal\(mediaData, currentFolders, \(targetFolder, \{ teardown, statusEl, reenable \}\) => \{/);
});

test('watch.js: confirming a folder calls requestMoveItem(mediaData.id, targetFolder)', () => {
  const handlerMatch = /function handleMoveClick\(\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  assert.ok(handlerMatch, 'expected to find handleMoveClick in watch.js');
  assert.match(handlerMatch[0], /requestMoveItem\(mediaData\.id, targetFolder\)/);
});

test('watch.js: a successful move navigates back to the library (the item re-keys under a new id, so this page cannot stay on it) -- mirrors performMediaDelete\'s exact post-success navigate', () => {
  const handlerMatch = /function handleMoveClick\(\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  const body = handlerMatch[0];
  assert.match(body, /showToast\('File moved\.'\)/);
  assert.match(body, /window\.FileTube\.navigate\('\/'\)/);
  assert.match(body, /window\.location\.href = '\/'/);
});

// FIX 2 (v1.24 UX Round, Wave 3 two-reviewer gate): a successful move
// re-keys the item under a brand-new id -- the persistent player is still
// holding the OLD id and would keep Range-requesting a now-nonexistent
// resource, 404-ing mid-playback, unless it is stopped BEFORE the
// post-success navigate. Mirrors `performMediaDelete`'s own
// `window.FileTube.player.close()` guard exactly.
test('watch.js: a successful move stops the player BEFORE navigating away (mirrors performMediaDelete\'s player.close() guard)', () => {
  const handlerMatch = /function handleMoveClick\(\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  const body = handlerMatch[0];
  assert.match(body, /if \(window\.FileTube && window\.FileTube\.player\) window\.FileTube\.player\.close\(\);/);

  const closeIdx = body.indexOf('window.FileTube.player.close();');
  const navigateIdx = body.indexOf("window.FileTube.navigate('/');");
  assert.ok(closeIdx !== -1 && navigateIdx !== -1, 'expected both player.close() and navigate(\'/\') in the success handler');
  assert.ok(closeIdx < navigateIdx, 'player.close() must run BEFORE navigate() away from the (now stale) watch page');
});

test('watch.js: setupMoveButton is idempotent -- guarded on moveBtn already existing, so a second call within the same view instance never appends a duplicate control', () => {
  const setupMatch = /function setupMoveButton\(\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  assert.ok(setupMatch, 'expected to find setupMoveButton in watch.js');
  assert.match(setupMatch[0], /if \(!moveBtn\) \{/);
});
