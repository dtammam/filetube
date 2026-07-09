'use strict';

// [UNIT] v1.24 UX Round, Wave 3 (T9 follow-up) -- wires the "Move to..."
// picker (`showMoveModal`/`requestMoveItem`, public/js/common.js, already
// covered by test/unit/move-modal.test.js) into the UI: a per-item trigger
// on the home/library card grid (public/js/main.js) and the equivalent
// current-item trigger on the watch page (public/js/watch.js).
//
// Neither file exposes a jsdom-free pure function for "click the trigger,
// see what fires" (there is no jsdom/browser harness in this codebase, see
// CONTRIBUTING.md) -- so, mirroring test/unit/card-download-btn.test.js's
// established pattern for this exact class of problem (structural/wiring
// regression locks against the raw source text), these tests assert:
//   1. the trigger's markup exists in the right place, reusing the EXISTING
//      `.btn` class (never a new styled class -- also locked against
//      style.css directly);
//   2. the click-handling code calls `showMoveModal(...)` with the item +
//      the folders list the file already had in memory (no new fetch);
//   3. confirming a folder calls `requestMoveItem(...)` with the right
//      id/folder;
//   4. a successful move refreshes the affected view (main.js: drops the
//      item from `currentItems` and re-renders; watch.js: navigates back to
//      the library, since a move re-keys the item's id out from under this
//      page).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const WATCH_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'watch.js');
const STYLE_CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');

const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');
const watchJs = fs.readFileSync(WATCH_JS_PATH, 'utf8');
const styleCss = fs.readFileSync(STYLE_CSS_PATH, 'utf8');

// ---- both files: reachable as bare globals, no new CSS ---------------------

test('neither main.js nor watch.js window-qualifies showMoveModal/requestMoveItem -- reached the SAME bare-global way as showHardDeleteModal/nextArmState (common.js loads first as a classic script)', () => {
  assert.ok(!/window\.showMoveModal/.test(mainJs));
  assert.ok(!/window\.requestMoveItem/.test(mainJs));
  assert.ok(!/window\.showMoveModal/.test(watchJs));
  assert.ok(!/window\.requestMoveItem/.test(watchJs));
  assert.ok(/showMoveModal\(/.test(mainJs), 'main.js should call showMoveModal');
  assert.ok(/requestMoveItem\(/.test(mainJs), 'main.js should call requestMoveItem');
  assert.ok(/showMoveModal\(/.test(watchJs), 'watch.js should call showMoveModal');
  assert.ok(/requestMoveItem\(/.test(watchJs), 'watch.js should call requestMoveItem');
});

test('style.css carries no rule for .card-move-btn -- the trigger is styled ENTIRELY by the existing .btn class, no new styled class introduced', () => {
  assert.ok(!/\.card-move-btn\s*\{/.test(styleCss));
});

// ---- main.js: home/library card trigger -------------------------------------

test('card template: renders a "Move to..." trigger as a SIBLING inside .video-info, reusing the existing .btn class plus an unstyled .card-move-btn hook', () => {
  const cardMatch = /<div class="video-card">([\s\S]*?)<\/div>\s*`;/.exec(mainJs);
  assert.ok(cardMatch, 'expected to find the video-card template block in main.js');
  const cardBody = cardMatch[1];

  const moveBtnMatch = /<button[^>]*class="btn card-move-btn"[^>]*>/.exec(cardBody);
  assert.ok(moveBtnMatch, 'expected a <button class="btn card-move-btn"> in the card template');
  assert.match(moveBtnMatch[0], /data-id="\$\{escapeHtml\(item\.id\)\}"/);
  assert.match(moveBtnMatch[0], /aria-label="Move to another folder"/);
});

test('card template: the move trigger is its own <button>, not nested inside the delete or download overlay', () => {
  const cardMatch = /<div class="video-card">([\s\S]*?)<\/div>\s*`;/.exec(mainJs);
  const cardBody = cardMatch[1];

  const deleteBtnMatch = /<button[^>]*class="card-delete-btn"[\s\S]*?<\/button>/.exec(cardBody);
  const downloadBtnMatch = /<a[^>]*class="card-download-btn"[\s\S]*?<\/a>/.exec(cardBody);
  assert.ok(deleteBtnMatch);
  assert.ok(downloadBtnMatch);
  assert.ok(!deleteBtnMatch[0].includes('card-move-btn'));
  assert.ok(!downloadBtnMatch[0].includes('card-move-btn'));
});

test('main.js: ONE delegated click listener targets .card-move-btn on #video-grid (mirrors the .card-delete-btn delegated-listener style, never per-card)', () => {
  assert.match(mainJs, /videoGrid\.addEventListener\('click', \(e\) => \{\s*const btn = e\.target\.closest\('\.card-move-btn'\);/);
});

test('main.js: activating the trigger calls showMoveModal(item, allFolders, ...) -- the SAME in-memory folders list the sidebar already renders, no new fetch', () => {
  assert.match(mainJs, /showMoveModal\(item, allFolders, \(targetFolder, \{ teardown, statusEl \}\) => \{/);
});

test('main.js: confirming a folder calls requestMoveItem(id, targetFolder)', () => {
  assert.match(mainJs, /function moveCardById\(id, targetFolder, statusEl, teardown\) \{\s*requestMoveItem\(id, targetFolder\)/);
});

test('main.js: a successful move drops the item from currentItems and re-renders via renderSorted() -- mirrors deleteCardById\'s exact post-success refresh, never a full page reload', () => {
  const moveFnMatch = /function moveCardById\([\s\S]*?\n {4}\}/.exec(mainJs);
  assert.ok(moveFnMatch, 'expected to find moveCardById in main.js');
  const body = moveFnMatch[0];
  assert.match(body, /currentItems = currentItems\.filter\(\(item\) => item\.id !== id\)/);
  assert.match(body, /renderSorted\(\)/);
  assert.ok(!/window\.location\.reload/.test(body));
});

// ---- watch.js: current-item trigger -----------------------------------------

test('watch.js: builds a "Move to..." button reusing the existing .btn class (same family as #download-media-btn/#delete-media-btn) and mounts it into .watch-actions', () => {
  assert.match(watchJs, /moveBtn\.className = 'btn';/);
  assert.match(watchJs, /moveBtn\.textContent = 'Move to\.\.\.';/);
  assert.match(watchJs, /root\.querySelector\('\.watch-actions'\)/);
  assert.match(watchJs, /watchActions\.appendChild\(moveBtn\)/);
});

test('watch.js: the folders list is READ from the SAME GET /api/config fetch initWatch() already makes for the sidebar -- no second /api/config call', () => {
  const configFetchCount = (watchJs.match(/fetch\('\/api\/config'\)/g) || []).length;
  assert.strictEqual(configFetchCount, 1, 'expected exactly one GET /api/config fetch in watch.js');
  assert.match(watchJs, /currentFolders = configData\.folders \|\| \[\];/);
});

test('watch.js: activating the trigger calls showMoveModal(mediaData, currentFolders, ...)', () => {
  assert.match(watchJs, /showMoveModal\(mediaData, currentFolders, \(targetFolder, \{ teardown, statusEl \}\) => \{/);
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
